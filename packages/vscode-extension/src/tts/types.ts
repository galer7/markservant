/**
 * Shared type definitions for the MarkServant TTS extension.
 *
 * These types model the full pipeline: markdown source -> plain text -> TTS synthesis -> word highlighting.
 */

/** A mapping from a range in stripped plain text back to a range in the original markdown source. */
export interface OffsetMapping {
  /** Start offset in the plain text string */
  plainStart: number;
  /** End offset in the plain text string */
  plainEnd: number;
  /** Start offset in the original markdown source */
  sourceStart: number;
  /** End offset in the original markdown source */
  sourceEnd: number;
}

/** Result of stripping markdown to plain text. */
export interface StrippedMarkdown {
  /** The plain text with all markdown syntax removed */
  plainText: string;
  /** Mappings from plain text offsets back to source offsets */
  offsetMap: OffsetMapping[];
}

/** A chunk of plain text ready to be sent to the TTS engine. */
export interface TextChunk {
  /** The plain text content of this chunk */
  text: string;
  /** Zero-based index of this chunk */
  index: number;
  /** Offset map entries relevant to this chunk (with plainStart/plainEnd relative to the chunk) */
  offsetMap: OffsetMapping[];
  /** Start offset of this chunk within the full plain text */
  plainOffset: number;
}

/** A word timestamp returned by Kokoro-FastAPI's /dev/captioned_speech endpoint. */
export interface WordTimestamp {
  /** The word as spoken by TTS */
  word: string;
  /** Start time in seconds relative to chunk audio start */
  start_time: number;
  /** End time in seconds relative to chunk audio start */
  end_time: number;
}

/** Response from Kokoro-FastAPI /dev/captioned_speech */
export interface CaptionedSpeechResponse {
  /** Base64-encoded audio data */
  audio: string;
  /** Per-word timestamps */
  timestamps: WordTimestamp[];
}

/** A word with both its TTS timing and its editor location resolved. */
export interface MappedWord {
  /** The word text */
  word: string;
  /** Audio start time in seconds (absolute, across all chunks) */
  startTime: number;
  /** Audio end time in seconds (absolute, across all chunks) */
  endTime: number;
  /** Start offset in the original markdown source document */
  sourceStart: number;
  /** End offset in the original markdown source document */
  sourceEnd: number;
}

/** Synthesized audio chunk ready for playback. */
export interface SynthesizedChunk {
  /** Base64-encoded audio data (mp3) */
  audioBase64: string;
  /** Words with timing + source position info */
  mappedWords: MappedWord[];
  /** Index of this chunk */
  index: number;
}

/** Messages sent from the webview to the extension host. */
export type WebviewToExtensionMessage =
  | { type: "highlightWord"; index: number }
  | { type: "chunkEnded"; chunkIndex: number }
  | { type: "playbackStarted" }
  | { type: "playbackPaused" }
  | { type: "playbackStopped" }
  | { type: "playbackRateChanged"; rate: number }
  | { type: "ready" }
  | { type: "error"; message: string };

/** Messages sent from the extension host to the webview. */
export type ExtensionToWebviewMessage =
  | { type: "loadAudio"; audioBase64: string; chunkIndex: number; totalChunks: number }
  | { type: "loading"; message: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "setTimestamps"; timestamps: WordTimestamp[] }
  | { type: "setPlaybackRate"; rate: number }
  | { type: "synthProgress"; current: number; total: number; avgMs: number; remainingMs: number }
  | { type: "synthComplete" };
