# Edge TTS: Rate Limiting and Breakage History

## How It Works

The `edge-tts` Python library (https://github.com/rany2/edge-tts) reverse-engineers the WebSocket protocol that Microsoft Edge's "Read Aloud" uses. It accesses the same voices (including `en-US-RyanMultilingualNeural`) without an API key.

- Same `TRUSTED_CLIENT_TOKEN` hardcoded in Edge: `6A5AA1D4EAFF4E9FB37E23D68491D6F4`
- Spoofs Edge User-Agent and generates the `Sec-MS-GEC` DRM token
- 10K+ GitHub stars, v7.2.7 (Dec 2025)

## Rate Limits

| Limit | Value |
|-------|-------|
| Parallel connections before 429 | ~500 simultaneous |
| 429 block duration | 5 minutes |
| Text per chunk | 4,096 bytes (auto-split) |
| Audio per request | ~10 minutes (server-side) |
| Daily/monthly cap | None documented |
| Requests per minute | "High enough you won't hit accidentally" — author |

For personal use (reading markdown files), rate limits are not a concern.

## Breakage History

This is the real risk — not rate limits, but periodic breakages:

| Date | Issue | Duration | Cause |
|------|-------|----------|-------|
| Oct 2024 | 403 errors | Weeks | Microsoft added `Sec-MS-GEC` DRM token requirement |
| Aug 2025 | 403 errors, 40+ hours | Days | Microsoft migrated endpoints from `speech.platform.bing.com` to `api.msedgeservices.com` |
| Dec 2025 | No audio received | Days | Server-side change, fixed in v7.2.4 |
| Jan 2026 | 503 errors after ~6 requests | Days | Fixed in v7.2.7 |

The author on Hacker News: *"it's a very bad idea to use this library for anything serious/mission critical"* and *"there have been occasions where the library was blocked and it took a few weeks to workaround said block."*

## Why We Chose Kokoro Instead

- **No network dependency** — fully local, zero breakage risk
- **No legal gray area** — Apache 2.0 licensed
- **No rate limits** — runs on your own hardware
- **Comparable quality** — both ranked highly, Kokoro is #3 on HF TTS Arena
- **Native word timestamps** — Kokoro provides `start_ts`/`end_ts` per word from its duration predictor

Edge TTS's only advantage is being free without any setup. But the recurring breakages make it unsuitable as a primary engine.
