/**
 * HTTP client for the Kokoro-FastAPI TTS server.
 *
 * Communicates with a locally-running Kokoro Docker container that exposes
 * an OpenAI-compatible TTS API with word-level timestamps.
 */

import type { CaptionedSpeechResponse } from "./types.js";

/** Timeout for the health-check request (ms). */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

/** Timeout for the synthesis request (ms). TTS generation can be slow for long texts. */
const SYNTHESIS_TIMEOUT_MS = 60_000;

/** Default model identifier used by Kokoro-FastAPI. */
const DEFAULT_MODEL = "kokoro";

export class KokoroClient {
  private readonly serverUrl: string;
  private readonly voice: string;
  private readonly speed: number;

  /**
   * @param serverUrl  Base URL of the Kokoro-FastAPI server, e.g. `http://localhost:8880`.
   *                   Trailing slashes are stripped automatically.
   * @param voice      Voice identifier to use for synthesis (e.g. `af_heart`).
   * @param speed      Playback speed multiplier (1.0 = normal).
   */
  constructor(serverUrl: string, voice: string, speed: number) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.voice = voice;
    this.speed = speed;
  }

  /**
   * Check whether the Kokoro-FastAPI server is reachable and healthy.
   *
   * Sends a GET request to the server root and considers any 2xx response as healthy.
   * Returns `false` (rather than throwing) on any network or timeout error.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Synthesize speech from the given text, returning base64-encoded MP3 audio
   * together with per-word timestamps.
   *
   * @param text  The plain text to synthesize.
   * @returns     Base64 audio and an array of word-level timestamps.
   * @throws      If the server is unreachable, returns a non-OK status, or the
   *              response body cannot be parsed.
   */
  async synthesize(text: string): Promise<CaptionedSpeechResponse> {
    const url = `${this.serverUrl}/dev/captioned_speech`;
    const body = {
      model: DEFAULT_MODEL,
      input: text,
      voice: this.voice,
      speed: this.speed,
      response_format: "mp3",
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new Error(buildConnectionErrorMessage(this.serverUrl, error));
    }

    if (!response.ok) {
      let detail = "";
      try {
        const errorBody = (await response.json()) as { detail?: string };
        if (errorBody.detail) {
          detail = `: ${errorBody.detail}`;
        }
      } catch {
        // Could not parse error body -- fall through with empty detail.
      }
      throw new Error(
        `Kokoro TTS server returned HTTP ${response.status}${detail}. ` +
          `Ensure the server is running correctly at ${this.serverUrl}.`,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Failed to parse JSON response from Kokoro TTS server. " +
          "The server may be returning an unexpected response format.",
      );
    }

    if (!isValidCaptionedSpeechResponse(data)) {
      throw new Error(
        "Kokoro TTS server returned an unexpected response shape. " +
          "Expected { audio: string, timestamps: Array<{ word, start_time, end_time }> }.",
      );
    }

    return data;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a user-friendly error message when a fetch to the Kokoro server fails.
 */
function buildConnectionErrorMessage(serverUrl: string, error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error);

  // Detect common connection-refused / timeout patterns.
  const isConnectionRefused =
    cause.includes("ECONNREFUSED") || cause.includes("fetch failed") || cause.includes("network");
  const isTimeout =
    cause.includes("abort") || cause.includes("timeout") || cause.includes("TimeoutError");

  if (isTimeout) {
    return (
      `Kokoro TTS request timed out after ${SYNTHESIS_TIMEOUT_MS / 1000}s. ` +
      `The server at ${serverUrl} may be overloaded or processing a very long text. ` +
      "Try again with a shorter passage or check the server logs."
    );
  }

  if (isConnectionRefused) {
    return (
      `Could not connect to Kokoro TTS server at ${serverUrl}. ` +
      "Is the Docker container running? Start it with:\n\n" +
      "  msv tts-server start\n\n" +
      `(Underlying error: ${cause})`
    );
  }

  return (
    `Unexpected error communicating with Kokoro TTS server at ${serverUrl}: ${cause}. ` +
    "If the server is not running, start it with:\n\n" +
    "  msv tts-server start"
  );
}

/**
 * Runtime type guard for the captioned speech response shape.
 */
function isValidCaptionedSpeechResponse(data: unknown): data is CaptionedSpeechResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;
  if (typeof obj.audio !== "string") {
    return false;
  }

  if (!Array.isArray(obj.timestamps)) {
    return false;
  }

  // Validate the first few timestamps to avoid iterating a huge array.
  const samplesToCheck = Math.min(obj.timestamps.length, 5);
  for (let i = 0; i < samplesToCheck; i++) {
    const ts = obj.timestamps[i] as Record<string, unknown>;
    if (
      typeof ts.word !== "string" ||
      typeof ts.start_time !== "number" ||
      typeof ts.end_time !== "number"
    ) {
      return false;
    }
  }

  return true;
}
