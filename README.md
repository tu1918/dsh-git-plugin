# dsh-git-panel

A resident git panel for the DSH Web GUI's right sidebar: see the session
workspace's changes, grouped the way git groups them, with the branch's state
against its upstream — without leaving DSH and without a modal overlay covering
the conversation.

Built to the requirements document (`dsh-git-plugin-需求文档.md`, v0.2), and
currently at **M0 + M1**: the foundation and a read-only panel.

## What works today

| Area | State |
|---|---|
| Change list: staged / changes / untracked / conflicts, git's own status letters | ✅ |
| Branch rail: name, detached / unborn / upstream-gone, ↑ahead ↓behind | ✅ |
| Recent commits: lazy-loaded, paged by look-ahead, pushed/unpushed marker | ✅ |
| Auto-refresh from `.git/index` + `.git/HEAD` change, pushed over SSE | ✅ |
| Live git status/branches/log over `/git-panel/*` | ✅ |
| UI in zh + en | ✅ |
| Staging, committing, pushing, branching, diff view | ⏳ M2–M4 |

Browser→host paths are never accepted: the client sends an opaque session id and
the host resolves the directory from its own session store (see
`src/host/adapter/workspace.ts`).

## Layout

```
src/core/      pure TypeScript: types, ports, git parsers. Zero imports.
src/host/      git runner, git service, change watcher
  adapter/     the only place the host names DSH (webServer, sessions, logger)
src/client/    browser half
  adapter/     the only place the browser names DSH (slots, tabs, locale) or a URL
  ui/          pure React over ports; no DSH import at all
test/          node --test; real git repositories, real sockets, real jsdom
```

The dependency direction is not a convention here — `test/dependency-direction.test.ts`
fails the suite if `src/core` gains an import, or if a DSH package is imported
outside an `adapter/` directory.

## Check

```sh
npm install
npm run check      # tsc --noEmit && node --test && build
```

## Install

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-git-plugin
# then restart `dsh web` — a NEW bundle is composed at startup
```

The panel appears through the right sidebar's **＋** control as "Git changes".

## See it working

None of the following needs a DSH process:

```sh
npm test
```

- `test/git-parse.test.ts` — parsers against byte-level fixtures taken from real git
- `test/git-integration.test.ts` — parsers against repositories git just wrote:
  unborn, detached, divergent upstream, conflicted merge, renames, unicode paths
- `test/host-service.test.ts` — the git service and the `/git-panel` routes over a
  real socket: envelopes, 400/404/405, and the SSE `ready` / `changed` /
  `unavailable` frames
- `test/host-mount.test.ts` — `apply()` from the plugin entry to the wire
- `test/client-panel.test.ts` — the panel rendered in jsdom: groups, badges, path
  splitting, clean and failure states, lazy history, and the two-stage
  registration

## Notes for the next milestone

- `GitRunner.run` takes `optionalLocks`. It defaults to **false**, which stops
  `git status` from rewriting `.git/index`. That is load-bearing: the change
  watcher polls that file, so a read that wrote it would refresh the panel
  forever. Mutating commands must pass `true`.
- The host↔client channel is HTTP routes + SSE (doc §5.3's fallback), chosen
  because a Typert Remote needs a wire schema from an unpublished generator. The
  choice is confined to `src/client/adapter/git-client.ts` and
  `src/host/adapter/routes.ts`; the ports do not change if it moves.
