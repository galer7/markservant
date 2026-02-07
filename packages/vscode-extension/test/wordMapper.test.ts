import { describe, expect, it } from "vitest";
import { mapWordsToSource, plainOffsetToSource } from "../src/highlight/wordMapper.js";
import type { OffsetMapping, TextChunk, WordTimestamp } from "../src/tts/types.js";

// ---------------------------------------------------------------------------
// Helper to build a TextChunk conveniently
// ---------------------------------------------------------------------------
function makeChunk(
  text: string,
  offsetMap: OffsetMapping[],
  opts?: { index?: number; plainOffset?: number },
): TextChunk {
  return {
    text,
    index: opts?.index ?? 0,
    offsetMap,
    plainOffset: opts?.plainOffset ?? 0,
  };
}

// =========================================================================
// plainOffsetToSource
// =========================================================================
describe("plainOffsetToSource", () => {
  it("single entry -- exact range match", () => {
    // The plain text range [0, 5) maps to source [10, 15).
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 5, sourceStart: 10, sourceEnd: 15 },
    ];

    const result = plainOffsetToSource(0, 5, offsetMap);
    expect(result).toEqual({ sourceStart: 10, sourceEnd: 15 });
  });

  it("single entry -- partial range (word within a text node)", () => {
    // Plain text "Hello World" mapped as one entry [0, 11) -> [20, 31).
    // We ask for just "World" which is [6, 11) in plain text.
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 11, sourceStart: 20, sourceEnd: 31 },
    ];

    const result = plainOffsetToSource(6, 11, offsetMap);
    // sourceStart = 20 + (6 - 0) = 26, sourceEnd = 20 + (11 - 0) = 31
    expect(result).toEqual({ sourceStart: 26, sourceEnd: 31 });
  });

  it("multiple entries -- range spanning two entries", () => {
    // Imagine source: "**Hello** World"
    // After markdown stripping: "Hello World" (plain)
    // Entry 1: plain [0, 5) -> source [2, 7)   ("Hello" inside **bold**)
    // Entry 2: plain [5, 11) -> source [9, 15)  (" World" after closing **)
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 5, sourceStart: 2, sourceEnd: 7 },
      { plainStart: 5, plainEnd: 11, sourceStart: 9, sourceEnd: 15 },
    ];

    // Ask for the full range [0, 11) spanning both entries.
    const result = plainOffsetToSource(0, 11, offsetMap);
    expect(result).toEqual({ sourceStart: 2, sourceEnd: 15 });
  });

  it("no overlapping entry -- fallback to plain offsets", () => {
    // The offset map has an entry that does not overlap with our query.
    const offsetMap: OffsetMapping[] = [
      { plainStart: 20, plainEnd: 30, sourceStart: 50, sourceEnd: 60 },
    ];

    const result = plainOffsetToSource(0, 5, offsetMap);
    // Fallback: returns the plain offsets as-is.
    expect(result).toEqual({ sourceStart: 0, sourceEnd: 5 });
  });

  it("range partially overlapping an entry", () => {
    // Entry covers plain [5, 15) -> source [100, 110).
    // Query covers plain [3, 10): overlaps entry from 5..10.
    const offsetMap: OffsetMapping[] = [
      { plainStart: 5, plainEnd: 15, sourceStart: 100, sourceEnd: 110 },
    ];

    const result = plainOffsetToSource(3, 10, offsetMap);
    // overlapPlainStart = max(3, 5) = 5
    // overlapPlainEnd   = min(10, 15) = 10
    // entrySourceStart  = 100 + (5 - 5) = 100
    // entrySourceEnd    = 100 + (10 - 5) = 105
    expect(result).toEqual({ sourceStart: 100, sourceEnd: 105 });
  });

  it("empty offset map -- fallback to plain offsets", () => {
    const result = plainOffsetToSource(3, 7, []);
    expect(result).toEqual({ sourceStart: 3, sourceEnd: 7 });
  });

  it("multiple entries -- query within a single entry (not the first)", () => {
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 5, sourceStart: 0, sourceEnd: 5 },
      { plainStart: 5, plainEnd: 12, sourceStart: 10, sourceEnd: 17 },
      { plainStart: 12, plainEnd: 20, sourceStart: 20, sourceEnd: 28 },
    ];

    // Query "World" at plain [6, 11) which falls within second entry.
    const result = plainOffsetToSource(6, 11, offsetMap);
    // entrySourceStart = 10 + (6 - 5) = 11
    // entrySourceEnd   = 10 + (11 - 5) = 16
    expect(result).toEqual({ sourceStart: 11, sourceEnd: 16 });
  });

  it("multiple entries -- range spanning three entries", () => {
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 4, sourceStart: 0, sourceEnd: 4 },
      { plainStart: 4, plainEnd: 8, sourceStart: 10, sourceEnd: 14 },
      { plainStart: 8, plainEnd: 12, sourceStart: 20, sourceEnd: 24 },
    ];

    // Query spanning all three: [1, 10)
    const result = plainOffsetToSource(1, 10, offsetMap);
    // Entry 1: overlap [1,4) -> source [1, 4)
    // Entry 2: overlap [4,8) -> source [10, 14)
    // Entry 3: overlap [8,10) -> source [20, 22)
    // Final: min sourceStart = 1, max sourceEnd = 22
    expect(result).toEqual({ sourceStart: 1, sourceEnd: 22 });
  });
});

// =========================================================================
// mapWordsToSource
// =========================================================================
describe("mapWordsToSource", () => {
  it('simple case: "Hello World" with two word timestamps', () => {
    // Plain text is "Hello World", which maps 1:1 to source (no markdown).
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 11, sourceStart: 0, sourceEnd: 11 },
    ];
    const chunk = makeChunk("Hello World", offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "Hello", start_time: 0.0, end_time: 0.3 },
      { word: "World", start_time: 0.35, end_time: 0.7 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      word: "Hello",
      startTime: 0.0,
      endTime: 0.3,
      sourceStart: 0,
      sourceEnd: 5,
    });

    expect(result[1]).toEqual({
      word: "World",
      startTime: 0.35,
      endTime: 0.7,
      sourceStart: 6,
      sourceEnd: 11,
    });
  });

  it("time offset: timestamps shifted by timeOffset", () => {
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 5, sourceStart: 0, sourceEnd: 5 },
    ];
    const chunk = makeChunk("Hello", offsetMap);

    const timestamps: WordTimestamp[] = [{ word: "Hello", start_time: 0.0, end_time: 0.3 }];

    const timeOffset = 5.5;
    const result = mapWordsToSource(timestamps, chunk, timeOffset);

    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBeCloseTo(5.5, 5);
    expect(result[0].endTime).toBeCloseTo(5.8, 5);
  });

  it('punctuation handling: TTS returns "Hello" but plain text has "Hello,"', () => {
    // TTS may return the word without punctuation that is present in the text.
    // The exact-match path in fuzzyMatchAt matches "Hello" as a 5-char substring
    // at position 0 (since normalize("Hello") === normalize("Hello")).
    // The exact match returns target.length (5) immediately -- trailing punctuation
    // is only consumed by the character-by-character fuzzy path, not the exact path.
    const text = "Hello, World";
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 12, sourceStart: 0, sourceEnd: 12 },
    ];
    const chunk = makeChunk(text, offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "Hello", start_time: 0.0, end_time: 0.3 },
      { word: "World", start_time: 0.35, end_time: 0.7 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    expect(result).toHaveLength(2);

    // "Hello" matches via exact substring (5 chars). The comma is not consumed.
    expect(result[0].word).toBe("Hello");
    expect(result[0].sourceStart).toBe(0);
    expect(result[0].sourceEnd).toBe(5);

    // After "Hello" (cursor=5), scanning for "World" from pos 5.
    // At pos 5, fuzzyMatchAt matches through ", World" -- the comma and space
    // normalize to empty and are consumed. matchStart=5, matchLen=7.
    expect(result[1].word).toBe("World");
    expect(result[1].sourceStart).toBe(5);
    expect(result[1].sourceEnd).toBe(12);
  });

  it("sequential word matching: words found in order", () => {
    // When the same word appears twice, the cursor ensures they are matched in order.
    const text = "go go go";
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 8, sourceStart: 0, sourceEnd: 8 },
    ];
    const chunk = makeChunk(text, offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "go", start_time: 0.0, end_time: 0.2 },
      { word: "go", start_time: 0.25, end_time: 0.45 },
      { word: "go", start_time: 0.5, end_time: 0.7 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    expect(result).toHaveLength(3);
    // First "go" at positions [0, 2)
    expect(result[0]).toMatchObject({ sourceStart: 0, sourceEnd: 2 });
    // Second "go" at positions [3, 5)
    expect(result[1]).toMatchObject({ sourceStart: 3, sourceEnd: 5 });
    // Third "go" at positions [6, 8)
    expect(result[2]).toMatchObject({ sourceStart: 6, sourceEnd: 8 });
  });

  it("multiple words in a sentence with offset map (markdown bold)", () => {
    // Source: "This is **important** text"
    // Plain:  "This is important text"
    //
    // Offset map:
    //   plain [0, 8)   -> source [0, 8)     "This is "
    //   plain [8, 17)  -> source [10, 19)   "important" (inside **)
    //   plain [17, 22) -> source [21, 26)   " text"
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 8, sourceStart: 0, sourceEnd: 8 },
      { plainStart: 8, plainEnd: 17, sourceStart: 10, sourceEnd: 19 },
      { plainStart: 17, plainEnd: 22, sourceStart: 21, sourceEnd: 26 },
    ];
    const chunk = makeChunk("This is important text", offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "This", start_time: 0.0, end_time: 0.2 },
      { word: "is", start_time: 0.25, end_time: 0.35 },
      { word: "important", start_time: 0.4, end_time: 0.8 },
      { word: "text", start_time: 0.85, end_time: 1.1 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    expect(result).toHaveLength(4);

    // "This" at plain [0, 4) -> source [0, 4)
    expect(result[0]).toMatchObject({
      word: "This",
      sourceStart: 0,
      sourceEnd: 4,
    });

    // "is" at plain [5, 7) -> source [5, 7)
    expect(result[1]).toMatchObject({
      word: "is",
      sourceStart: 5,
      sourceEnd: 7,
    });

    // "important" at plain [8, 17) -> source [10, 19) (inside the ** delimiters)
    expect(result[2]).toMatchObject({
      word: "important",
      sourceStart: 10,
      sourceEnd: 19,
    });

    // "text" at plain [18, 22) -> source [22, 26) (after ** and space)
    expect(result[3]).toMatchObject({
      word: "text",
      sourceStart: 22,
      sourceEnd: 26,
    });
  });

  it("empty timestamps array -- returns empty", () => {
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 11, sourceStart: 0, sourceEnd: 11 },
    ];
    const chunk = makeChunk("Hello World", offsetMap);

    const result = mapWordsToSource([], chunk, 0);
    expect(result).toEqual([]);
  });

  it("word not found in text -- best-effort position", () => {
    // TTS returns a word that does not appear in the plain text at all.
    const text = "Hello World";
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 11, sourceStart: 0, sourceEnd: 11 },
    ];
    const chunk = makeChunk(text, offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "Hello", start_time: 0.0, end_time: 0.3 },
      { word: "nonexistent", start_time: 0.35, end_time: 0.7 },
      { word: "World", start_time: 0.75, end_time: 1.0 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    expect(result).toHaveLength(3);

    // First word matches normally.
    expect(result[0]).toMatchObject({
      word: "Hello",
      sourceStart: 0,
      sourceEnd: 5,
    });

    // "nonexistent" is not found; best-effort position uses cursor (which is 5
    // after matching "Hello"). The entry is still emitted, just with approximate
    // source offsets derived from the cursor.
    expect(result[1].word).toBe("nonexistent");
    expect(typeof result[1].sourceStart).toBe("number");
    expect(typeof result[1].sourceEnd).toBe("number");

    // "World" should still be matched after the cursor settles.
    expect(result[2].word).toBe("World");
    expect(result[2].sourceStart).toBe(6);
    expect(result[2].sourceEnd).toBe(11);
  });

  it("whitespace-only timestamp word is skipped", () => {
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 5, sourceStart: 0, sourceEnd: 5 },
    ];
    const chunk = makeChunk("Hello", offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "  ", start_time: 0.0, end_time: 0.1 },
      { word: "Hello", start_time: 0.1, end_time: 0.4 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    // The whitespace-only word should be skipped entirely.
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("Hello");
  });

  it("TTS word with smart quotes matches plain text", () => {
    // TTS might return smart-quoted words; the normalizer converts them.
    const text = "it's fine";
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 9, sourceStart: 0, sourceEnd: 9 },
    ];
    const chunk = makeChunk(text, offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "it\u2019s", start_time: 0.0, end_time: 0.3 },
      { word: "fine", start_time: 0.35, end_time: 0.6 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ sourceStart: 0, sourceEnd: 4 });
    expect(result[1]).toMatchObject({ sourceStart: 5, sourceEnd: 9 });
  });

  it("large time offset is added correctly to all words", () => {
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 7, sourceStart: 0, sourceEnd: 7 },
    ];
    const chunk = makeChunk("one two", offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "one", start_time: 0.0, end_time: 0.2 },
      { word: "two", start_time: 0.3, end_time: 0.5 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 120.75);

    expect(result[0].startTime).toBeCloseTo(120.75, 5);
    expect(result[0].endTime).toBeCloseTo(120.95, 5);
    expect(result[1].startTime).toBeCloseTo(121.05, 5);
    expect(result[1].endTime).toBeCloseTo(121.25, 5);
  });

  it("handles sentence with mixed punctuation", () => {
    // Text: "Wait... really? Yes!"
    // Positions: W(0) a(1) i(2) t(3) .(4) .(5) .(6) ' '(7) r(8) e(9) a(10) l(11) l(12) y(13) ?(14) ' '(15) Y(16) e(17) s(18) !(19)
    const text = "Wait... really? Yes!";
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 20, sourceStart: 0, sourceEnd: 20 },
    ];
    const chunk = makeChunk(text, offsetMap);

    const timestamps: WordTimestamp[] = [
      { word: "Wait", start_time: 0.0, end_time: 0.3 },
      { word: "really", start_time: 0.35, end_time: 0.6 },
      { word: "Yes", start_time: 0.65, end_time: 0.9 },
    ];

    const result = mapWordsToSource(timestamps, chunk, 0);

    expect(result).toHaveLength(3);

    // "Wait" matches exactly at [0, 4) via exact substring match.
    expect(result[0].word).toBe("Wait");
    expect(result[0].sourceStart).toBe(0);
    expect(result[0].sourceEnd).toBe(4);

    // After "Wait", cursor = 4. The fuzzy matcher scans from pos 4 for "really".
    // At pos 4, the char-by-char path skips "..." and space (all normalize to ""),
    // then matches "really" and consumes trailing "?".
    // matchStart = 4, matchLen covers "... really?" (11 chars), so sourceEnd = 15.
    expect(result[1].word).toBe("really");
    expect(result[1].sourceStart).toBe(4);
    expect(result[1].sourceEnd).toBe(15);

    // After "really" match, cursor = 15. "Yes" matches at pos 16 (exact match),
    // sourceEnd = 16 + 3 = 19.
    expect(result[2].word).toBe("Yes");
    expect(result[2].sourceStart).toBe(16);
    expect(result[2].sourceEnd).toBe(19);
  });
});
