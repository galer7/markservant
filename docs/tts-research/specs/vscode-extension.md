# VS Code Extension: Audio Playback + Word Highlighting

## Existing Extensions

| Extension | Engine | Word Highlighting? |
|-----------|--------|--------------------|
| **ElevenLabs TTS** (lekman) | ElevenLabs API | Yes — in webview panel (not in-editor) |
| **Read Aloud Text** (azu) | System voices | Sentence-level only |
| **Vocalize MD** (Geguchh024) | Deepgram | Sentence-level only |
| **Speechify** (luckyxmobile) | Azure Neural | No |
| **Piper TTS** (SethMiller) | Piper local | No |
| **VS Code Speech** (Microsoft) | Local | STT only, not TTS |

**None provide true word-by-word in-editor highlighting like Edge Read Aloud.**

## Audio Playback Options

### Option A: Webview + HTML5 Audio (RECOMMENDED)

A VS Code Webview is an iframe with full HTML/JS capabilities.

Advantages:
- Full HTML5 Audio API: `currentTime`, `play()`, `pause()`, `seek()`
- High-precision timing via `requestAnimationFrame` (~16ms at 60fps)
- Bidirectional `postMessage` with extension host
- Cross-platform, no native dependencies
- Supports WAV, MP3, OGG, FLAC (NOT AAC)

```typescript
const panel = vscode.window.createWebviewPanel(
  'ttsPlayer', 'TTS Player',
  vscode.ViewColumn.Beside,
  { enableScripts: true, retainContextWhenHidden: true }  // audio continues when tab hidden
);

// Serve local audio:
const audioUri = panel.webview.asWebviewUri(audioFileUri);
```

### Option B: Child Process (afplay/aplay) — NOT recommended

`play-sound` npm package shells out to system players. **Cannot track playback position** — no way to sync highlighting.

### Option C: node-speaker / naudiodon — NOT recommended

Native PortAudio bindings. Platform-specific compilation makes packaging painful.

## Decoration API for Word Highlighting

### Create Highlight Style

```typescript
const wordHighlight = vscode.window.createTextEditorDecorationType({
  light: { backgroundColor: '#FFFF0066' },   // yellow for light themes
  dark: { backgroundColor: '#264F78' },       // blue for dark themes
  borderRadius: '3px',
});
```

### Move Highlight to Current Word

```typescript
function highlightWord(editor: vscode.TextEditor, startOffset: number, endOffset: number) {
  const range = new vscode.Range(
    editor.document.positionAt(startOffset),
    editor.document.positionAt(endOffset)
  );
  editor.setDecorations(wordHighlight, [range]);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
```

### Performance

- Updating 1 decoration range every 200-300ms is well within performance limits
- `setDecorations()` replaces previous decorations — no cleanup needed
- Create the `TextEditorDecorationType` once, reuse it

### Scroll Tracking

`editor.revealRange(range, TextEditorRevealType.InCenterIfOutsideViewport)`:
- Only scrolls when the word leaves the viewport
- Centers the word when scrolling is needed
- Avoids jarring movement for words on the same screen

## Synchronization Architecture

```
[Kokoro-FastAPI Server] --> audio.wav + timestamps.json
        |
        v
[Extension Host (Node.js)]
   - Stores word timestamps: [{word, start, end, startOffset, endOffset}]
   - Receives timing messages from webview
   - Calls setDecorations() + revealRange() on editor
        |  ^
        |  | postMessage (bidirectional)
        v  |
[Webview Panel (HTML/JS)]
   - Plays audio via <audio> element
   - Runs requestAnimationFrame loop (~16ms precision)
   - Determines current word from timestamps + audio.currentTime
   - Sends { type: 'highlightWord', index } to extension host
```

### Webview Side: Timing Loop

```javascript
const audio = document.getElementById('audioPlayer');
const vscode = acquireVsCodeApi();
let lastWordIndex = -1;

function tick() {
  if (!audio.paused) {
    const time = audio.currentTime;
    const idx = findWordAtTime(time);  // binary search through timestamps
    if (idx !== lastWordIndex) {
      lastWordIndex = idx;
      vscode.postMessage({ type: 'highlightWord', index: idx });
    }
    requestAnimationFrame(tick);
  }
}
audio.addEventListener('play', () => requestAnimationFrame(tick));
```

### Extension Side: Decoration Update

```typescript
panel.webview.onDidReceiveMessage((msg) => {
  if (msg.type === 'highlightWord') {
    const word = timestamps[msg.index];
    highlightWord(editor, word.startOffset, word.endOffset);
  }
});
```

### Binary Search for Current Word

```typescript
function findWordAtTime(words: WordTimestamp[], time: number): number {
  let low = 0, high = words.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (time < words[mid].start) high = mid - 1;
    else if (time > words[mid].end) low = mid + 1;
    else return mid;
  }
  return -1;
}
```

## Extension Packaging: Don't Bundle Python

Kokoro TTS should run as a **separate local server** (Kokoro-FastAPI), not bundled inside the extension.

Why:
- Python + PyTorch/ONNX = multi-GB package
- Native dependencies are platform-specific
- Server is independently upgradeable

Options:
1. **Docker**: `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest`
2. **User-managed**: User installs `kokoro-fastapi` themselves
3. **Extension-managed subprocess**: Extension spawns `uvicorn kokoro_fastapi:app --port 8880` and kills on deactivation

## Key References

- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code Decorator Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/decorator-sample)
- [azu/vscode-read-aloud-text](https://github.com/azu/vscode-read-aloud-text) — closest existing impl
- [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)
- [sukumo28/vscode-audio-preview](https://github.com/sukumo28/vscode-audio-preview) — webview audio pattern
