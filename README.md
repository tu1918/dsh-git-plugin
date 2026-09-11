# dsh-git-panel

A resident git panel for the DSH Web GUI's right sidebar: see the session
workspace's changes, grouped the way git groups them, with the branch's state
against its upstream — without leaving DSH and without a modal overlay covering
the conversation.

Built to the requirements document, and currently at **M0 + M1 + M2**: the
foundation, a read-only panel, and the commit loop (stage → commit → push).

## Docs

| File | What it is |
|---|---|
| `docs/requirements.md` | The requirements document, v0.2. A **byte-exact copy** (20 778 bytes, sha256 `f42d4277…`) kept as the single source of truth — read-only; a change means a new version replacing it wholesale. |
| `docs/plan.md` | The execution plan: milestone status against the doc's own acceptance criteria, what each completed milestone delivered and where, every deliberate deviation from the doc with its reason, and the M2 task list. |

## What works today

| Area | State |
|---|---|
| Change list: staged / changes / untracked / conflicts, git's own status letters | ✅ |
| Branch rail: name, detached / unborn / upstream-gone, ↑ahead ↓behind | ✅ |
| Recent commits: lazy-loaded, paged by look-ahead, pushed/unpushed marker | ✅ |
| Auto-refresh from `.git/index` + `.git/HEAD` change, pushed over SSE | ✅ |
| Live git status/branches/log over `/git-panel/*` | ✅ |
| Stage / unstage, one file or a whole group | ✅ |
| Commit box with an explicit scope: index only, or the announced `add -u` | ✅ |
| Pull ↓ / push ↑n / sync ⇅, with the upstream set on the first push | ✅ |
| Push refused as non-fast-forward → points at Sync instead of git's hint text | ✅ |
| UI in zh + en | ✅ |
| Diff view, branching, discard/stash, AI commit message, undo | ⏳ M3–M5 |

The whole M2 loop runs without a terminal: change → stage → commit → push, with
the panel's own end-to-end test driving it against a real repository and a real
bare remote (`test/host-mutations.test.ts`).

`/git-panel/*` accepts **loopback clients only**. DSH's own frontend
authentication does not cover routes a third-party plugin registers on
`ctx.webServer` — verified against a running server, where `/` answers 401 while a
plugin route answers normally — so the plugin carries its own gate. A deployment
that binds wider than loopback is refused rather than silently exposing every
session's repository state; a trusted-authority or paired-device escape hatch
belongs with the mutations in a later milestone.

Mutations add two more rules on top of that gate: they require `POST`, they must
come from this origin (`Origin` ↔ `Host`), and their body is capped at 1 MiB. A
loopback fence alone would not stop another page on this machine from posting to
them.

## Layout

```
src/core/      pure TypeScript: types, ports, git parsers, argument validation,
               the commit-scope decision. Zero imports.
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
npm run check      # tsc --noEmit && 153 tests && build
```

## Install

Requires DSH >= 0.1.5-rc.1 (the right-sidebar tab-type registry this builds on)
and git >= 2.20.

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
- `test/validate.test.ts` — every argument shape §5.5 forbids, refused before git runs
- `test/commit-scope.test.ts` — FR-3.4's decision table, including the conflict case
- `test/git-integration.test.ts` — parsers against repositories git just wrote:
  unborn, detached, divergent upstream, conflicted merge, renames, unicode paths
- `test/host-mutations.test.ts` — the M2 loop against real repositories: staging,
  the unborn unstage, committing, `commitAll`'s tracked-only promise, first push
  setting the upstream, a refused push, a conflicting pull, sync, and the full
  改→暂存→提交→推送 flow verified against a bare remote's refs
- `test/host-service.test.ts` — the git service and the `/git-panel` routes over a
  real socket: envelopes, 400/404/405/413, the same-origin refusal, and the SSE
  `ready` / `changed` / `unavailable` frames
- `test/host-mount.test.ts` — `apply()` from the plugin entry to the wire
- `test/client-panel.test.ts` — the panel rendered in jsdom: groups, badges, path
  splitting, clean and failure states, lazy history, the commit box's four scopes
  and its `Ctrl+Enter`, per-row and per-group staging, the sync buttons' enabled
  states, in-place operation errors, and the two-stage registration

## Notes for the next milestone

- `GitRunner.run` takes `optionalLocks` as a third argument, defaulting to
  **false**, which stops `git status` from rewriting `.git/index`. That is
  load-bearing: the change watcher polls that file, so a read that wrote it would
  refresh the panel forever. Every mutation passes `true` explicitly.
- Unstaging on an **unborn** branch is a different command: `git restore --staged`
  restores from HEAD, and an unborn repository has none. `unstage` probes with
  `rev-parse --verify --quiet HEAD` and falls back to `git rm --cached`.
- `git pull` is invoked as `pull --no-rebase --no-edit`. Both flags are about not
  waiting for a terminal that is not there: a divergent pull creates a merge
  commit, and without `--no-edit` git waits for an editor until the deadline kills
  it.
- The host↔client channel is HTTP routes + SSE (doc §5.3's fallback), chosen
  because a Typert Remote needs a wire schema from an unpublished generator. The
  choice is confined to `src/client/adapter/git-client.ts` and
  `src/host/adapter/routes.ts`; the ports do not change if it moves.
