import * as vscode from "vscode";

/**
 * Generate a cryptographically random nonce string for use in Content Security
 * Policy script-src directives. The nonce ensures that only our own inline
 * scripts and explicitly referenced script files are allowed to execute.
 *
 * @returns A 32-character hexadecimal nonce string
 */
export function getNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate the full HTML content for the TTS player webview panel.
 *
 * The player UI provides:
 * - Play/Pause toggle button (large, centered)
 * - Stop button
 * - Progress indicator showing current chunk / total chunks
 * - Status text reflecting the current playback state
 * - A hidden <audio> element for actual audio playback (controlled by player.js)
 *
 * All styling uses VS Code CSS custom properties so the panel integrates
 * seamlessly with the user's active color theme.
 *
 * @param webview - The webview instance to generate content for
 * @param extensionUri - The root URI of the extension, used to resolve media assets
 * @param nonce - A unique nonce for the Content Security Policy
 * @returns The complete HTML string for the webview
 */
export function getPlayerHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "media", "player.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "media", "player.css"),
  );

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      media-src data: blob:;
      script-src 'nonce-${nonce}';
      style-src ${webview.cspSource} 'nonce-${nonce}';
      font-src ${webview.cspSource};
    "
  >
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>MarkServant TTS Player</title>
  <style nonce="${nonce}">
    /* --------------------------------------------------------
     * Inline fallback styles that use VS Code theme variables.
     * These ensure the player looks correct even if player.css
     * fails to load or is incomplete.
     * -------------------------------------------------------- */
    :root {
      --player-bg: var(--vscode-editor-background);
      --player-fg: var(--vscode-editor-foreground);
      --player-button-bg: var(--vscode-button-background);
      --player-button-fg: var(--vscode-button-foreground);
      --player-button-hover-bg: var(--vscode-button-hoverBackground);
      --player-button-secondary-bg: var(--vscode-button-secondaryBackground);
      --player-button-secondary-fg: var(--vscode-button-secondaryForeground);
      --player-button-secondary-hover-bg: var(--vscode-button-secondaryHoverBackground);
      --player-border: var(--vscode-panel-border, var(--vscode-widget-border, transparent));
      --player-muted-fg: var(--vscode-descriptionForeground, var(--vscode-editorWidget-foreground));
      --player-badge-bg: var(--vscode-badge-background);
      --player-badge-fg: var(--vscode-badge-foreground);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: var(--player-bg);
      color: var(--player-fg);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 16px;
    }

    .player-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      width: 100%;
      max-width: 320px;
    }

    /* Status text */
    #status {
      font-size: 1.1em;
      font-weight: 600;
      color: var(--player-fg);
      text-align: center;
      min-height: 1.4em;
      user-select: none;
    }

    /* Progress indicator */
    .progress {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--player-muted-fg);
      font-size: 0.9em;
      user-select: none;
    }

    .progress-badge {
      background: var(--player-badge-bg);
      color: var(--player-badge-fg);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.85em;
      font-weight: 600;
      white-space: nowrap;
    }

    /* Button row */
    .controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Base button styles */
    .player-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--player-border);
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      transition: background-color 0.15s ease, opacity 0.15s ease;
    }

    .player-btn:focus-visible {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .player-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Primary action: Play/Pause */
    #play-pause-btn {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--player-button-bg);
      color: var(--player-button-fg);
      font-size: 24px;
      border: none;
    }

    #play-pause-btn:hover:not(:disabled) {
      background: var(--player-button-hover-bg);
    }

    /* Secondary action: Stop */
    #stop-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--player-button-secondary-bg);
      color: var(--player-button-secondary-fg);
      font-size: 16px;
      border: none;
    }

    #stop-btn:hover:not(:disabled) {
      background: var(--player-button-secondary-hover-bg);
    }

    /* SVG icons within buttons */
    .player-btn svg {
      width: 1em;
      height: 1em;
      fill: currentColor;
    }

    /* Hidden audio element */
    #audio-player {
      display: none;
    }
  </style>
</head>
<body>
  <div class="player-container" role="region" aria-label="TTS Audio Player">

    <audio id="audio-player" preload="auto"></audio>

    <div id="status" role="status" aria-live="polite">Loading...</div>

    <div class="progress" aria-label="Playback progress">
      <span>Chunk</span>
      <span class="progress-badge">
        <span id="current-chunk">0</span> / <span id="total-chunks">0</span>
      </span>
    </div>

    <div class="controls">
      <button
        id="stop-btn"
        class="player-btn"
        aria-label="Stop"
        title="Stop playback"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      </button>

      <button
        id="play-pause-btn"
        class="player-btn"
        aria-label="Play"
        title="Play"
        disabled
      >
        <svg id="icon-play" viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="8,5 20,12 8,19" />
        </svg>
        <svg id="icon-pause" viewBox="0 0 24 24" aria-hidden="true" style="display:none;">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      </button>
    </div>

  </div>

  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
