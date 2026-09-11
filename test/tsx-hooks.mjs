/**
 * Node loader hooks: transform `.tsx` with esbuild for the test process.
 *
 * Node 24 strips TYPES natively, which is enough for every `.ts` module in this
 * repository and is why the core tests need no build step at all. It cannot help
 * with `.tsx`: JSX is not TypeScript syntax, so there is nothing to strip — the
 * syntax has to be transformed. Rather than push the component tests through the
 * browser bundle (where the component is no longer addressable), this hook
 * compiles `.tsx` on the way in, using the same esbuild already in the build.
 *
 * Only `.tsx` is intercepted. `.ts` keeps Node's own stripping, so the pure core
 * tests exercise exactly the code the host will run, with no transform in the
 * way.
 *
 * @module dsh-git-panel/test/tsx-hooks
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

/**
 * Load a module, compiling `.tsx` sources to ESM.
 * @param url - Module URL being loaded.
 * @param context - Node's load context.
 * @param nextLoad - The default loader, used for every other extension.
 * @returns The loaded source.
 */
export async function load(url, context, nextLoad) {
  if (!url.endsWith('.tsx')) return nextLoad(url, context)

  const source = await readFile(fileURLToPath(url), 'utf8')
  const result = await transform(source, {
    loader: 'tsx',
    format: 'esm',
    target: 'es2022',
    // The same JSX mode the client bundle uses, so a component behaves here as
    // it does in the browser.
    jsx: 'automatic',
    sourcefile: url,
    // Keep the transform local: no bundling, so imports still resolve through
    // Node exactly as they would without this hook.
    sourcemap: 'inline',
  })
  return { format: 'module', source: result.code, shortCircuit: true }
}
