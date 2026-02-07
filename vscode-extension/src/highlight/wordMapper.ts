/**
 * Maps TTS word timestamps back to positions in the original markdown source document.
 *
 * Pipeline: TTS word timestamps -> plain text positions -> source document offsets.
 *
 * The TTS engine returns words with timing information relative to the chunk's audio.
 * This module resolves each word to an absolute source position so the editor can
 * highlight the correct range while audio plays.
 */

import type {
  MappedWord,
  OffsetMapping,
  TextChunk,
  WordTimestamp,
} from "../tts/types.js";

/**
 * Given a range [plainStart, plainEnd) in plain text, find the corresponding
 * range in the original markdown source document by walking the offset map.
 *
 * The offset map contains entries that describe how contiguous runs of plain
 * text map back to (potentially non-contiguous) ranges in the source. We find
 * all entries that overlap with the requested plain-text range and return the
 * source span that covers them all.
 */
export function plainOffsetToSource(
  plainStart: number,
  plainEnd: number,
  offsetMap: OffsetMapping[]
): { sourceStart: number; sourceEnd: number } {
  let sourceStart = -1;
  let sourceEnd = -1;

  for (const entry of offsetMap) {
    // Check if this mapping entry overlaps with the requested plain-text range.
    // Two ranges [a, b) and [c, d) overlap when a < d && c < b.
    if (plainStart < entry.plainEnd && plainEnd > entry.plainStart) {
      // Compute how far into this entry our range starts and ends.
      const overlapPlainStart = Math.max(plainStart, entry.plainStart);
      const overlapPlainEnd = Math.min(plainEnd, entry.plainEnd);

      // Translate the overlap back to source coordinates.
      // The offset within the entry is proportional: if plainStart is 2 chars
      // into the entry, sourceStart is also 2 chars into the source range.
      const entrySourceStart =
        entry.sourceStart + (overlapPlainStart - entry.plainStart);
      const entrySourceEnd =
        entry.sourceStart + (overlapPlainEnd - entry.plainStart);

      if (sourceStart === -1 || entrySourceStart < sourceStart) {
        sourceStart = entrySourceStart;
      }
      if (entrySourceEnd > sourceEnd) {
        sourceEnd = entrySourceEnd;
      }
    }
  }

  // If no mapping was found (should not happen in normal operation), fall back
  // to returning the plain offsets unchanged. This prevents crashes if the
  // offset map is incomplete.
  if (sourceStart === -1) {
    return { sourceStart: plainStart, sourceEnd: plainEnd };
  }

  return { sourceStart, sourceEnd };
}

// ---------------------------------------------------------------------------
// Internal helpers for fuzzy word matching
// ---------------------------------------------------------------------------

/**
 * Normalize a string for fuzzy comparison: lowercase, strip common punctuation
 * that TTS engines attach or remove, collapse whitespace.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // smart quotes -> ascii
    .replace(/[\u2014\u2013]/g, "-") // em/en dash -> hyphen
    .replace(/[.,!?;:"""()[\]{}<>]/g, "") // strip punctuation
    .trim();
}

/**
 * Strip all punctuation characters from a string, returning only the
 * "word content" part. Useful for matching when TTS attaches or drops
 * trailing punctuation.
 */
function stripPunctuation(s: string): string {
  return s.replace(/[^\p{L}\p{N}'-]/gu, "");
}

/**
 * Check whether `text` starting at `pos` matches `target` (case-insensitive),
 * possibly followed by punctuation. Returns the length of the match in `text`
 * (which may be longer than `target` if punctuation is consumed), or 0 if no
 * match.
 */
function fuzzyMatchAt(text: string, pos: number, target: string): number {
  const normTarget = normalize(target);
  if (normTarget.length === 0) {
    return 0;
  }

  // Try exact substring match first (case-insensitive).
  const slice = text.slice(pos, pos + target.length);
  if (normalize(slice) === normTarget) {
    return target.length;
  }

  // The TTS word may include trailing punctuation not present in the plain
  // text, or the plain text may have punctuation that the TTS dropped.
  // Walk forward in `text` from `pos`, consuming characters that belong to
  // the normalized target plus any interspersed punctuation.
  let ti = 0; // index into normTarget
  let matchLen = 0; // chars consumed from text

  for (let i = pos; i < text.length && ti < normTarget.length; i++) {
    const ch = text[i];
    const normCh = normalize(ch);

    if (normCh.length === 0) {
      // This character normalizes to nothing (punctuation) -- skip it in
      // the text but don't advance in the target.
      matchLen++;
      continue;
    }

    if (normCh === normTarget[ti]) {
      ti++;
      matchLen++;
    } else {
      // Mismatch.
      break;
    }
  }

  if (ti === normTarget.length) {
    // Consume any trailing punctuation that is directly attached (no space).
    while (
      pos + matchLen < text.length &&
      /^[^\p{L}\p{N}\s]/u.test(text[pos + matchLen])
    ) {
      matchLen++;
    }
    return matchLen;
  }

  return 0;
}

/**
 * Map an array of TTS word timestamps to their positions in the original
 * markdown source document.
 *
 * @param timestamps - Per-word timestamps from the TTS engine, with times
 *   relative to the start of this chunk's audio.
 * @param chunk - The text chunk that was sent to TTS, with its offset map
 *   linking plain text positions back to the source document.
 * @param timeOffset - Cumulative audio duration (in seconds) of all previous
 *   chunks. Added to each word's start/end time so that the resulting
 *   `MappedWord` times are absolute across the entire document.
 * @returns An array of `MappedWord` entries with absolute times and source
 *   offsets. Words that cannot be located in the plain text are still
 *   included with best-effort source positions.
 */
export function mapWordsToSource(
  timestamps: WordTimestamp[],
  chunk: TextChunk,
  timeOffset: number
): MappedWord[] {
  const result: MappedWord[] = [];
  const text = chunk.text;

  // Cursor: the position in `chunk.text` (plain text) where we continue
  // searching for the next word. This ensures we move forward sequentially
  // through the text, which mirrors the order TTS speaks words.
  let cursor = 0;

  for (const ts of timestamps) {
    const ttsWord = ts.word.trim();
    if (ttsWord.length === 0) {
      continue;
    }

    // --- Locate the word in the chunk's plain text ---

    let matchStart = -1;
    let matchLen = 0;

    // Strategy 1: fuzzy match scanning forward from cursor.
    for (let pos = cursor; pos < text.length; pos++) {
      // Skip whitespace to find the start of the next word candidate.
      if (/\s/.test(text[pos]) && matchStart === -1) {
        continue;
      }

      const len = fuzzyMatchAt(text, pos, ttsWord);
      if (len > 0) {
        matchStart = pos;
        matchLen = len;
        break;
      }
    }

    // Strategy 2: if TTS merged/split words (e.g. contraction "don't" as
    // ["don", "'t"] or "cannot" as ["can", "not"]), try matching just the
    // stripped-punctuation version from the cursor position onward.
    if (matchStart === -1) {
      const strippedTts = stripPunctuation(ttsWord).toLowerCase();
      if (strippedTts.length > 0) {
        for (let pos = cursor; pos < text.length; pos++) {
          if (/\s/.test(text[pos])) {
            continue;
          }
          // Try to match the stripped version at this position.
          const ahead = text.slice(pos, pos + ttsWord.length + 4); // +4 for punctuation slack
          const strippedAhead = stripPunctuation(ahead).toLowerCase();
          if (strippedAhead.startsWith(strippedTts)) {
            // Find how many chars in `text` we need to consume to cover strippedTts.
            let consumed = 0;
            let matched = 0;
            for (
              let i = pos;
              i < text.length && matched < strippedTts.length;
              i++
            ) {
              consumed++;
              const ch = text[i];
              if (/[\p{L}\p{N}'-]/u.test(ch)) {
                if (ch.toLowerCase() === strippedTts[matched]) {
                  matched++;
                } else {
                  break;
                }
              }
              // else punctuation/whitespace -- skip
            }
            if (matched === strippedTts.length) {
              matchStart = pos;
              matchLen = consumed;
              break;
            }
          }
        }
      }
    }

    // Strategy 3: if still not found, try searching backwards from cursor
    // a small window (handles rare out-of-order edge cases).
    if (matchStart === -1) {
      const backtrackLimit = Math.max(0, cursor - 40);
      for (let pos = cursor - 1; pos >= backtrackLimit; pos--) {
        const len = fuzzyMatchAt(text, pos, ttsWord);
        if (len > 0) {
          matchStart = pos;
          matchLen = len;
          break;
        }
      }
    }

    // --- Compute source positions ---

    let sourceStart: number;
    let sourceEnd: number;

    if (matchStart !== -1) {
      // Advance cursor past this match so the next word searches after it.
      cursor = matchStart + matchLen;

      // The offset map in the chunk has plain offsets relative to the chunk
      // (i.e., starting at 0 for the chunk's own text). We can use them
      // directly since matchStart is also relative to chunk.text.
      const mapped = plainOffsetToSource(
        matchStart,
        matchStart + matchLen,
        chunk.offsetMap
      );
      sourceStart = mapped.sourceStart;
      sourceEnd = mapped.sourceEnd;
    } else {
      // Could not locate the word. Use the cursor position as a best guess
      // so highlighting at least lands somewhere near the right place.
      const guessMapped = plainOffsetToSource(
        cursor,
        cursor + ttsWord.length,
        chunk.offsetMap
      );
      sourceStart = guessMapped.sourceStart;
      sourceEnd = guessMapped.sourceEnd;
    }

    result.push({
      word: ttsWord,
      startTime: ts.start_time + timeOffset,
      endTime: ts.end_time + timeOffset,
      sourceStart,
      sourceEnd,
    });
  }

  return result;
}
