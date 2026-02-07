/**
 * Strips markdown to plain text while maintaining an offset map that maps
 * plain text positions back to original markdown source positions.
 *
 * This is the foundation for word-by-word highlighting: TTS engines operate
 * on plain text, but we need to highlight words in the original markdown source.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Content, Text } from "mdast";
import type { OffsetMapping, StrippedMarkdown } from "./types.js";

/**
 * Internal accumulator used while walking the AST to build the plain text
 * string and offset map simultaneously.
 */
interface BuilderState {
  /** The plain text built so far */
  chunks: string[];
  /** Current offset in the plain text */
  plainOffset: number;
  /** Accumulated offset mappings */
  offsetMap: OffsetMapping[];
  /** Whether a paragraph break is pending (deferred so we don't add trailing breaks) */
  pendingBreak: boolean;
}

/**
 * Node types that represent top-level block containers. When transitioning
 * between these we insert paragraph breaks in the plain text output.
 */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "thematicBreak",
]);

/**
 * Node types that should be skipped entirely (not walked into).
 */
const SKIP_TYPES = new Set(["code", "inlineCode", "image", "html", "yaml", "toml"]);

/**
 * Strip markdown source to plain text and build an offset map that relates
 * every character in the plain text back to its position in the original source.
 *
 * @param source - The raw markdown source string
 * @returns An object with the plain text and offset mappings
 */
export function stripMarkdown(source: string): StrippedMarkdown {
  const tree = unified().use(remarkParse).parse(source);

  const state: BuilderState = {
    chunks: [],
    plainOffset: 0,
    offsetMap: [],
    pendingBreak: false,
  };

  walkNode(tree, state);

  const plainText = state.chunks.join("");
  return { plainText, offsetMap: state.offsetMap };
}

/**
 * Recursively walk an mdast node, extracting text content and building
 * the offset map. This function handles the dispatching logic for different
 * node types.
 */
function walkNode(
  node: Root | Content,
  state: BuilderState
): void {
  // Skip nodes whose content we don't want in the plain text
  if ("type" in node && SKIP_TYPES.has(node.type)) {
    return;
  }

  // For text and other leaf nodes that carry literal text content
  if (node.type === "text") {
    flushPendingBreak(state);
    appendTextNode(node as Text, state);
    return;
  }

  // Break node (hard break, e.g. trailing two spaces + newline): insert a space
  if (node.type === "break") {
    flushPendingBreak(state);
    appendSyntheticText(" ", state);
    return;
  }

  // Thematic break (---): skip, but mark a paragraph break
  if (node.type === "thematicBreak") {
    if (state.plainOffset > 0) {
      state.pendingBreak = true;
    }
    return;
  }

  // For block-level nodes, we manage paragraph breaks
  const isBlock = BLOCK_TYPES.has(node.type);

  if (isBlock && state.plainOffset > 0) {
    state.pendingBreak = true;
  }

  // Walk children if the node has them
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children as Content[]) {
      walkNode(child, state);
    }
  }

  // After a block-level node, mark that a break is pending before the next block
  if (isBlock && state.plainOffset > 0) {
    state.pendingBreak = true;
  }
}

/**
 * If a paragraph break is pending, flush it into the output.
 * We use "\n\n" as the paragraph separator.
 */
function flushPendingBreak(state: BuilderState): void {
  if (state.pendingBreak) {
    state.pendingBreak = false;
    // Only add the break if we actually have content already
    if (state.plainOffset > 0) {
      const breakStr = "\n\n";
      state.chunks.push(breakStr);
      state.plainOffset += breakStr.length;
      // No offset mapping for synthetic paragraph breaks since they
      // don't correspond to a specific source location
    }
  }
}

/**
 * Append an actual text node from the AST. This creates an offset mapping
 * entry that maps the text's position in the plain output to its position
 * in the original markdown source.
 */
function appendTextNode(node: Text, state: BuilderState): void {
  const text = node.value;
  if (text.length === 0) {
    return;
  }

  const sourceStart = node.position?.start.offset;
  const sourceEnd = node.position?.end.offset;

  if (sourceStart === undefined || sourceEnd === undefined) {
    // If position info is missing, still append the text but without mapping
    appendSyntheticText(text, state);
    return;
  }

  const plainStart = state.plainOffset;
  const plainEnd = plainStart + text.length;

  state.chunks.push(text);
  state.plainOffset = plainEnd;

  state.offsetMap.push({
    plainStart,
    plainEnd,
    sourceStart,
    sourceEnd,
  });
}

/**
 * Append synthetic text that doesn't directly correspond to a source node
 * (e.g. paragraph breaks, spaces for soft breaks). No offset mapping is created.
 */
function appendSyntheticText(text: string, state: BuilderState): void {
  if (text.length === 0) {
    return;
  }
  state.chunks.push(text);
  state.plainOffset += text.length;
}

/**
 * Given a range in the plain text (e.g. a word boundary from the TTS engine),
 * find the corresponding range in the original markdown source using the offset map.
 *
 * This performs a lookup through the offset map entries to translate plain text
 * positions to source positions. It handles the case where the range spans
 * multiple offset map entries (e.g. a word that crosses an inline formatting boundary).
 *
 * @param plainStart - Start offset in the plain text
 * @param plainEnd - End offset in the plain text
 * @param offsetMap - The offset map from stripMarkdown
 * @returns The corresponding source range, or the input range if no mapping is found
 */
export function plainOffsetToSource(
  plainStart: number,
  plainEnd: number,
  offsetMap: OffsetMapping[]
): { sourceStart: number; sourceEnd: number } {
  let sourceStart: number | null = null;
  let sourceEnd: number | null = null;

  for (const entry of offsetMap) {
    // Check if this entry overlaps with our plain text range
    if (entry.plainEnd <= plainStart) {
      // Entry is entirely before our range
      continue;
    }
    if (entry.plainStart >= plainEnd) {
      // Entry is entirely after our range; since entries are ordered, we can stop
      break;
    }

    // This entry overlaps with our range. Compute the source positions.
    // The key insight: within a single text node, the offset relationship is linear.
    // plainStart - entry.plainStart characters into the plain text corresponds to
    // sourceStart + (plainStart - entry.plainStart) characters into the source.

    if (sourceStart === null) {
      // Clamp plainStart to this entry's range
      const clampedPlainStart = Math.max(plainStart, entry.plainStart);
      const deltaFromEntryStart = clampedPlainStart - entry.plainStart;
      sourceStart = entry.sourceStart + deltaFromEntryStart;
    }

    // Always update sourceEnd with the latest overlapping entry
    const clampedPlainEnd = Math.min(plainEnd, entry.plainEnd);
    const deltaFromEntryStart = clampedPlainEnd - entry.plainStart;
    sourceEnd = entry.sourceStart + deltaFromEntryStart;
  }

  if (sourceStart !== null && sourceEnd !== null) {
    return { sourceStart, sourceEnd };
  }

  // Fallback: if no mapping was found (e.g. the range falls entirely in
  // synthetic text like paragraph breaks), return the plain text offsets.
  // This is a best-effort fallback; callers should be aware.
  return { sourceStart: plainStart, sourceEnd: plainEnd };
}
