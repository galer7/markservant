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

/** Chunk index that playback is waiting for (synthesis hasn't caught up). */
let pendingPlayback: number | undefined;

/** Number of chunks to synthesize before starting playback. */
const SYNTHESIS_BUFFER_THRESHOLD = 3;

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
  const playbackRate = config.get<number>("playbackRate", 1.0);

  const client = new KokoroClient(serverUrl, voice);

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
  pendingPlayback = undefined;

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
  const { panel, isNew } = PlayerPanel.createOrShow(context.extensionUri);

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
    onChunkEnded(panel);
  });

  panel.onMessage("playbackStopped", () => {
    stopReading();
  });

  panel.onMessage("ready", () => {
    panel.postMessage({ type: "setPlaybackRate", rate: playbackRate });
    panel.postMessage({ type: "loading", message: "Synthesizing speech..." });
    void synthesizeAllChunks(client, panel);
  });

  panel.onMessage("error", (msg) => {
    if (msg.type !== "error") return;
    void vscode.window.showErrorMessage(`TTS playback error: ${msg.message}`);
    stopReading();
  });

  panel.onMessage("playbackRateChanged", (msg) => {
    if (msg.type !== "playbackRateChanged") return;
    void vscode.workspace.getConfiguration("markservant-tts").update("playbackRate", msg.rate, true);
  });

  // If panel already existed, webview won't re-send "ready" — start directly
  if (!isNew) {
    panel.postMessage({ type: "setPlaybackRate", rate: playbackRate });
    panel.postMessage({ type: "loading", message: "Synthesizing speech..." });
    void synthesizeAllChunks(client, panel);
  }
}

// ---------------------------------------------------------------------------
// Synthesis + playback orchestration
// ---------------------------------------------------------------------------

async function synthesizeAllChunks(client: KokoroClient, panel: PlayerPanel) {
  let playbackStarted = false;
  const chunkTimings: number[] = [];

  for (let i = 0; i < textChunks.length; i++) {
    if (!isReading) break;

    const chunkStart = Date.now();

    try {
      const response = await client.synthesize(textChunks[i].text);
      if (!isReading) break;

      const mappedWords = mapWordsToSource(response.timestamps, textChunks[i], 0);
      synthesizedChunks[i] = {
        audioBase64: response.audio,
        mappedWords,
        index: i,
      };
    } catch (err: unknown) {
      if (!isReading) break;
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`TTS synthesis failed on chunk ${i + 1}: ${message}`);
      stopReading();
      return;
    }

    const elapsed = Date.now() - chunkStart;
    chunkTimings.push(elapsed);

    // Send synthesis progress to webview
    const avgMs = chunkTimings.reduce((a, b) => a + b, 0) / chunkTimings.length;
    const remainingChunks = textChunks.length - (i + 1);
    const remainingMs = Math.round(avgMs * remainingChunks);

    panel.postMessage({
      type: "synthProgress",
      current: i + 1,
      total: textChunks.length,
      avgMs: Math.round(avgMs),
      remainingMs,
    });

    // Start playback once we have enough chunks buffered
    const threshold = Math.min(SYNTHESIS_BUFFER_THRESHOLD, textChunks.length);
    if (!playbackStarted && i + 1 >= threshold) {
      playbackStarted = true;
      playChunk(panel, 0);
    }

    // If playback is waiting for this chunk, play it now
    if (pendingPlayback !== undefined && pendingPlayback === i) {
      playChunk(panel, pendingPlayback);
      pendingPlayback = undefined;
    }
  }

  if (isReading) {
    panel.postMessage({ type: "synthComplete" });
  }
}

function playChunk(panel: PlayerPanel, index: number) {
  const chunk = synthesizedChunks[index];
  if (!chunk) return;

  currentPlayingChunk = index;

  panel.postMessage({
    type: "loadAudio",
    audioBase64: chunk.audioBase64,
    chunkIndex: index,
    totalChunks: textChunks.length,
  });

  panel.postMessage({
    type: "setTimestamps",
    timestamps: chunk.mappedWords.map((w) => ({
      word: w.word,
      start_time: w.startTime,
      end_time: w.endTime,
    })),
  });
}

function onChunkEnded(panel: PlayerPanel) {
  if (!isReading) return;

  const nextIndex = currentPlayingChunk + 1;

  if (nextIndex >= textChunks.length) {
    if (statusBarItem) {
      statusBarItem.text = "$(megaphone) Finished";
    }
    setTimeout(() => stopReading(), 1500);
    return;
  }

  if (synthesizedChunks[nextIndex]) {
    // Next chunk is ready — play immediately
    playChunk(panel, nextIndex);
  } else {
    // Synthesis hasn't caught up — wait
    pendingPlayback = nextIndex;
    panel.postMessage({ type: "loading", message: "Buffering..." });
  }
}

// ---------------------------------------------------------------------------
// Stop reading
// ---------------------------------------------------------------------------

function stopReading() {
  isReading = false;
  pendingPlayback = undefined;

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
