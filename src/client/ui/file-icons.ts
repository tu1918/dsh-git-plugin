/**
 * The deployment's own icons, as the rows want them: extension to drawable URL.
 *
 * `/git-panel/fileIcons` hands over SVG DOCUMENTS, and a row needs something an
 * `<img>` can draw. A `data:` URL is the whole conversion, and it is deliberate
 * that nothing else happens here: the document is rendered as an IMAGE, a static
 * context where scripts and external references do not run, so a configured file
 * never reaches the panel's own DOM. (Inlining it with `dangerouslySetInnerHTML`
 * would have needed a sanitiser to be safe, and would have made a config file — the
 * user's own, but also one that may come from a shared repository — able to inject
 * markup into the GUI.)
 *
 * One request per panel mount carries every configured icon at once, which is why
 * the host inlines them in its answer: the alternative, one HTTP request per row,
 * is a request per file in a list that can be thousands of rows long.
 *
 * @module dsh-git-panel/client/ui/file-icons
 */

/**
 * Make one SVG document drawable by an `<img>`.
 * @param svg - The document's text, as the host read it.
 * @returns A `data:` URL.
 */
export function iconUrlOf(svg: string): string {
  // `charset=utf-8` because the escape below is UTF-8 percent-encoding: an icon
  // with a non-ASCII path or comment must not be read as the document's default.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Convert a whole map, once (a `data:` URL per row would otherwise be rebuilt on
 * every render).
 * @param icons - Extension to SVG document.
 * @returns Extension to URL.
 */
export function iconUrlsOf(
  icons: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const urls: Record<string, string> = {}
  for (const [ext, svg] of Object.entries(icons)) urls[ext] = iconUrlOf(svg)
  return urls
}
