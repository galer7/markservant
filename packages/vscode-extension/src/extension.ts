/**
 * MarkServant TTS Extension
 *
 * Reads markdown files aloud using Kokoro TTS with word-by-word highlighting
 * in the VS Code editor. This is the main extension entry point that
 * orchestrates the full pipeline:
 *
 *   1. Strip markdown to plain text (preserving offset map)
 *   2. Split into ~500 char chunks
 *   3. Synthesize each chunk via Kokoro-FastAPI (with pre-fetching)
 *   4. Play audio in a webview panel
 *   5. Highlight words in the editor using decoration API
 */

import * as vscode from "vscode";
import { WordHighlighter } from "./highlight/decorator.js";
import { mapWordsToSource } from "./highlight/wordMapper.js";
import { PlayerPanel } from "./player/playerPanel.js";
import { splitIntoChunks } from "./tts/chunkSplitter.js";
import { KokoroClient } from "./tts/kokoroClient.js";
import { stripMarkdown } from "./tts/markdownStripper.js";
import type { SynthesizedChunk, TextChunk } from "./tts/types.js";

// ---------------------------------------------------------------------------
// Playback state
// ---------------------------------------------------------------------------

/** All synthesized chunks for the current document. */
let synthesizedChunks: SynthesizedChunk[] = [];

/** Index of the chunk currently being played. */
let currentPlayingChunk = -1;

/** The text chunks (pre-synthesis) for the current document. */
let textChunks: TextChunk[] = [];

/** The editor that initiated the current reading session. */
let activeEditor: vscode.TextEditor | undefined;

/** Word highlighter instance. */
let highlighter: WordHighlighter | undefined;

/** Status bar item shown during playback. */
let statusBarItem: vscode.StatusBarItem | undefined;

/** Listener for document changes (to stop playback if doc is edited). */
let docChangeListener: vscode.Disposable | undefined;

/** Listener for active editor changes. */
let editorChangeListener: vscode.Disposable | undefined;

/** Whether a reading session is currently active. */
let isReading = false;

/** Pre-fetched next chunk (synthesized while current chunk plays). */
let prefetchPromise: Promise<SynthesizedChunk | null> | undefined;

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  // Register the "Read Aloud" command
  const readAloudCmd = vscode.commands.registerCommand("markservant-tts.readAloud", () =>
    readAloud(context),
  );

  // Register the "Stop Reading" command
  const stopCmd = vscode.commands.registerCommand("markservant-tts.stop", () => stopReading());

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "markservant-tts.stop";

  context.subscriptions.push(readAloudCmd, stopCmd, statusBarItem);
}

export function deactivate() {
  stopReading();
  highlighter?.dispose();
  highlighter = undefined;
}

// ---------------------------------------------------------------------------
// Read Aloud command
// ---------------------------------------------------------------------------

async function readAloud(context: vscode.ExtensionContext) {
  // If already reading, stop and start fresh
  if (isReading) {
    stopReading();
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor to read from.");
    return;
  }

  if (editor.document.languageId !== "markdown") {
    vscode.window.showWarningMessage("Read Aloud only works with markdown files.");
    return;
  }

  // Read config
  const config = vscode.workspace.getConfiguration("markservant-tts");
  const serverUrl = config.get<string>("serverUrl", "http://localhost:8880");
  const voice = config.get<string>("voice", "af_heart");
  const speed = config.get<number>("speed", 1.0);

  const client = new KokoroClient(serverUrl, voice, speed);

  // Check server availability
  const available = await client.isAvailable();
  if (!available) {
    await vscode.window.showErrorMessage(
      "Kokoro TTS server is not running. Start it with `msv tts-server start`.",
      "OK",
    );
    return;
  }

  // Strip markdown and split into chunks
  const source = editor.document.getText();
  const stripped = stripMarkdown(source);

  if (stripped.plainText.trim().length === 0) {
    vscode.window.showInformationMessage("Document has no readable text content.");
    return;
  }

  textChunks = splitIntoChunks(stripped);
  if (textChunks.length === 0) {
    vscode.window.showInformationMessage("Document has no readable text content.");
    return;
  }

  // Initialize state
  isReading = true;
  activeEditor = editor;
  synthesizedChunks = [];
  currentPlayingChunk = -1;
  prefetchPromise = undefined;

  // Create highlighter
  if (!highlighter) {
    highlighter = new WordHighlighter();
  }

  // Show status bar
  if (statusBarItem) {
    statusBarItem.text = "$(megaphone) Reading...";
    statusBarItem.tooltip = "Click to stop reading";
    statusBarItem.show();
  }

  // Watch for document changes — stop if edited
  docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (activeEditor && e.document === activeEditor.document) {
      vscode.window.showInformationMessage("Document edited — stopping Read Aloud.");
      stopReading();
    }
  });

  // Watch for editor changes — track active editor for highlighting
  editorChangeListener = vscode.window.onDidChangeActiveTextEditor((e) => {
    if (e && activeEditor && e.document === activeEditor.document) {
      activeEditor = e;
    }
  });

  // Create/show the player panel
  const panel = PlayerPanel.createOrShow(context.extensionUri);

  // Handle panel disposal
  panel.onDidDispose(() => {
    stopReading();
  });

  // Handle messages from the webview
  panel.onMessage("highlightWord", (msg) => {
    if (msg.type !== "highlightWord") return;
    if (!isReading || !activeEditor || !highlighter) return;

    // The index is relative to the current chunk's mapped words
    const chunkData = synthesizedChunks[currentPlayingChunk];
    if (!chunkData) return;

    const mappedWord = chunkData.mappedWords[msg.index];
    if (!mappedWord) return;

    highlighter.highlightWord(activeEditor, mappedWord.sourceStart, mappedWord.sourceEnd);
  });

  panel.onMessage("chunkEnded", () => {
    if (!isReading) return;
    void playNextChunk(client, panel);
  });

  panel.onMessage("playbackStopped", () => {
    stopReading();
  });

  panel.onMessage("ready", () => {
    // Webview is ready — synthesize first chunk and start
    void synthesizeAndPlay(client, panel, 0);
  });

  panel.onMessage("error", (msg) => {
    if (msg.type !== "error") return;
    void vscode.window.showErrorMessage(`TTS playback error: ${msg.message}`);
    stopReading();
  });
}

// ---------------------------------------------------------------------------
// Synthesis + playback orchestration
// ---------------------------------------------------------------------------

async function synthesizeAndPlay(client: KokoroClient, panel: PlayerPanel, chunkIndex: number) {
  if (!isReading || chunkIndex >= textChunks.length) {
    // All chunks done
    stopReading();
    return;
  }

  try {
    // Synthesize this chunk
    const chunk = textChunks[chunkIndex];
    const synthesized = await synthesizeChunk(client, chunk, chunkIndex);

    if (!isReading) return; // User may have stopped while we were synthesizing

    synthesizedChunks[chunkIndex] = synthesized;
    currentPlayingChunk = chunkIndex;

    // Send audio to webview
    panel.postMessage({
      type: "loadAudio",
      audioBase64: synthesized.audioBase64,
      chunkIndex,
      totalChunks: textChunks.length,
    });

    // Send timestamps so the webview timing loop can match words
    panel.postMessage({
      type: "setTimestamps",
      timestamps: synthesized.mappedWords.map((w) => ({
        word: w.word,
        start_time: w.startTime,
        end_time: w.endTime,
      })),
    });

    // Pre-fetch next chunk while this one plays
    if (chunkIndex + 1 < textChunks.length) {
      prefetchPromise = synthesizeChunk(client, textChunks[chunkIndex + 1], chunkIndex + 1).catch(
        () => null,
      ); // Don't fail the current playback if pre-fetch fails
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`TTS synthesis failed: ${message}`);
    stopReading();
  }
}

async function synthesizeChunk(
  client: KokoroClient,
  chunk: TextChunk,
  chunkIndex: number,
): Promise<SynthesizedChunk> {
  const response = await client.synthesize(chunk.text);

  // Compute the time offset: sum of all previous chunks' audio durations.
  // We don't have exact durations, but each chunk's words use times relative
  // to 0, so for highlighting purposes within a chunk, timeOffset = 0.
  // Cross-chunk absolute times aren't needed since we reset per chunk.
  const mappedWords = mapWordsToSource(response.timestamps, chunk, 0);

  return {
    audioBase64: response.audio,
    mappedWords,
    index: chunkIndex,
  };
}

async function playNextChunk(client: KokoroClient, panel: PlayerPanel) {
  if (!isReading) return;

  const nextIndex = currentPlayingChunk + 1;

  if (nextIndex >= textChunks.length) {
    // All chunks played
    if (statusBarItem) {
      statusBarItem.text = "$(megaphone) Finished";
    }
    // Small delay before cleanup so the user sees "Finished"
    setTimeout(() => stopReading(), 1500);
    return;
  }

  // Use pre-fetched chunk if available
  if (prefetchPromise) {
    try {
      const prefetched = await prefetchPromise;
      prefetchPromise = undefined;

      if (!isReading) return;

      if (prefetched) {
        synthesizedChunks[nextIndex] = prefetched;
        currentPlayingChunk = nextIndex;

        panel.postMessage({
          type: "loadAudio",
          audioBase64: prefetched.audioBase64,
          chunkIndex: nextIndex,
          totalChunks: textChunks.length,
        });

        panel.postMessage({
          type: "setTimestamps",
          timestamps: prefetched.mappedWords.map((w) => ({
            word: w.word,
            start_time: w.startTime,
            end_time: w.endTime,
          })),
        });

        // Pre-fetch the one after
        if (nextIndex + 1 < textChunks.length) {
          prefetchPromise = synthesizeChunk(client, textChunks[nextIndex + 1], nextIndex + 1).catch(
            () => null,
          );
        }

        return;
      }
    } catch {
      // Pre-fetch failed, fall through to synthesize fresh
    }
  }

  // No pre-fetched chunk available — synthesize now
  await synthesizeAndPlay(client, panel, nextIndex);
}

// ---------------------------------------------------------------------------
// Stop reading
// ---------------------------------------------------------------------------

function stopReading() {
  isReading = false;
  prefetchPromise = undefined;

  // Clear decorations
  if (highlighter && activeEditor) {
    highlighter.clearHighlight(activeEditor);
  }

  // Stop the webview
  const panel = PlayerPanel.current;
  if (panel) {
    panel.postMessage({ type: "stop" });
  }

  // Hide status bar
  if (statusBarItem) {
    statusBarItem.hide();
  }

  // Clean up listeners
  docChangeListener?.dispose();
  docChangeListener = undefined;
  editorChangeListener?.dispose();
  editorChangeListener = undefined;

  // Reset state
  activeEditor = undefined;
  synthesizedChunks = [];
  textChunks = [];
  currentPlayingChunk = -1;
}
