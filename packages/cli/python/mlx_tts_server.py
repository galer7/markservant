"""
Thin FastAPI wrapper around mlx-audio's Kokoro TTS pipeline.

Exposes the same /dev/captioned_speech endpoint as Kokoro-FastAPI,
returning base64-encoded MP3 audio with word-level timestamps.

Usage:
    uvicorn mlx_tts_server:app --host 127.0.0.1 --port 8880
"""

import base64
import io
import sys

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI()

# Lazy-load the pipeline on first request to speed up server startup
_pipeline = None
_tokenizer = None


def get_pipeline():
    global _pipeline, _tokenizer
    if _pipeline is None:
        from mlx_audio.tts.generate import generate_audio
        from mlx_audio.tts.utils import load_model

        _pipeline = load_model("prince-canuma/Kokoro-82M")
        _tokenizer = None  # tokenizer loaded inside generate_audio
    return _pipeline


class CaptionedSpeechRequest(BaseModel):
    model: str = "kokoro"
    input: str
    voice: str = "af_heart"
    speed: float = 1.0
    response_format: str = "mp3"
    stream: bool = False


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/models")
async def models():
    return {"data": [{"id": "kokoro", "object": "model"}]}


@app.post("/dev/captioned_speech")
async def captioned_speech(req: CaptionedSpeechRequest):
    try:
        from mlx_audio.tts.generate import generate_audio

        # Generate audio with timestamps
        result = generate_audio(
            text=req.input,
            model_name="prince-canuma/Kokoro-82M",
            voice=req.voice,
            speed=req.speed,
        )

        # result is a tuple: (audio_array, sample_rate)
        # or a generator for streaming — we need non-streaming
        if hasattr(result, "__iter__") and not isinstance(result, (np.ndarray, tuple)):
            # Collect from generator
            audio_segments = list(result)
            if len(audio_segments) == 0:
                raise HTTPException(status_code=500, detail="No audio generated")
            # Each segment is (audio_array, sample_rate) or similar
            audio_array = (
                audio_segments[0][0]
                if isinstance(audio_segments[0], tuple)
                else audio_segments[0]
            )
            sample_rate = (
                audio_segments[0][1]
                if isinstance(audio_segments[0], tuple)
                else 24000
            )
        elif isinstance(result, tuple):
            audio_array, sample_rate = result
        else:
            audio_array = result
            sample_rate = 24000

        # Encode audio as WAV (soundfile doesn't support MP3 natively)
        buf = io.BytesIO()
        sf.write(buf, audio_array, sample_rate, format="WAV")
        audio_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        # Extract word-level timestamps from Kokoro's duration predictor.
        #
        # NOTE: This is the critical part that requires investigation of
        # mlx-audio's internal API. The Kokoro model produces `pred_dur`
        # (predicted durations per phoneme), from which we can compute:
        #   start_ts = left / 80.0
        #   end_ts = (left + 2 * token_dur) / 80.0
        #
        # If mlx-audio doesn't expose pred_dur directly, we'll need to:
        # 1. Fork or patch the generate_audio function to return durations
        # 2. OR use a simple word-count-based estimation as a fallback
        #
        # For now, we use estimated timestamps based on audio duration and
        # word count. This will be replaced with real duration predictor
        # timestamps once we verify the mlx-audio internal API.
        timestamps = _estimate_word_timestamps(
            req.input, len(audio_array) / sample_rate
        )

        return JSONResponse(
            {
                "audio": audio_b64,
                "timestamps": timestamps,
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _estimate_word_timestamps(text: str, total_duration: float) -> list[dict]:
    """
    Estimate word-level timestamps by distributing duration proportional
    to character count. This is a fallback — real timestamps from the
    duration predictor are more accurate.
    """
    words = text.split()
    if not words:
        return []

    # Distribute time proportional to character length
    total_chars = sum(len(w) for w in words)
    if total_chars == 0:
        return []

    timestamps = []
    current_time = 0.0
    for word in words:
        word_duration = (len(word) / total_chars) * total_duration
        timestamps.append(
            {
                "word": word,
                "start_time": round(current_time, 3),
                "end_time": round(current_time + word_duration, 3),
            }
        )
        current_time += word_duration

    return timestamps


if __name__ == "__main__":
    import uvicorn

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8880
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
