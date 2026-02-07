# Kokoro TTS Deep Dive

## Overview

- **82 million parameters** — delivers quality outperforming models 5-15x its size
- Apache 2.0 license
- 8 languages, 26 voice options
- Ranked #3 on HuggingFace TTS Arena
- ONNX deployment supported for offline use
- Repo: https://github.com/hexgrad/kokoro
- Model: https://huggingface.co/hexgrad/Kokoro-82M

## Hardware Requirements

Runs on our M1 Pro MacBook (16GB RAM) with ease:
- ~330MB RAM usage
- Works on CPU alone; MPS (Apple GPU) makes it near-instant
- No GPU required

## Synthesis Pipeline

```
Text -> Phonemes (misaki G2P) -> Duration Prediction -> Alignment Matrix -> Audio (24kHz)
```

1. **Text -> Phonemes**: Uses [misaki](https://github.com/hexgrad/misaki) (spaCy tokenization + dictionary + neural fallback)
2. **Phonemes -> IDs**: Mapped via Kokoro vocabulary
3. **Style Encoding**: Voice-specific style vector (voicepack `.pt` files)
4. **Duration Prediction**: `ProsodyPredictor` / `duration_proj` predicts per-phoneme frame counts (`pred_dur`)
5. **Alignment Matrix**: `pred_dur` -> binary alignment matrix [tokens x frames]
6. **Audio Synthesis**: Decoder (StyleTTS 2 + iSTFTNet) generates waveform at 24kHz

## Word-Level Timestamps (Native)

Kokoro v1.0+ provides word timestamps directly from its duration predictor. The `Result` object contains:

- `graphemes` — original text segment
- `phonemes` — phoneme string
- `tokens` — list of `MToken` objects with **`start_ts`** and **`end_ts`** (in seconds)
- `output.pred_dur` — raw predicted durations per phoneme (in frames)
- `audio` — numpy array (24kHz)

The `Pipeline.join_timestamps(tokens, pred_dur)` method maps frame-level durations back to word tokens.

### Usage

```python
from kokoro import KPipeline

pipeline = KPipeline(lang_code='a')  # 'a' = American English

for result in pipeline(text, voice='af_heart', speed=1.0):
    for token in result.tokens:
        if token.start_ts is not None:
            print(f"{token.text} [{token.start_ts:.2f}-{token.end_ts:.2f}]")
    audio = result.audio  # numpy array at 24kHz
```

### Accuracy

- Good but not perfect — timing can be off by ~50-200ms for some words
- Community reports: Kokoro produced `[0.238-0.302]` for "tell" while reference showed `[0.230-0.510]`
- For word highlighting at ~200-300ms per word, this is acceptable
- **English only** — non-English may not produce timestamps

### Fallback: Forced Alignment

If native accuracy is insufficient:

| Method | Speed | Accuracy |
|--------|-------|----------|
| Kokoro native `pred_dur` | Zero overhead | Good (~50-200ms variance) |
| torchaudio wav2vec2 forced alignment | ~real-time | High |
| ctc-forced-aligner | Fast | High |
| WhisperX | Moderate | Good |
| Montreal Forced Aligner | Slow | Highest |

## Wrapper Libraries

| Library | Language | Timestamps? | Notes |
|---------|----------|-------------|-------|
| **[RealtimeTTS](https://github.com/KoljaB/RealtimeTTS)** | Python | Yes — `on_word` callback | Best for real-time playback + highlighting |
| **[Kokoros](https://github.com/lucasjinreal/Kokoros)** | Rust | Yes — `--timestamps` flag | High performance |
| **[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)** | Python/FastAPI | Yes — `/dev/captioned_speech` | HTTP API with timestamps |
| **[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)** | Python/ONNX | No | Audio only |

## Kokoro-FastAPI (Recommended Server)

Provides an HTTP API with word timestamps:

```
POST /dev/captioned_speech
{
  "model": "kokoro",
  "voice": "af_bella",
  "input": "Hello world",
  "response_format": "wav"
}

Response:
{
  "audio": "<base64-encoded-wav>",
  "timestamps": [
    {"word": "Hello", "start_time": 0.35, "end_time": 0.6},
    {"word": "world", "start_time": 0.6, "end_time": 1.1}
  ]
}
```

Run with Docker:
```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

Or install locally:
```bash
pip install kokoro-fastapi
uvicorn kokoro_fastapi:app --port 8880
```
