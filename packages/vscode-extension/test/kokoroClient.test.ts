import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KokoroClient } from "../src/tts/kokoroClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid CaptionedSpeechResponse payload. */
function validPayload() {
  return {
    audio: "base64encodedaudio==",
    timestamps: [
      { word: "Hello", start_time: 0.0, end_time: 0.3 },
      { word: "world", start_time: 0.35, end_time: 0.7 },
    ],
  };
}

/** Create a minimal Response-like object that fetch can return. */
function fakeResponse(
  body: unknown,
  { status = 200, ok }: { status?: number; ok?: boolean } = {},
): Response {
  const resolved = ok ?? (status >= 200 && status < 300);
  return {
    ok: resolved,
    status,
    json: () => Promise.resolve(body),
    // Provide just enough of the Response interface for the code under test.
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("KokoroClient", () => {
  const SERVER_URL = "http://localhost:8880";
  const VOICE = "af_heart";
  const SPEED = 1.0;

  let client: KokoroClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    client = new KokoroClient(SERVER_URL, VOICE, SPEED);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // isAvailable()
  // -----------------------------------------------------------------------

  describe("isAvailable()", () => {
    it("returns true when server responds 200", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({}, { status: 200 }));

      const result = await client.isAvailable();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER_URL}/health`);
    });

    it("returns false when server responds 500", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({}, { status: 500, ok: false }));

      const result = await client.isAvailable();

      expect(result).toBe(false);
    });

    it("returns false when fetch throws (connection refused)", async () => {
      fetchMock.mockRejectedValueOnce(new Error("fetch failed: ECONNREFUSED"));

      const result = await client.isAvailable();

      expect(result).toBe(false);
    });

    it("returns false on timeout", async () => {
      const timeoutError = new DOMException("The operation was aborted.", "TimeoutError");
      fetchMock.mockRejectedValueOnce(timeoutError);

      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // synthesize()
  // -----------------------------------------------------------------------

  describe("synthesize()", () => {
    it("returns audio and timestamps on successful synthesis", async () => {
      const payload = validPayload();
      fetchMock.mockResolvedValueOnce(fakeResponse(payload, { status: 200 }));

      const result = await client.synthesize("Hello world");

      expect(result).toEqual(payload);
      expect(result.audio).toBe("base64encodedaudio==");
      expect(result.timestamps).toHaveLength(2);
      expect(result.timestamps[0]).toEqual({ word: "Hello", start_time: 0.0, end_time: 0.3 });
      expect(result.timestamps[1]).toEqual({ word: "world", start_time: 0.35, end_time: 0.7 });
    });

    it('throws with "msv tts-server start" suggestion on connection refused', async () => {
      fetchMock.mockRejectedValueOnce(new Error("fetch failed: ECONNREFUSED"));

      await expect(client.synthesize("Hello")).rejects.toThrow("msv tts-server start");
      await expect(
        // Re-mock because the first call consumed it.
        (() => {
          fetchMock.mockRejectedValueOnce(new Error("fetch failed: ECONNREFUSED"));
          return client.synthesize("Hello");
        })(),
      ).rejects.toThrow(/Could not connect to Kokoro TTS server/);
    });

    it("throws with HTTP status when server returns 500", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({}, { status: 500, ok: false }));

      await expect(client.synthesize("Hello")).rejects.toThrow("HTTP 500");
    });

    it("includes detail in error when server returns 500 with detail", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ detail: "Model not loaded" }, { status: 500, ok: false }),
      );

      const error = await client.synthesize("Hello").catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("HTTP 500");
      expect(error.message).toContain("Model not loaded");
    });

    it("throws parse error when server returns invalid JSON", async () => {
      const badResponse = {
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(badResponse);

      await expect(client.synthesize("Hello")).rejects.toThrow(/Failed to parse JSON response/);
    });

    it("throws shape error when response is missing audio", async () => {
      const payload = { timestamps: [{ word: "Hello", start_time: 0, end_time: 0.3 }] };
      fetchMock.mockResolvedValueOnce(fakeResponse(payload, { status: 200 }));

      await expect(client.synthesize("Hello")).rejects.toThrow(/unexpected response shape/);
    });

    it("throws shape error when timestamps have wrong structure", async () => {
      const payload = {
        audio: "base64==",
        timestamps: [{ text: "Hello", begin: 0, end: 0.3 }], // wrong keys
      };
      fetchMock.mockResolvedValueOnce(fakeResponse(payload, { status: 200 }));

      await expect(client.synthesize("Hello")).rejects.toThrow(/unexpected response shape/);
    });

    it("throws timeout error on request timeout", async () => {
      const timeoutError = new DOMException("The operation was aborted.", "TimeoutError");
      fetchMock.mockRejectedValueOnce(timeoutError);

      const error = await client.synthesize("Hello").catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/timed out/i);
      expect(error.message).toContain(SERVER_URL);
    });

    it("sends correct request body (model, input, voice, speed, response_format)", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse(validPayload(), { status: 200 }));

      await client.synthesize("Test input");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe(`${SERVER_URL}/dev/captioned_speech`);
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });

      const sentBody = JSON.parse(options.body);
      expect(sentBody).toEqual({
        model: "kokoro",
        input: "Test input",
        voice: VOICE,
        speed: SPEED,
        response_format: "mp3",
        stream: false,
      });
    });

    it("strips trailing slash from serverUrl", async () => {
      const clientWithSlash = new KokoroClient("http://localhost:8880/", VOICE, SPEED);
      fetchMock.mockResolvedValueOnce(fakeResponse(validPayload(), { status: 200 }));

      await clientWithSlash.synthesize("Hello");

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:8880/dev/captioned_speech");
      expect(url).not.toContain("//dev");
    });
  });
});
