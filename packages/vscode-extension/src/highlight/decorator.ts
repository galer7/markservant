import * as vscode from "vscode";

/**
 * Manages VS Code text editor decorations for word-by-word highlighting
 * during TTS playback. Uses a single decoration type that adapts to the
 * active color theme (light/dark).
 */
export class WordHighlighter {
  private decorationType: vscode.TextEditorDecorationType;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      light: {
        backgroundColor: "#FFFF0066",
      },
      dark: {
        backgroundColor: "#264F78",
      },
      borderRadius: "3px",
    });
  }

  /**
   * Highlight a word in the editor by its source document offsets.
   * Replaces any previous highlight (setDecorations with a single-element
   * array clears the old decoration and applies the new one).
   *
   * @param editor - The text editor containing the document
   * @param sourceStart - Start offset in the original source document
   * @param sourceEnd - End offset in the original source document
   */
  highlightWord(editor: vscode.TextEditor, sourceStart: number, sourceEnd: number): void {
    const startPos = editor.document.positionAt(sourceStart);
    const endPos = editor.document.positionAt(sourceEnd);
    const range = new vscode.Range(startPos, endPos);

    editor.setDecorations(this.decorationType, [range]);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /**
   * Remove all highlights from the editor.
   *
   * @param editor - The text editor to clear highlights from
   */
  clearHighlight(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
  }

  /**
   * Dispose the underlying decoration type. Call this when the extension
   * deactivates or the highlighter is no longer needed.
   */
  dispose(): void {
    this.decorationType.dispose();
  }
}
