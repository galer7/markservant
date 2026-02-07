import { describe, it, expect } from "vitest";
import {
  stripMarkdown,
  plainOffsetToSource,
} from "../src/tts/markdownStripper.js";

// ---------------------------------------------------------------------------
// Helper: given a source string and its stripped result, find a word in the
// plain text and verify that plainOffsetToSource maps back to the correct
// substring in the original source.
// ---------------------------------------------------------------------------
function expectWordMapsBack(
  source: string,
  plainText: string,
  offsetMap: ReturnType<typeof stripMarkdown>["offsetMap"],
  word: string
) {
  const plainStart = plainText.indexOf(word);
  expect(plainStart).not.toBe(-1);
  const plainEnd = plainStart + word.length;

  const { sourceStart, sourceEnd } = plainOffsetToSource(
    plainStart,
    plainEnd,
    offsetMap
  );
  expect(source.slice(sourceStart, sourceEnd)).toBe(word);
}

// ===========================================================================
// 1. Simple paragraph (no markdown) -- plain text is identical
// ===========================================================================
describe("stripMarkdown", () => {
  it("returns identical text for a simple paragraph with no markdown", () => {
    const source = "Hello world, this is plain text.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("Hello world, this is plain text.");
    expect(offsetMap.length).toBeGreaterThan(0);

    // Every character maps 1:1
    expectWordMapsBack(source, plainText, offsetMap, "Hello");
    expectWordMapsBack(source, plainText, offsetMap, "plain text");
  });

  // =========================================================================
  // 2. Heading (# Hello) -- strips # syntax
  // =========================================================================
  it("strips heading syntax and maps offsets correctly", () => {
    const source = "# Hello";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("Hello");
    expectWordMapsBack(source, plainText, offsetMap, "Hello");
  });

  it("strips multi-level heading syntax", () => {
    const source = "### Deep heading";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("Deep heading");
    expectWordMapsBack(source, plainText, offsetMap, "Deep");
    expectWordMapsBack(source, plainText, offsetMap, "heading");
  });

  // =========================================================================
  // 3. Bold (**word**) -- strips **, offset map points to correct source
  // =========================================================================
  it("strips bold markers and maps the bold word to its source position", () => {
    const source = "This is **bold** text.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("This is bold text.");

    // "bold" in source is at positions 10..14 (inside the **)
    expectWordMapsBack(source, plainText, offsetMap, "bold");
    expectWordMapsBack(source, plainText, offsetMap, "This is ");
    expectWordMapsBack(source, plainText, offsetMap, " text.");
  });

  // =========================================================================
  // 4. Italic (*word*) -- strips *, offset map correct
  // =========================================================================
  it("strips italic markers and maps the italic word correctly", () => {
    const source = "An *italic* word.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("An italic word.");
    expectWordMapsBack(source, plainText, offsetMap, "italic");
    expectWordMapsBack(source, plainText, offsetMap, "An ");
  });

  // =========================================================================
  // 5. Link [text](url) -- reads text, skips URL
  // =========================================================================
  it("extracts link text and skips the URL", () => {
    const source = "Click [here](https://example.com) for info.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("Click here for info.");
    expect(plainText).not.toContain("https://example.com");

    expectWordMapsBack(source, plainText, offsetMap, "here");
    expectWordMapsBack(source, plainText, offsetMap, "Click ");
    expectWordMapsBack(source, plainText, offsetMap, " for info.");
  });

  // =========================================================================
  // 6. Image ![alt](src) -- skipped entirely
  // =========================================================================
  it("skips images entirely", () => {
    const source = "Before ![alt text](image.png) after.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).not.toContain("alt text");
    expect(plainText).not.toContain("image.png");
    // Should contain the surrounding text
    expect(plainText).toContain("Before");
    expect(plainText).toContain("after.");
  });

  it("skips images that are the only content", () => {
    const source = "![logo](logo.png)";
    const { plainText } = stripMarkdown(source);

    expect(plainText).toBe("");
  });

  // =========================================================================
  // 7. Fenced code block -- skipped entirely
  // =========================================================================
  it("skips fenced code blocks entirely", () => {
    const source =
      "Before code.\n\n```js\nconsole.log('hello');\n```\n\nAfter code.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).not.toContain("console.log");
    expect(plainText).not.toContain("```");
    expect(plainText).toContain("Before code.");
    expect(plainText).toContain("After code.");

    expectWordMapsBack(source, plainText, offsetMap, "Before code.");
    expectWordMapsBack(source, plainText, offsetMap, "After code.");
  });

  // =========================================================================
  // 8. Inline code `code` -- skipped
  // =========================================================================
  it("skips inline code", () => {
    const source = "Use `console.log` for debugging.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).not.toContain("console.log");
    expect(plainText).toContain("Use");
    expect(plainText).toContain("for debugging.");

    expectWordMapsBack(source, plainText, offsetMap, "Use ");
    expectWordMapsBack(source, plainText, offsetMap, " for debugging.");
  });

  // =========================================================================
  // 9. Lists (- item1\n- item2) -- reads items
  // =========================================================================
  it("reads list items", () => {
    const source = "- item one\n- item two\n- item three";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("item one");
    expect(plainText).toContain("item two");
    expect(plainText).toContain("item three");

    expectWordMapsBack(source, plainText, offsetMap, "item one");
    expectWordMapsBack(source, plainText, offsetMap, "item two");
    expectWordMapsBack(source, plainText, offsetMap, "item three");
  });

  it("reads ordered list items", () => {
    const source = "1. First\n2. Second";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("First");
    expect(plainText).toContain("Second");

    expectWordMapsBack(source, plainText, offsetMap, "First");
    expectWordMapsBack(source, plainText, offsetMap, "Second");
  });

  // =========================================================================
  // 10. Blockquotes (> text) -- reads text
  // =========================================================================
  it("reads blockquote text", () => {
    const source = "> This is a quote.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("This is a quote.");
    expectWordMapsBack(source, plainText, offsetMap, "This is a quote.");
  });

  it("reads nested blockquotes", () => {
    const source = "> Outer\n>\n>> Inner";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("Outer");
    expect(plainText).toContain("Inner");

    expectWordMapsBack(source, plainText, offsetMap, "Outer");
    expectWordMapsBack(source, plainText, offsetMap, "Inner");
  });

  // =========================================================================
  // 11. Multiple paragraphs -- separated by \n\n in plain text
  // =========================================================================
  it("separates multiple paragraphs with double newlines", () => {
    const source = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe(
      "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
    );

    expectWordMapsBack(source, plainText, offsetMap, "First paragraph.");
    expectWordMapsBack(source, plainText, offsetMap, "Second paragraph.");
    expectWordMapsBack(source, plainText, offsetMap, "Third paragraph.");
  });

  // =========================================================================
  // 12. Mixed formatting -- bold inside heading, italic inside list
  // =========================================================================
  it("handles bold inside a heading", () => {
    const source = "# The **important** title";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("The important title");

    expectWordMapsBack(source, plainText, offsetMap, "The ");
    expectWordMapsBack(source, plainText, offsetMap, "important");
    expectWordMapsBack(source, plainText, offsetMap, " title");
  });

  it("handles italic inside a list item", () => {
    const source = "- This is *emphasized* text";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("This is");
    expect(plainText).toContain("emphasized");
    expect(plainText).toContain("text");

    expectWordMapsBack(source, plainText, offsetMap, "emphasized");
  });

  it("handles bold and italic combined", () => {
    const source = "Normal **bold** and *italic* end.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("Normal bold and italic end.");

    expectWordMapsBack(source, plainText, offsetMap, "Normal ");
    expectWordMapsBack(source, plainText, offsetMap, "bold");
    expectWordMapsBack(source, plainText, offsetMap, " and ");
    expectWordMapsBack(source, plainText, offsetMap, "italic");
    expectWordMapsBack(source, plainText, offsetMap, " end.");
  });

  // =========================================================================
  // 13. Hard breaks (two trailing spaces) -- replaced with space
  // =========================================================================
  it("replaces hard breaks with a space", () => {
    const source = "Line one  \nLine two";
    const { plainText } = stripMarkdown(source);

    // Hard break (two trailing spaces + newline) should become a space
    expect(plainText).toContain("Line one");
    expect(plainText).toContain("Line two");
    // Should be joined by a space, not a literal newline within the same paragraph
    expect(plainText).toBe("Line one Line two");
  });

  // =========================================================================
  // 14. Thematic break (---) -- paragraph separator
  // =========================================================================
  it("treats thematic break as a paragraph separator", () => {
    const source = "Before break.\n\n---\n\nAfter break.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("Before break.");
    expect(plainText).toContain("After break.");
    // There should be paragraph separation (double newline) between them
    const beforeIdx = plainText.indexOf("Before break.");
    const afterIdx = plainText.indexOf("After break.");
    expect(afterIdx).toBeGreaterThan(beforeIdx + "Before break.".length);

    expectWordMapsBack(source, plainText, offsetMap, "Before break.");
    expectWordMapsBack(source, plainText, offsetMap, "After break.");
  });

  // =========================================================================
  // 17. Empty document -- returns empty plainText and empty offsetMap
  // =========================================================================
  it("returns empty plainText and empty offsetMap for an empty document", () => {
    const { plainText, offsetMap } = stripMarkdown("");

    expect(plainText).toBe("");
    expect(offsetMap).toEqual([]);
  });

  it("returns empty plainText for whitespace-only document", () => {
    const { plainText, offsetMap } = stripMarkdown("   \n\n   ");

    expect(plainText).toBe("");
    expect(offsetMap).toEqual([]);
  });
});

// ===========================================================================
// plainOffsetToSource tests
// ===========================================================================
describe("plainOffsetToSource", () => {
  // =========================================================================
  // 15. Verify exact source positions for bold word
  // =========================================================================
  it("returns exact source positions for a bold word", () => {
    const source = "Hello **world** end";
    //              0123456789...
    // source layout:
    //   "Hello " = 0..6
    //   "**"     = 6..8
    //   "world"  = 8..13
    //   "**"     = 13..15
    //   " end"   = 15..19
    //
    // plain text: "Hello world end"
    //              01234567890...
    //   "Hello " = plain 0..6  -> source 0..6
    //   "world"  = plain 6..11 -> source 8..13
    //   " end"   = plain 11..15 -> source 15..19

    const { plainText, offsetMap } = stripMarkdown(source);
    expect(plainText).toBe("Hello world end");

    // "world" in plain text is at [6, 11)
    const worldPlainStart = plainText.indexOf("world");
    expect(worldPlainStart).toBe(6);
    const worldPlainEnd = worldPlainStart + "world".length;
    expect(worldPlainEnd).toBe(11);

    const { sourceStart, sourceEnd } = plainOffsetToSource(
      worldPlainStart,
      worldPlainEnd,
      offsetMap
    );

    // In the source, "world" is at positions 8..13 (between the ** markers)
    expect(sourceStart).toBe(8);
    expect(sourceEnd).toBe(13);
    expect(source.slice(sourceStart, sourceEnd)).toBe("world");
  });

  it("returns exact source positions for text before bold", () => {
    const source = "Hello **world** end";
    const { plainText, offsetMap } = stripMarkdown(source);

    // "Hello " in plain text is at [0, 6)
    const { sourceStart, sourceEnd } = plainOffsetToSource(0, 6, offsetMap);
    expect(sourceStart).toBe(0);
    expect(sourceEnd).toBe(6);
    expect(source.slice(sourceStart, sourceEnd)).toBe("Hello ");
  });

  it("returns exact source positions for text after bold", () => {
    const source = "Hello **world** end";
    const { plainText, offsetMap } = stripMarkdown(source);

    // " end" in plain text starts at index 11
    const endStart = plainText.indexOf(" end");
    const endEnd = endStart + " end".length;

    const { sourceStart, sourceEnd } = plainOffsetToSource(
      endStart,
      endEnd,
      offsetMap
    );
    expect(source.slice(sourceStart, sourceEnd)).toBe(" end");
  });

  // =========================================================================
  // 16. Verify positions spanning multiple offset map entries
  // =========================================================================
  it("handles a range spanning multiple offset map entries", () => {
    const source = "Say **hello** world";
    // source layout:
    //   "Say " = 0..4
    //   "**"   = 4..6
    //   "hello" = 6..11
    //   "**"   = 11..13
    //   " world" = 13..19
    //
    // plain text: "Say hello world"
    //   "Say "   = plain 0..4   -> source 0..4
    //   "hello"  = plain 4..9   -> source 6..11
    //   " world" = plain 9..15  -> source 13..19

    const { plainText, offsetMap } = stripMarkdown(source);
    expect(plainText).toBe("Say hello world");

    // Query a range that spans from "hello" into " world",
    // i.e. "hello world" = plain [4, 15)
    // This crosses two offset map entries
    const { sourceStart, sourceEnd } = plainOffsetToSource(4, 15, offsetMap);

    // sourceStart should be start of "hello" in source = 6
    expect(sourceStart).toBe(6);
    // sourceEnd should be end of " world" in source = 19
    expect(sourceEnd).toBe(19);
    // Note: the source slice will include the ** markers in between,
    // but the positions mark the text boundaries correctly
    expect(source.slice(sourceStart, sourceEnd)).toBe("hello** world");
  });

  it("handles a range spanning from before bold into bold text", () => {
    const source = "Say **hello** world";
    const { plainText, offsetMap } = stripMarkdown(source);

    // "Say hello" in plain text = [0, 9)
    // This spans entry [0,4)->[0,4) and entry [4,9)->[6,11)
    const { sourceStart, sourceEnd } = plainOffsetToSource(0, 9, offsetMap);

    expect(sourceStart).toBe(0);
    expect(sourceEnd).toBe(11);
    // source[0..11] = "Say **hello"
    expect(source.slice(sourceStart, sourceEnd)).toBe("Say **hello");
  });

  it("returns plain text offsets as fallback for unmapped ranges", () => {
    // When a range falls in synthetic text (paragraph breaks), fallback is used
    const source = "Para one.\n\nPara two.";
    const { plainText, offsetMap } = stripMarkdown(source);

    // The \n\n in plain text is at positions 9..11 (between the two paragraphs)
    // This range is synthetic (no offset mapping), so fallback returns input
    const paraOneEnd = plainText.indexOf("\n\n");
    expect(paraOneEnd).toBe(9);

    const { sourceStart, sourceEnd } = plainOffsetToSource(
      paraOneEnd,
      paraOneEnd + 2,
      offsetMap
    );

    // Fallback: returns the input plain text positions since they're in synthetic text
    expect(sourceStart).toBe(paraOneEnd);
    expect(sourceEnd).toBe(paraOneEnd + 2);
  });

  it("handles single character lookups", () => {
    const source = "A **B** C";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("A B C");

    // Look up "B" which is a single character in bold
    const bStart = plainText.indexOf("B");
    const { sourceStart, sourceEnd } = plainOffsetToSource(
      bStart,
      bStart + 1,
      offsetMap
    );
    expect(source.slice(sourceStart, sourceEnd)).toBe("B");
  });

  it("handles italic word source mapping precisely", () => {
    const source = "The *quick* fox";
    // source layout:
    //   "The " = 0..4
    //   "*"    = 4..5
    //   "quick" = 5..10
    //   "*"    = 10..11
    //   " fox" = 11..15
    //
    // plain: "The quick fox"
    //   "The " = plain 0..4  -> source 0..4
    //   "quick" = plain 4..9 -> source 5..10
    //   " fox" = plain 9..13 -> source 11..15

    const { plainText, offsetMap } = stripMarkdown(source);
    expect(plainText).toBe("The quick fox");

    const quickStart = plainText.indexOf("quick");
    const quickEnd = quickStart + "quick".length;

    const { sourceStart, sourceEnd } = plainOffsetToSource(
      quickStart,
      quickEnd,
      offsetMap
    );
    expect(sourceStart).toBe(5);
    expect(sourceEnd).toBe(10);
    expect(source.slice(sourceStart, sourceEnd)).toBe("quick");
  });

  it("handles link text source mapping", () => {
    const source = "See [the docs](https://docs.example.com) now.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("See the docs now.");

    // "the docs" in plain text
    const docsStart = plainText.indexOf("the docs");
    const docsEnd = docsStart + "the docs".length;

    const { sourceStart, sourceEnd } = plainOffsetToSource(
      docsStart,
      docsEnd,
      offsetMap
    );
    expect(source.slice(sourceStart, sourceEnd)).toBe("the docs");
  });

  it("handles heading text source mapping", () => {
    const source = "## Section Title";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("Section Title");

    const titleStart = plainText.indexOf("Section Title");
    const titleEnd = titleStart + "Section Title".length;

    const { sourceStart, sourceEnd } = plainOffsetToSource(
      titleStart,
      titleEnd,
      offsetMap
    );
    expect(source.slice(sourceStart, sourceEnd)).toBe("Section Title");
  });
});

// ===========================================================================
// Additional edge cases
// ===========================================================================
describe("edge cases", () => {
  it("handles consecutive bold and italic words", () => {
    const source = "**bold** and *italic*";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("bold and italic");

    expectWordMapsBack(source, plainText, offsetMap, "bold");
    expectWordMapsBack(source, plainText, offsetMap, " and ");
    expectWordMapsBack(source, plainText, offsetMap, "italic");
  });

  it("handles multiple links in a paragraph", () => {
    const source = "[A](url1) and [B](url2)";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("A and B");
    expectWordMapsBack(source, plainText, offsetMap, "A");
    expectWordMapsBack(source, plainText, offsetMap, "B");
  });

  it("handles a document with only a code block", () => {
    const source = "```\ncode\n```";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("");
    expect(offsetMap).toEqual([]);
  });

  it("handles a document with only an image", () => {
    const source = "![](image.png)";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toBe("");
    expect(offsetMap).toEqual([]);
  });

  it("preserves text around inline code", () => {
    const source = "Run `npm install` then `npm start` to begin.";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("Run");
    expect(plainText).toContain("then");
    expect(plainText).toContain("to begin.");
    expect(plainText).not.toContain("npm install");
    expect(plainText).not.toContain("npm start");

    expectWordMapsBack(source, plainText, offsetMap, "Run ");
    expectWordMapsBack(source, plainText, offsetMap, " to begin.");
  });

  it("offset map entries are in order and non-overlapping", () => {
    const source =
      "# Title\n\nParagraph with **bold** and *italic* words.\n\n- List item\n\n> Quote";
    const { offsetMap } = stripMarkdown(source);

    for (let i = 0; i < offsetMap.length; i++) {
      const entry = offsetMap[i];
      // Each entry should have valid ranges
      expect(entry.plainEnd).toBeGreaterThan(entry.plainStart);
      expect(entry.sourceEnd).toBeGreaterThan(entry.sourceStart);

      // Entries should be in order (non-overlapping in plain text space)
      if (i > 0) {
        expect(entry.plainStart).toBeGreaterThanOrEqual(
          offsetMap[i - 1].plainEnd
        );
      }
    }
  });

  it("handles blockquote with bold text inside", () => {
    const source = "> This is **important** info";
    const { plainText, offsetMap } = stripMarkdown(source);

    expect(plainText).toContain("This is");
    expect(plainText).toContain("important");
    expect(plainText).toContain("info");

    expectWordMapsBack(source, plainText, offsetMap, "important");
  });
});
