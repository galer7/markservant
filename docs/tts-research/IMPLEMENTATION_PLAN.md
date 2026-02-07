# Implementation Plan: Kokoro TTS with Word-by-Word Highlighting

## Context

markservant (`msv`) serves markdown files via markserv on localhost. The user currently reads markdown in Microsoft Edge for its "Read Aloud" feature (Ryan voice, word-by-word highlighting). We want to bring this experience into VS Code — read markdown aloud using **Kokoro TTS** (82M param open-source model, runs locally) with word-by-word highlighting in the editor.

Two pieces to build:
1. **`msv tts-server`** CLI commands — manage a Kokoro-FastAPI Docker container
2. **VS Code extension** (in `vscode-extension/` dir, same repo) — read aloud + highlight words

---

## Phase 1: `msv tts-server start/stop/status` CLI Commands — DONE

Phase 1 is complete. All files implemented and tested (45 new tests, 259 total passing).

### What was built
- **`src/lib/docker.js`** — Docker container lifecycle: `isDockerAvailable()`, `isContainerRunning()`, `getContainerInfo()`, `pullImageIfNeeded()`, `startContainer()`, `stopContainer()`, `waitForHealthCheck()`
- **`src/commands/tts-server.js`** — `startTtsServer()`, `stopTtsServer()`, `statusTtsServer()` with TTS config read/write via existing config.js (ttsServer field in config.json)
- **`src/lib/docker.test.js`** — 28 tests covering all Docker lifecycle functions with mocked exec
- **`src/commands/tts-server.test.js`** — 17 tests covering all three subcommands, custom config, error paths
- **`bin/msv.js`** — registered `tts-server` command group with `start`, `stop`, `status` subcommands

### Design decisions
- TTS config stored as `ttsServer: { containerName, port, image }` field in existing config.json (no separate config file)
- `getTtsConfig()` / `saveTtsConfig()` live in tts-server.js (not config.js) since they're TTS-specific
- Health check uses curl + exponential backoff (1s→5s cap), 2 min timeout for model loading
- Container is force-removed before start to handle stale stopped containers

---

## Phases 2–5: VS Code Extension — DONE

Phases 2 through 5 were implemented together as a single unit. All files built and tested (100 new tests, 359 total passing).

### What was built

**Extension scaffold (`vscode-extension/`)**
- **`package.json`** — Extension manifest with commands (`readAloud`, `stop`), `Cmd+Shift+R` keybinding, configuration (`serverUrl`, `voice`, `speed`), esbuild build
- **`tsconfig.json`** — TypeScript config targeting ES2022 with bundler module resolution
- **`esbuild.config.mjs`** — Bundles extension to CJS + copies media files to `dist/media/`

**TTS pipeline (`src/tts/`)**
- **`types.ts`** — Shared interfaces: `OffsetMapping`, `StrippedMarkdown`, `TextChunk`, `WordTimestamp`, `CaptionedSpeechResponse`, `MappedWord`, `SynthesizedChunk`, webview message types
- **`markdownStripper.ts`** — Parses markdown via `remark-parse`, walks mdast AST to build plain text + `OffsetMapping[]`. Strips headings/bold/italic/links, skips code blocks/images. Includes `plainOffsetToSource()` for reverse mapping.
- **`chunkSplitter.ts`** — Splits plain text into ~500 char chunks on paragraph/sentence/word boundaries. Each chunk carries its offset map slice with adjusted relative positions.
- **`kokoroClient.ts`** — HTTP client for Kokoro-FastAPI `POST /dev/captioned_speech`. Health check with 10s timeout, synthesis with 60s timeout. Actionable error messages suggesting `msv tts-server start`.

**Webview player (`src/player/` + `media/`)**
- **`playerPanel.ts`** — Singleton webview panel with `retainContextWhenHidden`, bidirectional `postMessage` communication, proper lifecycle/disposal management.
- **`playerHtml.ts`** — Webview HTML with CSP (`media-src data: blob:`, nonce-based `script-src`), VS Code theme-aware CSS variables, accessible play/pause/stop SVG buttons.
- **`media/player.js`** — Webview-side: `requestAnimationFrame` timing loop at ~60fps, binary search for current word, autoplay policy handling, chunk transition management.
- **`media/player.css`** — Theme-aware styles using `--vscode-*` CSS variables, responsive layout.

**Word highlighting (`src/highlight/`)**
- **`wordMapper.ts`** — Maps TTS word timestamps to source positions via offset map. Three-strategy fuzzy matching (exact, stripped-punctuation, backtrack) to handle TTS quirks.
- **`decorator.ts`** — `WordHighlighter` class with yellow (light) / blue (dark) background, 3px border-radius, auto-scroll via `revealRange`.

**Orchestrator**
- **`extension.ts`** — Registers commands, orchestrates full pipeline: strip markdown → split chunks → synthesize via Kokoro → play in webview → highlight words in editor. Pre-fetches next chunk. Handles: document editing stops playback, re-invoke stops current, webview close cleanup, status bar.

**Tests (100 tests across 4 files)**
- **`test/markdownStripper.test.ts`** — 39 tests: all markdown elements, offset map accuracy, edge cases
- **`test/chunkSplitter.test.ts`** — 28 tests: paragraph grouping, sentence/word splitting, offset map slicing
- **`test/kokoroClient.test.ts`** — 14 tests: mocked fetch, all error paths, request body validation
- **`test/wordMapper.test.ts`** — 19 tests: offset mapping, fuzzy word matching, punctuation handling

### Design decisions
- Webview with HTML5 `<audio>` for cross-platform audio playback with timing precision
- `retainContextWhenHidden: true` so audio continues when tab is hidden
- CSP with nonce-based script-src for security
- Binary search for O(log n) word lookup during rAF loop
- Three-strategy fuzzy word matching to handle TTS returning different punctuation/casing
- Pre-fetching next chunk while current plays for seamless transitions
- Document change listener stops playback immediately (stale offsets would cause wrong highlights)

---

## Verification Plan

1. **Start Kokoro server**: `msv tts-server start` — verify container runs, health check passes
2. **Install extension**: `cd vscode-extension && npm run build && code --install-extension markservant-tts-0.1.0.vsix`
3. **Test short file**: Open a 1-paragraph markdown file, Cmd+Shift+R, verify audio + highlighting
4. **Test formatting**: File with headings, bold, links, code blocks — verify code is skipped, links read as text, highlights land on correct words
5. **Test long file**: 3000+ word document — verify chunked playback, seamless transitions
6. **Test stop**: Stop mid-playback — decorations clear immediately
7. **Test edit**: Edit document during playback — playback stops
8. **Run unit tests**: `cd vscode-extension && npm test`
9. **Run CLI tests**: `npm test` (from project root)
10. **Stop server**: `msv tts-server stop` — container removed
