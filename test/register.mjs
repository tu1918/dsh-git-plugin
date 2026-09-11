/**
 * Test-process preload: install the `.tsx` transform hook.
 *
 * Referenced from the `test` script as `node --import ./test/register.mjs`, which
 * keeps the flag out of the way of anyone reading the tests.
 *
 * @module dsh-git-panel/test/register
 */

import { register } from 'node:module'

register('./tsx-hooks.mjs', import.meta.url)
