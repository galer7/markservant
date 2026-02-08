"""
Thin FastAPI wrapper around mlx-audio's Kokoro TTS pipeline.

Exposes the same /dev/captioned_speech endpoint as Kokoro-FastAPI,
returning base64-encoded WAV audio with word-level timestamps.

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

# Lazy-load the model on first request to speed up server startup
_model = None


def get_model():
    global _model
    if _model is None:
        from mlx_audio.tts.utils import load_model

        _model = load_model("mlx-community/Kokoro-82M-bf16")
    return _model


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
        model = get_model()

        # model.generate() is a generator yielding GenerationResult objects
        # Each result has .audio (mx.array), .sample_rate (int), etc.
        audio_segments = []
        sample_rate = 24000

        for result in model.generate(
            text=req.input,
            voice=req.voice,
            speed=req.speed,
            lang_code="a",
        ):
            audio_segments.append(np.array(result.audio))
            sample_rate = result.sample_rate

        if not audio_segments:
            raise HTTPException(status_code=500, detail="No audio generated")

        # Concatenate all segments into a single audio array
        audio_array = np.concatenate(audio_segments)

        # Encode audio as WAV
        buf = io.BytesIO()
        sf.write(buf, audio_array, sample_rate, format="WAV")
        audio_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        # Estimate word-level timestamps based on audio duration and word count.
        # A future improvement could extract real timestamps from Kokoro's
        # duration predictor (pred_dur) for more accurate word alignment.
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
