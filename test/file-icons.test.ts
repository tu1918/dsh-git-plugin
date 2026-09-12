/**
 * The icon registry's own rules: where the map lives, and when it is re-read.
 *
 * The route test (`host-service.test.ts`) already drives the whole path over a real
 * socket; what is here is the two things that are not about HTTP — the default
 * location, which is what makes the feature work with no configuration at all, and
 * the "edit the file, reload the panel" promise.
 *
 * @module dsh-git-panel/test/file-icons
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createFileIconRegistry, resolveIconConfigPath } from '../src/host/file-icons.ts'
import type { HostPorts } from '../src/core/ports.ts'
import { cleanupRepos, makePlainDir, write } from './helpers/repo.ts'

after(cleanupRepos)

/** A silent host port: these tests assert on the icons, not on the log. */
const SILENT: HostPorts = {
  log: () => undefined,
  generateText: () => Promise.reject(new Error('no model in this test')),
}

describe('where the icon map lives', () => {
  it('defaults to $DSH_HOME/git-panel-icons.yml', () => {
    const previous = process.env['DSH_HOME']
    try {
      process.env['DSH_HOME'] = '/tmp/a-dsh-home'
      assert.equal(resolveIconConfigPath(undefined), '/tmp/a-dsh-home/git-panel-icons.yml')
      // The configured path wins, and is trimmed like any config value.
      assert.equal(resolveIconConfigPath('  /elsewhere/icons.yml '), '/elsewhere/icons.yml')
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('falls back to ~/.dsh when the deployment sets no home', () => {
    const previous = process.env['DSH_HOME']
    try {
      delete process.env['DSH_HOME']
      assert.equal(resolveIconConfigPath(undefined), join(homedir(), '.dsh', 'git-panel-icons.yml'))
      // A `~` in the configured value is expanded: a config file is written by a
      // person, and that is how a person writes a home path.
      assert.equal(resolveIconConfigPath('~/icons.yml'), join(homedir(), 'icons.yml'))
    } finally {
      if (previous !== undefined) process.env['DSH_HOME'] = previous
    }
  })
})

describe('reading the icon map', () => {
  it('re-reads an icon whose file changed, because nothing should need a restart', async () => {
    const dir = makePlainDir('icon-edit')
    write(dir, 'ts.svg', '<svg><path d="M1 1"/></svg>')
    const configPath = join(dir, 'icons.yml')
    write(dir, 'icons.yml', `.ts: ${join(dir, 'ts.svg')}\n`)
    const icons = createFileIconRegistry(SILENT, configPath)

    const first = await icons.list()
    assert.equal(first.length, 1)
    assert.match(first[0]?.svg ?? '', /M1 1/u)

    // A longer document, so the size changes even if the mtime's millisecond does
    // not: that pair is exactly what the cache compares.
    write(dir, 'ts.svg', '<svg><path d="M1 1"/><path d="M2 2"/></svg>')
    const second = await icons.list()
    assert.match(second[0]?.svg ?? '', /M2 2/u, 'the edited file is what the panel gets')
  })
})
