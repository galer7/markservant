/**
 * Splits stripped plain text into chunks suitable for TTS synthesis (~500 chars each).
 *
 * Splitting strategy (in priority order):
 *  1. Split on paragraph boundaries (`\n\n`)
 *  2. Group consecutive paragraphs up to maxChunkSize
 *  3. If a single paragraph exceeds maxChunkSize, split on sentence boundaries (`. `)
 *  4. If a single sentence exceeds maxChunkSize, split on the nearest space before the limit
 *  5. If no space exists (a single very long word), force-split at maxChunkSize
 *
 * Each chunk carries its slice of the offset map with plainStart/plainEnd adjusted
 * to be relative to the chunk start.
 */

import type { OffsetMapping, StrippedMarkdown, TextChunk } from "./types.js";

/**
 * Return the offset map entries that overlap with [start, end) in the full plain text,
 * clipped to the range and adjusted so plainStart/plainEnd are relative to `start`.
 */
function sliceOffsetMap(offsetMap: OffsetMapping[], start: number, end: number): OffsetMapping[] {
  const result: OffsetMapping[] = [];

  for (const entry of offsetMap) {
    // Skip entries entirely before or after the range
    if (entry.plainEnd <= start || entry.plainStart >= end) {
      continue;
    }

    // Clip the plain range to [start, end)
    const clippedPlainStart = Math.max(entry.plainStart, start);
    const clippedPlainEnd = Math.min(entry.plainEnd, end);

    // Compute proportional source offsets for the clipped region
    const entryPlainLen = entry.plainEnd - entry.plainStart;
    const entrySourceLen = entry.sourceEnd - entry.sourceStart;

    let clippedSourceStart: number;
    let clippedSourceEnd: number;

    if (entryPlainLen === 0) {
      // Zero-length plain mapping: keep source offsets as-is
      clippedSourceStart = entry.sourceStart;
      clippedSourceEnd = entry.sourceEnd;
    } else {
      // Linearly interpolate source offsets based on the clipped plain range
      const startRatio = (clippedPlainStart - entry.plainStart) / entryPlainLen;
      const endRatio = (clippedPlainEnd - entry.plainStart) / entryPlainLen;
      clippedSourceStart = entry.sourceStart + Math.round(startRatio * entrySourceLen);
      clippedSourceEnd = entry.sourceStart + Math.round(endRatio * entrySourceLen);
    }

    result.push({
      plainStart: clippedPlainStart - start,
      plainEnd: clippedPlainEnd - start,
      sourceStart: clippedSourceStart,
      sourceEnd: clippedSourceEnd,
    });
  }

  return result;
}

/**
 * Split a segment of text that fits within a single paragraph (no `\n\n`) on
 * sentence boundaries. Returns an array of substring ranges [start, end) relative
 * to the full plain text.
 */
function splitParagraphOnSentences(
  text: string,
  paragraphStart: number,
  maxChunkSize: number,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  let cursor = 0;
  while (cursor < text.length) {
    if (text.length - cursor <= maxChunkSize) {
      // Remaining text fits in one chunk
      ranges.push({
        start: paragraphStart + cursor,
        end: paragraphStart + text.length,
      });
      break;
    }

    // Find the last sentence boundary (". ") within the limit
    const window = text.substring(cursor, cursor + maxChunkSize);
    let splitPos = -1;

    // Search for sentence-ending patterns: period/exclamation/question followed by space
    for (let i = window.length - 1; i >= 0; i--) {
      if (
        (window[i] === "." || window[i] === "!" || window[i] === "?") &&
        i + 1 < window.length &&
        window[i + 1] === " "
      ) {
        // Split after the punctuation (include the period, exclude the space)
        splitPos = i + 1;
        break;
      }
    }

    if (splitPos > 0) {
      ranges.push({
        start: paragraphStart + cursor,
        end: paragraphStart + cursor + splitPos,
      });
      // Skip the trailing space after the sentence boundary
      cursor += splitPos;
      // Skip whitespace between sentences
      while (cursor < text.length && text[cursor] === " ") {
        cursor++;
      }
      continue;
    }

    // No sentence boundary found; split on the nearest space before the limit
    splitPos = window.lastIndexOf(" ");

    if (splitPos > 0) {
      ranges.push({
        start: paragraphStart + cursor,
        end: paragraphStart + cursor + splitPos,
      });
      cursor += splitPos;
      // Skip whitespace
      while (cursor < text.length && text[cursor] === " ") {
        cursor++;
      }
      continue;
    }

    // No space at all -- force split at maxChunkSize (very long word)
    ranges.push({
      start: paragraphStart + cursor,
      end: paragraphStart + cursor + maxChunkSize,
    });
    cursor += maxChunkSize;
  }

  return ranges;
}

/**
 * Split stripped markdown into chunks suitable for TTS synthesis.
 *
 * @param stripped - The result of stripping markdown to plain text
 * @param maxChunkSize - Maximum characters per chunk (default 500)
 * @returns Array of TextChunk objects ready for TTS
 */
export function splitIntoChunks(
  stripped: StrippedMarkdown,
  maxChunkSize: number = 500,
): TextChunk[] {
  const { plainText, offsetMap } = stripped;

  // Handle empty text
  if (!plainText || plainText.length === 0) {
    return [];
  }

  // Step 1: Split into paragraphs on double-newline boundaries.
  // We keep track of each paragraph's absolute position in the full text.
  const paragraphs: Array<{ text: string; start: number }> = [];
  const rawParagraphs = plainText.split("\n\n");
  let pos = 0;
  for (let i = 0; i < rawParagraphs.length; i++) {
    const pText = rawParagraphs[i];
    paragraphs.push({ text: pText, start: pos });
    pos += pText.length;
    if (i < rawParagraphs.length - 1) {
      // Account for the "\n\n" separator
      pos += 2;
    }
  }

  // Step 2: Build ranges by grouping paragraphs up to maxChunkSize,
  // or sub-splitting paragraphs that exceed the limit.
  const ranges: Array<{ start: number; end: number }> = [];

  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentLen = 0;

  function flushCurrent(): void {
    if (currentStart !== null && currentEnd !== null) {
      ranges.push({ start: currentStart, end: currentEnd });
      currentStart = null;
      currentEnd = null;
      currentLen = 0;
    }
  }

  for (const para of paragraphs) {
    // Skip empty paragraphs (can happen with multiple consecutive \n\n)
    if (para.text.length === 0) {
      continue;
    }

    if (para.text.length > maxChunkSize) {
      // This paragraph is too long on its own. Flush anything accumulated,
      // then sub-split this paragraph.
      flushCurrent();

      const subRanges = splitParagraphOnSentences(para.text, para.start, maxChunkSize);
      for (const sr of subRanges) {
        ranges.push(sr);
      }
      continue;
    }

    // Try to add this paragraph to the current accumulator.
    // The "+2" accounts for the "\n\n" separator between paragraphs in the chunk.
    const separatorLen = currentStart !== null ? 2 : 0;
    const newLen = currentLen + separatorLen + para.text.length;

    if (newLen <= maxChunkSize) {
      // Fits -- accumulate
      if (currentStart === null) {
        currentStart = para.start;
      }
      currentEnd = para.start + para.text.length;
      currentLen = newLen;
    } else {
      // Doesn't fit -- flush and start a new accumulation
      flushCurrent();
      currentStart = para.start;
      currentEnd = para.start + para.text.length;
      currentLen = para.text.length;
    }
  }

  // Flush the last accumulated group
  flushCurrent();

  // Step 3: Build TextChunk objects from the computed ranges.
  const chunks: TextChunk[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const text = plainText.substring(range.start, range.end);
    const chunkOffsetMap = sliceOffsetMap(offsetMap, range.start, range.end);

    chunks.push({
      text,
      index: i,
      offsetMap: chunkOffsetMap,
      plainOffset: range.start,
    });
  }

  return chunks;
}
