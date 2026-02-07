import { describe, it, expect } from "vitest";
import { splitIntoChunks } from "../src/tts/chunkSplitter.js";

import type {
  OffsetMapping,
  StrippedMarkdown,
  TextChunk,
} from "../src/tts/types.js";

/**
 * Helper: create a simple StrippedMarkdown where the plain text maps 1:1 to
 * source text (plainStart === sourceStart, plainEnd === sourceEnd). This is the
 * simplest possible offset map: one entry covering the whole string.
 */
function simple(plainText: string): StrippedMarkdown {
  if (plainText.length === 0) {
    return { plainText, offsetMap: [] };
  }
  return {
    plainText,
    offsetMap: [
      {
        plainStart: 0,
        plainEnd: plainText.length,
        sourceStart: 0,
        sourceEnd: plainText.length,
      },
    ],
  };
}

/**
 * Helper: repeat a character `n` times.
 */
function repeat(ch: string, n: number): string {
  return ch.repeat(n);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("splitIntoChunks", () => {
  // 1. Empty text
  it("returns an empty array for empty text", () => {
    const result = splitIntoChunks({ plainText: "", offsetMap: [] });
    expect(result).toEqual([]);
  });

  it("returns an empty array when plainText is an empty string with no offset map", () => {
    const result = splitIntoChunks({ plainText: "", offsetMap: [] });
    expect(result).toHaveLength(0);
  });

  // 2. Short text (< 500 chars) returns a single chunk
  it("returns a single chunk for short text under default maxChunkSize", () => {
    const text = "Hello world, this is a short paragraph.";
    const result = splitIntoChunks(simple(text));

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
    expect(result[0].index).toBe(0);
    expect(result[0].plainOffset).toBe(0);
  });

  // 3. Two paragraphs that fit in one chunk
  it("groups two short paragraphs into a single chunk", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const result = splitIntoChunks(simple(text));

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
    expect(result[0].index).toBe(0);
    expect(result[0].plainOffset).toBe(0);
  });

  // 4. Two paragraphs that exceed maxChunkSize
  it("splits two paragraphs into two chunks when they exceed maxChunkSize", () => {
    const para1 = repeat("a", 30);
    const para2 = repeat("b", 30);
    const text = `${para1}\n\n${para2}`;
    const result = splitIntoChunks(simple(text), 50);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe(para1);
    expect(result[0].index).toBe(0);
    expect(result[0].plainOffset).toBe(0);

    expect(result[1].text).toBe(para2);
    expect(result[1].index).toBe(1);
    // para1 (30) + "\n\n" (2) = 32
    expect(result[1].plainOffset).toBe(32);
  });

  // 5. Single very long paragraph — split on sentence boundaries
  it("splits a single long paragraph on sentence boundaries", () => {
    // Create a paragraph with two sentences, each about 35 chars, total ~70
    const sentence1 = "This is the first sentence here."; // 31 chars
    const sentence2 = "This is the second sentence now."; // 31 chars
    const text = `${sentence1} ${sentence2}`;
    const result = splitIntoChunks(simple(text), 40);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe(sentence1);
    expect(result[1].text).toBe(sentence2);
  });

  // 6. Sentence splitting — splits at ". " boundary
  it("splits at sentence-ending punctuation followed by a space", () => {
    const s1 = "First sentence.";
    const s2 = "Second sentence.";
    const s3 = "Third sentence.";
    const text = `${s1} ${s2} ${s3}`;
    // maxChunkSize enough for two sentences but not three
    const result = splitIntoChunks(simple(text), 35);

    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should end at a sentence boundary
    expect(result[0].text).toMatch(/\.$/);
  });

  it("splits at exclamation mark followed by space", () => {
    const text = "Wow! That is amazing! Really cool stuff here today.";
    const result = splitIntoChunks(simple(text), 25);

    // Should split on sentence boundaries (! or .)
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(25);
    }
  });

  it("splits at question mark followed by space", () => {
    const text = "Is this working? Yes it is working just fine today.";
    const result = splitIntoChunks(simple(text), 25);

    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should end at the question mark
    expect(result[0].text).toBe("Is this working?");
  });

  // 7. Word boundary splitting — when no sentence boundary, split at space
  it("splits at the nearest space when no sentence boundary is found", () => {
    // A long string of words with no sentence-ending punctuation
    const text = "word one two three four five six seven eight nine ten eleven twelve";
    const result = splitIntoChunks(simple(text), 30);

    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(30);
      // Each chunk should not start or end with a space
      expect(chunk.text).not.toMatch(/^ /);
      expect(chunk.text).not.toMatch(/ $/);
    }
  });

  // 8. Very long word — force split at maxChunkSize
  it("force-splits a very long word at maxChunkSize", () => {
    const longWord = repeat("x", 60);
    const result = splitIntoChunks(simple(longWord), 20);

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe(repeat("x", 20));
    expect(result[0].plainOffset).toBe(0);

    expect(result[1].text).toBe(repeat("x", 20));
    expect(result[1].plainOffset).toBe(20);

    expect(result[2].text).toBe(repeat("x", 20));
    expect(result[2].plainOffset).toBe(40);
  });

  it("force-splits a long word that is not an exact multiple of maxChunkSize", () => {
    const longWord = repeat("z", 50);
    const result = splitIntoChunks(simple(longWord), 20);

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe(repeat("z", 20));
    expect(result[1].text).toBe(repeat("z", 20));
    expect(result[2].text).toBe(repeat("z", 10));
    expect(result[2].plainOffset).toBe(40);
  });

  // 9. Offset map preservation — chunk's offsetMap has plainStart/plainEnd relative to chunk
  it("adjusts offsetMap plainStart/plainEnd to be relative to the chunk", () => {
    const para1 = "Hello world.";
    const para2 = "Goodbye moon.";
    const text = `${para1}\n\n${para2}`;

    // One offset entry covering the full text
    const offsetMap: OffsetMapping[] = [
      {
        plainStart: 0,
        plainEnd: text.length,
        sourceStart: 100,
        sourceEnd: 100 + text.length,
      },
    ];

    const result = splitIntoChunks({ plainText: text, offsetMap }, 10);

    // Each chunk's offsetMap entries should have plainStart starting at 0
    for (const chunk of result) {
      for (const entry of chunk.offsetMap) {
        expect(entry.plainStart).toBeGreaterThanOrEqual(0);
        expect(entry.plainEnd).toBeLessThanOrEqual(chunk.text.length);
      }
    }
  });

  it("offsets within a chunk's offsetMap are zero-based for that chunk", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    // Create per-word offset entries
    const offsetMap: OffsetMapping[] = [
      // "First paragraph." at plain[0..16]
      { plainStart: 0, plainEnd: 16, sourceStart: 10, sourceEnd: 30 },
      // "Second paragraph." at plain[18..35]
      { plainStart: 18, plainEnd: 35, sourceStart: 40, sourceEnd: 60 },
    ];

    // Force split into two chunks (one per paragraph)
    const result = splitIntoChunks({ plainText: text, offsetMap }, 17);

    expect(result).toHaveLength(2);

    // First chunk covers plain[0..16] -> chunk-relative [0..16]
    expect(result[0].offsetMap).toHaveLength(1);
    expect(result[0].offsetMap[0].plainStart).toBe(0);
    expect(result[0].offsetMap[0].plainEnd).toBe(16);

    // Second chunk covers plain[18..35] -> chunk-relative [0..17]
    expect(result[1].offsetMap).toHaveLength(1);
    expect(result[1].offsetMap[0].plainStart).toBe(0);
    expect(result[1].offsetMap[0].plainEnd).toBe(17);
  });

  // 10. Offset map sourceStart/sourceEnd remain absolute
  it("preserves absolute sourceStart/sourceEnd values in the offset map", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 16, sourceStart: 100, sourceEnd: 200 },
      { plainStart: 18, plainEnd: 35, sourceStart: 300, sourceEnd: 400 },
    ];

    const result = splitIntoChunks({ plainText: text, offsetMap }, 17);

    expect(result).toHaveLength(2);

    // First chunk: source range should remain [100, 200]
    expect(result[0].offsetMap[0].sourceStart).toBe(100);
    expect(result[0].offsetMap[0].sourceEnd).toBe(200);

    // Second chunk: source range should remain [300, 400]
    expect(result[1].offsetMap[0].sourceStart).toBe(300);
    expect(result[1].offsetMap[0].sourceEnd).toBe(400);
  });

  it("clips and interpolates sourceStart/sourceEnd when a chunk splits an offset entry", () => {
    // Single long text with one offset entry spanning the whole thing
    const text = "abcdefghij"; // 10 chars
    const offsetMap: OffsetMapping[] = [
      { plainStart: 0, plainEnd: 10, sourceStart: 100, sourceEnd: 200 },
    ];

    // Force split into two chunks of 5
    const result = splitIntoChunks({ plainText: text, offsetMap }, 5);

    expect(result).toHaveLength(2);

    // First chunk: plain[0..5] -> source should be proportionally [100..150]
    expect(result[0].offsetMap[0].sourceStart).toBe(100);
    expect(result[0].offsetMap[0].sourceEnd).toBe(150);

    // Second chunk: plain[5..10] -> source should be proportionally [150..200]
    expect(result[1].offsetMap[0].sourceStart).toBe(150);
    expect(result[1].offsetMap[0].sourceEnd).toBe(200);
  });

  // 11. Custom maxChunkSize parameter
  it("respects a custom maxChunkSize", () => {
    const text = "Short.\n\nAnother short.";
    const result = splitIntoChunks(simple(text), 10);

    // Each paragraph is > 5 chars but "Short." is 6 chars, "Another short." is 14 chars
    // With maxChunkSize=10, they can't be grouped
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(14); // "Another short." needs sentence/word splitting
    }
  });

  it("uses the default maxChunkSize of 500 when not specified", () => {
    // Create a text that is exactly 500 chars
    const text = repeat("a", 500);
    const result = splitIntoChunks(simple(text));

    expect(result).toHaveLength(1);
    expect(result[0].text.length).toBe(500);
  });

  it("splits when text exceeds default maxChunkSize of 500", () => {
    const text = repeat("a", 250) + ". " + repeat("b", 250) + ".";
    const result = splitIntoChunks(simple(text));

    // Total is 503 chars, should split on the sentence boundary
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  // 12. Three paragraphs, various sizes — correct grouping
  it("correctly groups three paragraphs of various sizes", () => {
    const para1 = repeat("a", 20); // 20 chars
    const para2 = repeat("b", 20); // 20 chars
    const para3 = repeat("c", 20); // 20 chars
    const text = `${para1}\n\n${para2}\n\n${para3}`;

    // maxChunkSize=45: para1+sep+para2 = 20+2+20 = 42 fits, adding para3 = 42+2+20 = 64 does not
    const result = splitIntoChunks(simple(text), 45);

    expect(result).toHaveLength(2);
    // First chunk should contain para1 + \n\n + para2
    expect(result[0].text).toBe(`${para1}\n\n${para2}`);
    // Second chunk should contain just para3
    expect(result[1].text).toBe(para3);
  });

  it("puts each paragraph in its own chunk when none can be grouped", () => {
    const para1 = repeat("a", 15);
    const para2 = repeat("b", 15);
    const para3 = repeat("c", 15);
    const text = `${para1}\n\n${para2}\n\n${para3}`;

    // maxChunkSize=16: each paragraph is 15, but para1+sep+para2 = 15+2+15 = 32 > 16
    const result = splitIntoChunks(simple(text), 16);

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe(para1);
    expect(result[1].text).toBe(para2);
    expect(result[2].text).toBe(para3);
  });

  it("groups all three paragraphs into one chunk when they fit", () => {
    const para1 = "Hi.";
    const para2 = "Hey.";
    const para3 = "Yo.";
    const text = `${para1}\n\n${para2}\n\n${para3}`;

    const result = splitIntoChunks(simple(text), 100);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
  });

  // 13. Multiple consecutive paragraph breaks — empty paragraphs skipped
  it("skips empty paragraphs from multiple consecutive paragraph breaks", () => {
    // "\n\n\n\n" produces an empty paragraph between the two real paragraphs
    const text = "First.\n\n\n\nSecond.";
    const result = splitIntoChunks(simple(text), 500);

    expect(result).toHaveLength(1);
    // The chunk should span from "First." to "Second." but skip the empty paragraph
    // Based on implementation: split on \n\n yields ["First.", "", "Second."]
    // Empty paragraph is skipped, so both non-empty paragraphs are grouped
    expect(result[0].text).toContain("First.");
    expect(result[0].text).toContain("Second.");
  });

  it("handles text with only paragraph breaks", () => {
    const text = "\n\n\n\n";
    const result = splitIntoChunks(simple(text), 500);

    // All paragraphs are empty, so nothing should be produced
    expect(result).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Additional edge cases
  // ---------------------------------------------------------------------------

  describe("chunk indexing", () => {
    it("assigns sequential zero-based indices to chunks", () => {
      const para1 = repeat("a", 20);
      const para2 = repeat("b", 20);
      const para3 = repeat("c", 20);
      const text = `${para1}\n\n${para2}\n\n${para3}`;
      const result = splitIntoChunks(simple(text), 20);

      for (let i = 0; i < result.length; i++) {
        expect(result[i].index).toBe(i);
      }
    });
  });

  describe("plainOffset tracking", () => {
    it("sets correct plainOffset for each chunk", () => {
      const para1 = "Hello."; // 6 chars
      const para2 = "World."; // 6 chars
      const text = `${para1}\n\n${para2}`;

      // maxChunkSize=6: can't fit both (6 + 2 + 6 = 14 > 6)
      const result = splitIntoChunks(simple(text), 6);

      expect(result).toHaveLength(2);
      expect(result[0].plainOffset).toBe(0);
      // para1 (6) + "\n\n" (2) = 8
      expect(result[1].plainOffset).toBe(8);
    });
  });

  describe("offset map with multiple entries", () => {
    it("correctly distributes multiple offset entries across chunks", () => {
      const text = "Hello world.\n\nGoodbye moon.";
      const offsetMap: OffsetMapping[] = [
        // "Hello" in plain[0..5] maps to source[10..15]
        { plainStart: 0, plainEnd: 5, sourceStart: 10, sourceEnd: 15 },
        // " world." in plain[5..12] maps to source[15..22]
        { plainStart: 5, plainEnd: 12, sourceStart: 15, sourceEnd: 22 },
        // "Goodbye" in plain[14..21] maps to source[30..37]
        { plainStart: 14, plainEnd: 21, sourceStart: 30, sourceEnd: 37 },
        // " moon." in plain[21..27] maps to source[37..43]
        { plainStart: 21, plainEnd: 27, sourceStart: 37, sourceEnd: 43 },
      ];

      // Force split: each paragraph in its own chunk
      const result = splitIntoChunks({ plainText: text, offsetMap }, 13);

      expect(result).toHaveLength(2);

      // First chunk: "Hello world." -> should have 2 offset entries
      expect(result[0].offsetMap).toHaveLength(2);
      expect(result[0].offsetMap[0]).toEqual({
        plainStart: 0,
        plainEnd: 5,
        sourceStart: 10,
        sourceEnd: 15,
      });
      expect(result[0].offsetMap[1]).toEqual({
        plainStart: 5,
        plainEnd: 12,
        sourceStart: 15,
        sourceEnd: 22,
      });

      // Second chunk: "Goodbye moon." -> should have 2 offset entries, plain-relative
      expect(result[1].offsetMap).toHaveLength(2);
      // "Goodbye" plain[14..21] -> chunk-relative [0..7]
      expect(result[1].offsetMap[0]).toEqual({
        plainStart: 0,
        plainEnd: 7,
        sourceStart: 30,
        sourceEnd: 37,
      });
      // " moon." plain[21..27] -> chunk-relative [7..13]
      expect(result[1].offsetMap[1]).toEqual({
        plainStart: 7,
        plainEnd: 13,
        sourceStart: 37,
        sourceEnd: 43,
      });
    });
  });

  describe("combined sentence and word splitting", () => {
    it("falls back to word splitting after sentence splitting within a long paragraph", () => {
      // One sentence that is too long for maxChunkSize but has spaces
      const text = "this is a long sentence with no period that keeps going on and on and on";
      const result = splitIntoChunks(simple(text), 30);

      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const chunk of result) {
        expect(chunk.text.length).toBeLessThanOrEqual(30);
      }
    });
  });
});
