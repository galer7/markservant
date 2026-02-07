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

## Phase 2: VS Code Extension Scaffold + Audio Playback

### Directory structure

```
vscode-extension/
  package.json          # Extension manifest (commands, config, keybindings)
  tsconfig.json
  esbuild.config.mjs    # Bundle extension + copy media files
  src/
    extension.ts        # activate/deactivate, register commands
    tts/
      kokoroClient.ts   # HTTP client for Kokoro-FastAPI
      markdownStripper.ts  # MD -> plain text + offset map
      chunkSplitter.ts  # Split plain text into ~500 char chunks
      types.ts          # Shared interfaces
    player/
      playerPanel.ts    # Webview panel lifecycle + messaging
      playerHtml.ts     # Webview HTML generator
    highlight/
      decorator.ts      # VS Code decoration management
      wordMapper.ts     # Map TTS word indices -> editor Ranges
  media/
    player.js           # Webview-side JS (audio, rAF loop, postMessage)
    player.css          # Webview styles (VS Code theme-aware)
  test/
    markdownStripper.test.ts
    chunkSplitter.test.ts
    wordMapper.test.ts
    kokoroClient.test.ts
```

### Extension manifest highlights
- Command: `markservant-tts.readAloud` ("Read Aloud") — appears in editor title bar for markdown files
- Command: `markservant-tts.stop` ("Stop Reading")
- Keybinding: `Cmd+Shift+R` (macOS)
- Config: `serverUrl` (default `http://localhost:8880`), `voice` (default `af_heart`), `speed` (default `1.0`)

### Audio playback approach
- **Webview panel** with HTML5 `<audio>` element (only reliable option with timing)
- `retainContextWhenHidden: true` so audio continues when user switches tabs
- Content Security Policy: `media-src data: blob:;` for base64 audio data URIs
- Play button click required for first playback (browser autoplay policy in VS Code webviews)
- After first user gesture, subsequent `audio.play()` calls work programmatically (for chunk transitions)

### Milestone
Extension installs, "Read Aloud" command appears for markdown files, webview panel opens with play/pause/stop controls and plays test audio.

---

## Phase 3: Markdown Stripping with Offset Mapping

### Problem
TTS should read "Hello World" not "# Hello **World**". But when highlighting, we need to find "World" at its position in the original source (offset 10-18 including `**`), not in the plain text (offset 6-11).

### Approach
Use `remark-parse` (unified ecosystem) to get an mdast AST. Each text node has `position.start.offset` / `position.end.offset` in the source. Walk text nodes, build plain text + an `OffsetMapping[]` array that maps plain text ranges to source ranges.

### `markdownStripper.ts` key functions
- `stripMarkdown(source)` -> `{ plainText, offsetMap: OffsetMapping[] }`
  - Walks AST text nodes, skips code blocks, inserts paragraph breaks
  - Each text node adds an `OffsetMapping { plainStart, plainEnd, sourceStart, sourceEnd }`
- `plainOffsetToSource(plainStart, plainEnd, offsetMap)` -> `{ sourceStart, sourceEnd }`

### `chunkSplitter.ts`
- Split plain text on paragraph boundaries (`\n\n`)
- Group paragraphs up to ~500 chars per chunk
- Each chunk carries its offset map slice

### Milestone
Unit tests pass: headings, bold, italic, links, images, code blocks, lists, blockquotes all stripped correctly. Offset map accurately points back to source positions for every word.

---

## Phase 4: Kokoro Client + Word-by-Word Highlighting

### `kokoroClient.ts`
- `POST /dev/captioned_speech` with `{ model, input, voice, speed, response_format: 'mp3' }`
- Returns `{ audio: base64, timestamps: [{word, start_time, end_time}] }`
- Includes `isAvailable()` health check

### `wordMapper.ts` — the critical bridge
For each TTS word timestamp:
1. Find the word in the chunk's plain text (sequential search from last position)
2. Use `plainOffsetToSource()` to translate to source document offset
3. Convert source offset to `vscode.Range` via `document.positionAt()`

Result: `MappedWord[]` with `{ word, startTime, endTime, editorRange }`

### `decorator.ts`
- One `TextEditorDecorationType`: yellow bg (light) / blue bg (dark), 3px border-radius
- `highlightWord(editor, range)`: `setDecorations` + `revealRange(InCenterIfOutsideViewport)`
- `clearHighlight(editor)`: `setDecorations([])`

### Synchronization flow
1. Webview runs `requestAnimationFrame` loop (~60fps)
2. Binary-searches timestamps array for word matching `audio.currentTime`
3. When word index changes, sends `{ type: 'highlightWord', index }` to extension host
4. Extension host looks up `MappedWord[index].editorRange`, calls `setDecorations`

### Milestone
Full end-to-end: open markdown, run "Read Aloud", Kokoro generates audio, words highlight one-by-one in the editor as audio plays.

---

## Phase 5: Multi-Chunk Documents + Polish

### Chunked playback
- Synthesize chunk 1, start playback
- Pre-fetch chunk 2 while chunk 1 plays
- On chunk 1 `ended` event: load chunk 2 audio, auto-play (user gesture already established)
- Continue until all chunks done

### Edge cases
- **Document edited during playback**: stop playback, clear decorations, show info message
- **Re-invoked while playing**: stop current, start fresh
- **Webview closed**: clean up decorations and state
- **Editor tab switch**: track via `onDidChangeActiveTextEditor`, pause/resume highlighting
- **Kokoro server not running**: clear error message suggesting `msv tts-server start`

### Status bar
- Shows `$(megaphone) Reading...` during playback (click to stop)
- Disappears when idle

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
