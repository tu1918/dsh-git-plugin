/**
 * Writing text to the system clipboard, for the copying menu entries.
 *
 * Hand-rolled rather than taken from primitives' `writeClipboard`, for the rule
 * this whole directory follows: `src/client/ui/**` never names a DSH package
 * (§5.2, third arrow), and wrapping that one function in `client/adapter/` would
 * put a browser capability behind an adapter while every other browser API this
 * panel uses — `document`, `navigator`, `Intl` — is named where it is needed.
 *
 * Two paths, and the second is not optional: the async Clipboard API exists only
 * in a secure context and only with the document focused, so a deployment served
 * over plain HTTP (or a test in jsdom) has no `navigator.clipboard` at all. The
 * legacy path is a hidden textarea, a selection, and `execCommand('copy')` —
 * deprecated, but still the only thing that works where the modern one does not.
 * A host that offers neither gets `false`, and the panel says so rather than
 * pretending the copy happened.
 *
 * @module dsh-git-panel/client/ui/clipboard
 */

/**
 * Copy one line of text, reporting whether the host accepted it.
 *
 * Never throws: a refused or rejected write is a normal answer here, which is
 * what lets the caller put a sentence beside the list instead of handling an
 * exception (§4.3's one error path).
 * @param text - The exact text to place on the clipboard.
 * @returns True only when the host accepted the write.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  // Typed as optional locally: the DOM lib promises `navigator.clipboard`, while
  // an insecure context or jsdom is exactly the case where it is missing.
  const clipboard: Clipboard | undefined = navigator.clipboard
  if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or the document lost focus: try the legacy path rather
      // than giving up, because one of the two usually still works.
    }
  }
  return legacyCopy(text)
}

/**
 * The pre-Clipboard-API path: a selected, off-screen textarea.
 * @param text - The text to copy.
 * @returns What `execCommand('copy')` answered; `false` where it does not exist.
 */
function legacyCopy(text: string): boolean {
  const exec = document.execCommand
  // jsdom and non-browser hosts have no `execCommand` at all.
  if (typeof exec !== 'function') return false
  const area = document.createElement('textarea')
  area.value = text
  // Read-only so a mobile keyboard never opens over the selection; off-screen so
  // the append-then-remove is invisible.
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
