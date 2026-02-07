import * as vscode from 'vscode';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from '../tts/types.js';
import { getPlayerHtml, getNonce } from './playerHtml.js';

/**
 * Manages the VS Code webview panel lifecycle for TTS audio playback.
 *
 * Uses a singleton pattern so only one player panel exists at a time.
 * The webview runs with `retainContextWhenHidden` so audio continues
 * playing even when the tab is not visible.
 */
export class PlayerPanel {
  private static instance: PlayerPanel | undefined;

  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private messageHandlers: Map<string, (msg: any) => void> = new Map();
  private disposeCallbacks: (() => void)[] = [];

  /**
   * Create or reveal the singleton player panel.
   *
   * If an existing panel is already open it will be revealed instead of
   * creating a second one. Returns the singleton instance.
   *
   * @param extensionUri - The URI of the extension's root directory,
   *   used to derive local resource roots for the webview.
   */
  static createOrShow(extensionUri: vscode.Uri): PlayerPanel {
    // If we already have a panel, reveal it and return the existing instance
    if (PlayerPanel.instance) {
      PlayerPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return PlayerPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'markservant-tts-player',
      'TTS Player',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'media'),
        ],
      },
    );

    PlayerPanel.instance = new PlayerPanel(panel, extensionUri);
    return PlayerPanel.instance;
  }

  /**
   * Access the current singleton instance, or `undefined` if the panel
   * has been closed / never opened.
   */
  static get current(): PlayerPanel | undefined {
    return PlayerPanel.instance;
  }

  // ---------------------------------------------------------------
  // Private constructor -- callers must use createOrShow()
  // ---------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    this.panel = panel;

    // Set the HTML content for the webview
    const nonce = getNonce();
    this.panel.webview.html = getPlayerHtml(this.panel.webview, extensionUri, nonce);

    // Listen for messages coming from the webview and dispatch to
    // registered handlers by message type.
    const messageSubscription = this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message);
        }
      },
    );
    this.disposables.push(messageSubscription);

    // When the panel is closed by the user (or programmatically), clean
    // up all resources and reset the singleton reference.
    this.panel.onDidDispose(
      () => {
        this.cleanUp();
      },
      null,
      this.disposables,
    );
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Send a message to the webview.
   *
   * @param message - A typed message from the extension host to the webview.
   */
  postMessage(message: ExtensionToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Register a handler for a specific message type coming from the webview.
   * Only one handler per type is allowed; registering a second handler for
   * the same type replaces the previous one.
   *
   * @param type  - The `type` field of the WebviewToExtensionMessage to handle.
   * @param handler - Callback invoked with the full message object.
   */
  onMessage(type: string, handler: (msg: any) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Register a callback that fires when the panel is disposed (closed by the
   * user or via `dispose()`). Multiple callbacks can be registered.
   *
   * @param callback - Function to invoke on disposal.
   */
  onDidDispose(callback: () => void): void {
    this.disposeCallbacks.push(callback);
  }

  /**
   * Programmatically dispose the panel and all associated resources.
   * After this call, `PlayerPanel.current` will return `undefined`.
   */
  dispose(): void {
    this.panel.dispose();
    // panel.onDidDispose fires synchronously from panel.dispose(),
    // so cleanUp() has already run at this point.
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  /**
   * Release all resources: dispose subscriptions, notify dispose callbacks,
   * clear handlers, and reset the singleton.
   */
  private cleanUp(): void {
    // Reset the singleton reference first so that callbacks see
    // PlayerPanel.current as undefined.
    PlayerPanel.instance = undefined;

    // Dispose all VS Code disposables (message listener, etc.)
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    // Notify external dispose listeners
    for (const cb of this.disposeCallbacks) {
      cb();
    }
    this.disposeCallbacks = [];

    // Clear message handlers to avoid stale references
    this.messageHandlers.clear();
  }
}
