# dsh-git-panel

A resident git panel for the DSH Web GUI's right sidebar: see the session
workspace's changes, grouped the way git groups them, with the branch's state
against its upstream — without leaving DSH and without a modal overlay covering
the conversation.

Built to the requirements document, and currently at **M0 + M1 + M2 + M3 + M4**:
the foundation, a read-only panel, the commit loop (stage → commit → push), the
diff view, and branch management with the merge state, an AI-written commit
message, and a commit detail.

## Docs

| File | What it is |
|---|---|
| `docs/requirements.md` | The requirements document, v0.2. A **byte-exact copy** (20 778 bytes, sha256 `f42d4277…`) kept as the single source of truth — read-only; a change means a new version replacing it wholesale. |
| `docs/plan.md` | The execution plan: milestone status against the doc's own acceptance criteria, what each completed milestone delivered and where, every deliberate deviation from the doc with its reason, and the next milestone's task list. |

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
| Change groups fold away individually, and stay folded (the count stays visible) | ✅ |
| A resident staged drawer directly above the commit box: it is what that box commits, and its empty state says so | ✅ |
| Changes and Untracked are drawers of the same shape — own grip, own cap, own scroller — so each partition's height is its own, and a long group cannot push the others off screen | ✅ |
| A group with no rows keeps its bulk action on screen but disabled, and says why — an empty group has nothing to stage, so it never becomes a refused request | ✅ |
| One bottom pane, two tabs — recent commits and the selected file's diff — folding to its tab strip, sized by a drag handle, keeping both tabs' content loaded | ✅ |
| Diff view: click a change row → the diff opens as the bottom pane's second tab (beside the commit history, never a modal), half the screen tall and drag-resizable, inline or side-by-side, remembered | ✅ |
| Word-level highlighting inside a changed line, from VS Code's own diff engine | ✅ |
| Diff of the index vs HEAD (`--cached`) or the worktree vs the index, untracked as all-new | ✅ |
| Binary files, conflicts' combined diffs, and >5000-line diffs each stated rather than mis-drawn | ✅ |
| Branch picker: switch, create (from HEAD or a chosen branch), delete — with the unmerged case asking for a second, forced click | ✅ |
| A blocked switch shows git's own multi-line refusal, verbatim | ✅ |
| Merge state: a bar with "continue" (git's own `MERGE_MSG`) and "abort" (two clicks), driven by `MERGE_HEAD` rather than by the conflict list | ✅ |
| A conflicted row's `+` is labelled as marking it resolved — the same `git add` it always was | ✅ |
| Commit message written by the deployment's default model from the staged diff, truncated to a budget and said so, landing in the box as editable text | ✅ |
| A history row expands into its metadata and file list, with per-file churn and git's own binary answer | ✅ |
| Discard / stash, commit graph, undo, rewriting a commit (drop/squash/reset) | ⏳ M5 |

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
               the commit-scope decision, the unified-diff parser, and the AI
               commit message's prompt/truncation/cleaning
  diff-engine/ word-level marks, from VS Code's diff engine (`vscode-diff`)
src/host/      git runner, git service, change watcher, git directory lookup
  adapter/     the only place the host names DSH (webServer, sessions, logger,
               and the model services `llm` + `agentDefaultModel`)
src/client/    browser half
  adapter/     the only place the browser names DSH (slots, tabs, locale) or a URL
  ui/          pure React over ports; no DSH import at all
test/          node --test; real git repositories, real sockets, real jsdom
```

The dependency direction is not a convention here — `test/dependency-direction.test.ts`
fails the suite if `src/core` gains an import, or if a DSH package is imported
outside an `adapter/` directory. One bare specifier is allowlisted in `src/core`:
`vscode-diff`, VS Code's diff engine extracted into a zero-dependency MIT package,
which is what FR-2.3 asks for by name (see `docs/plan.md` D12).

Since M4 the host bundle also carries one runtime `@deepseek-ai/*` import:
`host/adapter/llm.ts` uses the harness's own `BlockAssembler` and
`createUserMessage` rather than reimplementing stream assembly, and declares
`@deepseek-ai/dsh-llm` as a peer dependency (see `docs/plan.md` D23).

## Check

```sh
npm install
npm run check      # tsc --noEmit && 268 tests && build
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
- `test/diff-parse.test.ts` — the diff model from real `git diff` output: hunks and
  line numbers, word-level marks asserted by the text they cover, a whole-line
  replacement earning none, binary and combined (`diff --cc`) output, truncation,
  and the 5000-line fold gate
- `test/commit-message.test.ts` — the AI message's pure halves: the truncation
  budget and its line boundary, the prompt's language and its "the diff was cut"
  sentence, and the cleaning rules for what models answer anyway
- `test/llm-adapter.test.ts` — the one file that names the harness's model
  services, driven with a stand-in context: the route comes from the deployment's
  default selection, several text blocks are joined (reasoning is not), and a
  missing model, a failed stream, and an empty answer each become a stated failure
- `test/host-service.test.ts` — the git service and the `/git-panel` routes over a
  real socket: envelopes, 400/404/405/413, the same-origin refusal, the diff read
  (worktree vs index, untracked, unborn, binary, clean), and the SSE
  `ready` / `changed` / `unavailable` frames
- `test/host-mount.test.ts` — `apply()` from the plugin entry to the wire, and the
  panel mounting in a composition with no language model at all
- `test/client-panel.test.ts` — the panel rendered in jsdom: groups, badges, path
  splitting, clean and failure states, lazy history, the commit box's four scopes
  and its `Ctrl+Enter`, per-row and per-group staging, the sync buttons' enabled
  states, in-place operation errors, the diff pane (opening, folding, layout
  memory, binary placeholder, the list→box→diff DOM order, and the dock's height
  default and drag clamp), the branch picker (listing, switching, creating from
  HEAD or a base, the two-click delete, the forced second ask for an unmerged
  branch, Escape), the merge bar (continue held while conflicts remain, abort
  armed), the sparkle (offered only with a staged diff, the message landing in the
  box, the truncation note, `no-llm`), the conflict row's label, the commit detail
  (files, churn, binary, remembered across folds), and the two-stage registration

## Notes for the next milestone

- Word-level marks come from `vscode-diff` — VS Code's own diff engine, extracted
  into a zero-dependency MIT package — behind `core/diff-engine/marks.ts`. The
  line-level hunks do **not**: git produces those and `core/diff-parse.ts` reads
  them, so the engine never sees a whole file (see `docs/plan.md` D13).
- `execFile` reports a non-zero exit on `error.code`, **not** `error.status`.
  Reading only `status` turned every non-zero exit into `code: null`, which is
  also what "killed by a signal" looks like; `git diff --no-index`'s ordinary
  exit 1 — how an untracked file is rendered as all-new — is what surfaced it.
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
- The model services are read through `ctx.get('llm')` / `ctx.get('agentDefaultModel')`
  and are deliberately NOT in `inject`: a deployment without a model still mounts
  the panel, and only FR-3.5's button answers `no-llm`. `src/host/adapter/llm.ts` is
  the single file that names them.
- `RepoStatus.merging` comes from stat-ing `MERGE_HEAD` in the git directory (the
  same `gitDirOf` the watcher uses), not from the conflict group: once every
  conflict is staged the group is empty while the merge is still open, and that is
  exactly when "continue the merge" has to appear.
- Unstaging on an **unborn** branch is a different command: `git restore --staged`
  restores from HEAD, and an unborn repository has none. `unstage` probes with
  `rev-parse --verify --quiet HEAD` and falls back to `git rm --cached`.
