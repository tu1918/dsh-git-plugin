/**
 * The plugin's two build products.
 *
 * HOST (`lib/index.js`): an ESM bundle for the DSH process. Every bare import
 * stays external — the host already owns `@deepseek-ai/*` and the Node builtins,
 * and bundling a second copy of a cordis service would break service identity.
 *
 * CLIENT (`lib/client.js`): the browser half, which DSH loads as a lazy CJS
 * bundle. `dsh-client-modules` materializes a plugin bundle by calling
 * `window.__ModuleLoader__.load({ id, factory })` and then `factory(require)`,
 * where `require` resolves ONLY against the browser's frozen module table. Two
 * consequences shape this script:
 *
 *   1. The bundle must be wrapped in exactly that closure-factory form, because
 *      the loader memoizes the factory's return value as the module's exports.
 *   2. Any bare import becomes a `require(...)` at runtime, so a specifier the
 *      browser table does not seed fails at materialization — in the user's
 *      browser, not here. {@link BASELINE_CLIENT_MODULES} is therefore checked
 *      against the emitted bundle at build time, turning that class of mistake
 *      into a build failure (the same intent as upstream's bundle-purity gate).
 *
 * @module dsh-git-panel/build
 */

import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, derived from this file's location. */
const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** The package name: the module id the browser registers this bundle under. */
const CLIENT_ID = 'dsh-git-panel'

/**
 * Specifiers the browser's platform module table seeds statically.
 *
 * Read off the shutdown set every shipped client bundle resolves against:
 * React, its JSX runtime, and the static UI libraries. This plugin is written to
 * need only React, so a hit here is a bug in the source, not a manifest to
 * extend — extending it would mean declaring `dsh.client.external` and depending
 * on another bundle loading first.
 */
const BASELINE_CLIENT_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** Host bundle settings: ESM for the DSH process, no bundling of packages. */
const HOST_OPTIONS = {
  entryPoints: [join(root, 'src/host/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning',
}

/** Client bundle settings: CJS, because the factory contract is `factory(require)`. */
const CLIENT_OPTIONS = {
  entryPoints: [join(root, 'src/client/index.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning',
}

/**
 * Wrap a CJS bundle body in the loader's closure-factory envelope.
 *
 * The final `for...in` copy is deliberate. esbuild's CJS output replaces
 * `module.exports` with an `__esModule` namespace whose members are GETTERS,
 * whereas every client bundle DSH ships hands over plain own properties. Reading
 * the members once into a plain object makes this bundle's shape identical to the
 * built-ins', so nothing downstream has to be right about interop for the plugin
 * to load.
 * @param body - One CJS bundle's text.
 * @returns The script text to serve as `lib/client.js`.
 */
function wrapClientBundle(body) {
  return `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(CLIENT_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body
  .split('\n')
  .map((line) => (line === '' ? line : `\t\t${line}`))
  .join('\n')}
\t\tvar loaded = module.exports;
\t\tvar plain = {};
\t\tfor (var key in loaded) plain[key] = loaded[key];
\t\treturn plain;
\t}
});
`
}

/**
 * Collect every bare specifier the bundle will `require` at runtime.
 * @param code - The wrapped bundle text.
 * @returns The distinct specifiers.
 */
function requiredSpecifiers(code) {
  const found = new Set()
  for (const match of code.matchAll(/require\(\s*"([^"]+)"\s*\)/g)) found.add(match[1])
  return found
}

/** Build `lib/index.js`. */
async function buildHost() {
  await build(HOST_OPTIONS)
  console.log('built lib/index.js')
}

/** Build `lib/client.js`, refusing any specifier the browser table cannot answer. */
async function buildClient() {
  const result = await build(CLIENT_OPTIONS)
  const output = result.outputFiles?.[0]
  if (output === undefined) throw new Error('client build produced no output')
  const code = wrapClientBundle(output.text)

  const unknown = [...requiredSpecifiers(code)].filter(
    (specifier) => !BASELINE_CLIENT_MODULES.has(specifier),
  )
  if (unknown.length > 0) {
    throw new Error(
      `client bundle requires specifiers the browser module table does not seed: ${unknown.join(', ')}\n` +
        'Either drop the import, or declare it in package.json "dsh.client.external" and ' +
        'add its supplying package to "dsh.client.inject".',
    )
  }

  const target = join(root, 'lib/client.js')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, code, 'utf8')
  console.log(`built lib/client.js (requires: ${[...requiredSpecifiers(code)].join(', ') || 'none'})`)
}

mkdirSync(join(root, 'lib'), { recursive: true })
await buildHost()
await buildClient()
