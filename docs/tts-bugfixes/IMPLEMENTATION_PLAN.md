# Implementation Plan: TTS Extension Bugfixes

## Context

After building the Kokoro TTS VS Code extension (phases 1-5 in `docs/tts-research/IMPLEMENTATION_PLAN.md`), end-to-end testing revealed the extension opens the TTS Player panel but shows **"Chunk 0 / 0"** with no audio — the synthesis pipeline silently fails. Two bugs were identified through investigation.

---

## Bug 1: Kokoro returns NDJSON, extension expects single JSON

### Problem

The extension calls `POST /dev/captioned_speech` without a `stream` parameter. Kokoro-FastAPI **defaults to streaming mode**, returning NDJSON (newline-delimited JSON) — two separate JSON objects on two lines:

- **Line 0**: Real audio (base64 MP3) + word-level timestamps (e.g. `{"word":"Hello","start_time":0.0,"end_time":0.3}`)
- **Line 1**: Silent padding audio + `"timestamps":[]`

The extension calls `response.json()` which fails on NDJSON (two JSON objects aren't valid JSON). This throws a `SyntaxError`, caught as: `"Failed to parse JSON response from Kokoro TTS server."` — the error is shown via `vscode.window.showErrorMessage` but easily missed.

### Evidence

```bash
# Two-line response confirmed:
curl -s -X POST http://localhost:8880/dev/captioned_speech \
  -H "Content-Type: application/json" \
  -d '{"model":"kokoro","input":"Hello world.","voice":"af_heart","speed":1.0,"response_format":"mp3"}' \
  | wc -l
# Output: 2

# Line 0 has timestamps, line 1 has empty timestamps:
# Line 0 ends: ...,"end_time":2.197875}]}
# Line 1 ends: ...,"timestamps":[]}
```

### Fix

Add `stream: false` to the request body in `kokoroClient.ts`:

**File**: `packages/vscode-extension/src/tts/kokoroClient.ts` (line ~65-71)

```typescript
// Before:
const body = {
  model: DEFAULT_MODEL,
  input: text,
  voice: this.voice,
  speed: this.speed,
  response_format: "mp3",
};

// After:
const body = {
  model: DEFAULT_MODEL,
  input: text,
  voice: this.voice,
  speed: this.speed,
  response_format: "mp3",
  stream: false,
};
```

**Test update**: `packages/vscode-extension/test/kokoroClient.test.ts` — update the "sends correct request body" test (line ~195) to expect `stream: false` in the body.

---

## Bug 2: Singleton panel "ready" message never re-sent on re-invocation

### Problem

The webview sends a `"ready"` message once when it first loads (`player.js` line 390). The extension listens for this to trigger `synthesizeAndPlay()` (`extension.ts` line 204-207).

The panel uses `retainContextWhenHidden: true` and a singleton pattern. On re-invocation:

1. `PlayerPanel.createOrShow()` reveals the existing panel (doesn't recreate it)
2. The webview JS doesn't re-execute — it was retained
3. `"ready"` is never sent again
4. `synthesizeAndPlay()` is never called
5. Panel stays at "Chunk 0 / 0" forever

This is the reason the user sees no error on subsequent attempts — synthesis isn't even attempted.

### Timeline of what the user experienced

1. **First invocation**: Panel created → webview sends "ready" → synthesis attempted → `response.json()` fails on NDJSON → error toast shown (easily missed) → `stopReading()` called (but panel stays open)
2. **Second+ invocation**: Panel revealed (not recreated) → handlers re-registered → webview never sends "ready" → nothing happens → "Chunk 0 / 0" shown indefinitely

### Fix

After registering message handlers, check whether the panel already existed. If so, call `synthesizeAndPlay` directly instead of waiting for `"ready"`.

**File**: `packages/vscode-extension/src/player/playerPanel.ts`

Make `createOrShow` return whether the panel was newly created:

```typescript
static createOrShow(extensionUri: vscode.Uri): { panel: PlayerPanel; isNew: boolean } {
  if (PlayerPanel.instance) {
    PlayerPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
    return { panel: PlayerPanel.instance, isNew: false };
  }
  // ... create new panel ...
  return { panel: PlayerPanel.instance, isNew: true };
}
```

**File**: `packages/vscode-extension/src/extension.ts`

Use the `isNew` flag to decide whether to wait for "ready" or start immediately:

```typescript
const { panel, isNew } = PlayerPanel.createOrShow(context.extensionUri);

// ... register all handlers ...

panel.onMessage("ready", () => {
  void synthesizeAndPlay(client, panel, 0);
});

// If panel already existed, webview won't re-send "ready" — start directly
if (!isNew) {
  void synthesizeAndPlay(client, panel, 0);
}
```

---

## Files to modify

| File | Change |
|------|--------|
| `packages/vscode-extension/src/tts/kokoroClient.ts` | Add `stream: false` to request body |
| `packages/vscode-extension/src/player/playerPanel.ts` | Return `isNew` flag from `createOrShow` |
| `packages/vscode-extension/src/extension.ts` | Use `isNew` to bypass "ready" wait on re-invocation |
| `packages/vscode-extension/test/kokoroClient.test.ts` | Update request body assertion to include `stream: false` |

---

## Verification

1. **Rebuild & reinstall**:
   ```bash
   pnpm --filter markservant-tts build
   cd packages/vscode-extension && npx @vscode/vsce package --no-dependencies
   code --install-extension "$(pwd)/markservant-tts-0.1.0.vsix"
   ```

2. **Test NDJSON fix**: Start server, open a markdown file, press `Cmd+Shift+R` — audio should play with word highlighting.

3. **Test singleton fix**: Stop playback, press `Cmd+Shift+R` again without closing the panel — should start fresh playback, not stay at "Chunk 0 / 0".

4. **Test closing panel**: Close the TTS Player panel, press `Cmd+Shift+R` — panel should reopen and play.

5. **Run unit tests**:
   ```bash
   pnpm --filter markservant-tts test
   ```
