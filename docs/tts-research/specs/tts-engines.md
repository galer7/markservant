# TTS Engine Comparison

## Open-Source Models (2025-2026)

| Model | Params | License | Quality | Best For |
|-------|--------|---------|---------|----------|
| **Chatterbox** (Resemble AI) | 350M | MIT | Excellent — 63.8% preferred over ElevenLabs in blind tests | Best overall, voice cloning from 6s, 23 languages |
| **Kokoro** (hexgrad) | 82M | Apache 2.0 | Excellent for size — #3 on HF TTS Arena | Tiny, runs on CPU, 8 languages, 26 voices |
| **Fish Audio / OpenAudio S1** | 4B | Open | #1 on TTS-Arena2 | Fine-grained emotion control |
| **Qwen3-TTS** (Alibaba, Jan 2026) | 1.7B/0.6B | Apache 2.0 | Beats ElevenLabs on benchmarks | 97ms first-packet latency, voice cloning from 3s |
| **CosyVoice 3.0** (Alibaba) | — | Open | Excellent | 150ms streaming, 18+ Chinese dialects |
| **F5-TTS** | — | Open | Very good | Flow matching architecture |
| **StyleTTS 2** | — | Open | Very good | First OSS to match human quality on LJSpeech |
| **Piper** | Tiny | MIT | Good (not premium) | Raspberry Pi, fully offline, ONNX |
| **Bark** (Suno) | — | MIT | Good | Non-speech audio (laughter, music) inline |
| **Coqui/XTTS-v2** | — | Open | Good but aging | Multilingual voice cloning, 17 languages |

### Key Takeaway

Open-source TTS has reached and surpassed commercial quality in 2025-2026. Chatterbox, Fish Audio S1, Qwen3-TTS, and Kokoro all compete at or above ElevenLabs level.

## Commercial Providers

| Provider | Free Tier | Paid Starting | Quality |
|----------|-----------|---------------|---------|
| **Edge TTS** (unofficial) | Unlimited* | Free | Very good |
| **ElevenLabs** | 10K chars/mo | $5/mo | Excellent (industry leader) |
| **OpenAI GPT-4o mini TTS** | — | ~$0.015/min | Excellent |
| **Amazon Polly** | 5M chars/mo (12mo) | $4-16/M chars | Good |
| **Google Cloud TTS** | 4M chars/mo | $4-16/M chars | Good |
| **Azure TTS** | 500K chars/mo | $16/M chars | Very good |
| **Play.ht** | 12.5K chars/mo | $19/mo | Very good |

*Edge TTS is free via the `edge-tts` library but operates in a legal gray area and breaks periodically.

## Our Choice: Kokoro (82M)

Reasons:
- **82M params** — runs on CPU, trivially fast on M1 Pro with MPS
- **Apache 2.0** — fully commercial use allowed
- **Native word timestamps** — `pred_dur` output provides word-level timing (critical for highlighting)
- **No network dependency** — fully local, no rate limits, no breakage risk
- **Good enough quality** — #3 on HuggingFace TTS Arena, 26 voice options
- **Active development** — v1.0 released with timestamp support
