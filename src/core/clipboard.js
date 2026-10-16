/**
 * `copyTextToClipboard(text)` copies text through a temporary off-screen read-only <textarea>
 * and `document.execCommand('copy')`; used by the copy-player-id and copy-player-name player
 * actions.
 *
 * Invariants:
 * - Synchronous; the textarea is added to and removed from `document.body` within the call.
 * - The `execCommand` result is not checked, so a failed copy is silent.
 */
export function copyTextToClipboard(textToCopy) {
  const textarea = document.createElement("textarea");
  textarea.value = textToCopy;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
