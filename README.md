# dsh-git-panel

A resident git panel for the DSH Web GUI's right sidebar: see the session
workspace's changes, grouped the way git groups them, with the branch's state
against its upstream — without leaving DSH and without a modal overlay covering
the conversation.

Built to the requirements document, and currently through **M5b order 7**: the
foundation, a read-only panel, the commit loop (stage → commit → push), the diff
view, branch management with the merge state, an AI-written commit message, a
commit detail — then M5a's discard / undo / stash and M5b's commit-file
drill-down, copy entries, and the commit graph, alongside fetch, a read-only
remote-branch list, and HTTPS credentials. What remains of M5b: rewriting a
commit (drop / squash / reset), multi-repository scanning, and the v1.0 release
pass.

## Docs

| File | What it is |
|---|---|
| `docs/requirements.md` | The requirements document, v0.2. A **byte-exact copy** (20 778 bytes, sha256 `f42d4277…`) kept as the single source of truth — read-only; a change means a new version replacing it wholesale. |
| `docs/plan.md` | The execution plan: milestone status against the doc's own acceptance criteria, what each completed milestone delivered and where, every deliberate deviation from the doc with its reason, and the next milestone's task list. |

## What works today

| Area | State |
|---|---|
| Change list: staged / changes / untracked / conflicts. Each row leads with a glyph for what the file IS (code, markup, stylesheet, data, image, prose, shell, settings, or a plain page), and its own right-hand column carries the status letter, which is the English initial of the state (`U` for untracked) with VS Code's `!` for a conflict, plus the meaning as a tooltip | ✅ |
| That list as a **file tree** — directories fold, single-child chains compact into one row, each directory carries its subtree's file count — or as a flat list; the choice is remembered per user | ✅ |
| Branch rail: name, detached / unborn / upstream-gone, ↑ahead ↓behind | ✅ |
| Recent commits: paged by look-ahead, pushed/unpushed marker, read only while its tab is showing | ✅ |
| Auto-refresh from filesystem events — one recursive watch on the work tree, one on the git directory — pushed over SSE with *what* moved (`refs` / `index` / `worktree`); a file an agent writes shows up without touching `.git` at all | ✅ |
| A state-file poll as the fallback when events are unavailable (network drives, platforms without recursive watch), and a `stat` of the same files when even that fails | ✅ |
| Live git status/branches/log over `/git-panel/*` | ✅ |
| Stage / unstage, one file or a whole group | ✅ |
| Commit box with an explicit scope: index only, or the announced `add -u` | ✅ |
| Pull ↓ / push ↑n / sync ⇅, with the upstream set on the first push | ✅ |
| Fetch every remote — a dashed ↓ beside Pull — updating the remote-tracking branches without touching the working tree, the index or the current branch, so the ↑/↓ counts and the ○/● markers learn what the remote has and a merge can never be the side effect. A repository with no remote is told so rather than shown a silent success | ✅ |
| Remote-tracking branches in the branch picker, as a **read-only** section (`origin/feature` plus its tip's subject), read while the picker is open and so refreshed by the same fetch. The rows are labels, not buttons on purpose: checking a remote branch out needs the rebase-onto-origin / drop-local-commits decision and can land in a conflict, which belongs with the conflict view | ✅ |
| HTTPS credentials. A remote that wants one and has none is named as such (`auth-required`, with the origin git itself printed), and the same failure notice grows a username / password form. "Save and retry" stores the pair through the harness's own credential seam — `ctx.credentials`, so the provider owns where the value lives, and this profile's local provider writes its own 0600 document rather than us inventing a store — and then retries the very operation that failed. Every later push/pull/fetch/sync resolves the stored credential and hands it to git through `GIT_ASKPASS`, with `GIT_TERMINAL_PROMPT=0` unchanged so nothing can ever hang on a prompt. The value never reaches a log line | ✅ |
| Push refused as non-fast-forward → points at Sync instead of git's hint text | ✅ |
| UI in zh + en | ✅ |
| Change groups fold away individually, and stay folded (the count stays visible) | ✅ |
| A resident staged drawer directly above the commit box: it is what that box commits, and its empty state says so | ✅ |
| Changes and Untracked are sections of ONE scrolling list rather than drawers of their own: the panel has a single resize grip (the dock's), and each section's header pins itself to the top of that scroller, so a partially scrolled list still says which section you are in | ✅ |
| A clean working tree is stated by the sections themselves: Changes and Untracked stay on screen counting zero (the paragraph that used to say "no uncommitted changes" is gone), and only the staged drawer needs a note, because its header alone does not say why it is empty | ✅ |
| A group with no rows offers no bulk action — except the staged drawer, which keeps its button on screen, disabled, with the empty note as the explanation | ✅ |
| One bottom pane, one strip of tabs — recent commits, plus one tab per open diff — opening on the history tab by default and folded/opened by the tabs themselves (clicking the tab that is showing puts the pane away), sized by a drag handle, keeping every open tab's content loaded; the fold and the height are remembered. Any number of diffs may be open at once, a tab is marked by the same rule as the history tab, and hovering (or focusing) a diff tab reveals that tab's own × — closing one file is not closing the pane | ✅ |
| Diff view: click a change row → the diff opens as a tab of the bottom pane (beside the commit history, never a modal), half the screen tall and drag-resizable, inline or side-by-side, remembered; the diff's own header carries its operations only (layout, reload), and a long file name is ellipsized in the tab and in the diff header, with the directory giving way first (FR-1.2) | ✅ |
| Side-by-side diff is a fixed split: each half is half of the pane whatever the lines are, and each half is its own scroller — a line too long for its half is reached with that half's scrollbar, and the two halves are kept in step on both axes so a paired line stays paired. The halves are separated by a 16px lane (outside both scrollers, so a per-line action placed there can never be pushed around by a long line), with a hairline down the divider. The inline layout is the single-scroller one, where the full width is the reading width | ✅ |
| Word-level highlighting inside a changed line, from VS Code's own diff engine | ✅ |
| Diff of the index vs HEAD (`--cached`) or the worktree vs the index, untracked as all-new | ✅ |
| Binary files, conflicts' combined diffs, and >5000-line diffs each stated rather than mis-drawn | ✅ |
| Branch picker: switch, create (from HEAD or a chosen branch), delete — with the unmerged case asking for a second, forced click | ✅ |
| That picker as a real dropdown: it floats over the panel (measured from the rail, capped at the room left) instead of pushing the staged drawer, the commit box and the change list down; an outside press or Escape closes it | ✅ |
| A blocked switch shows git's own multi-line refusal, verbatim | ✅ |
| Merge state: a bar with "continue" (git's own `MERGE_MSG`) and "abort" (two clicks), driven by `MERGE_HEAD` rather than by the conflict list | ✅ |
| A conflicted row's `+` is labelled as marking it resolved — the same `git add` it always was | ✅ |
| Commit message written by the deployment's default model from the staged diff, truncated to a budget and said so, landing in the box as editable text | ✅ |
| A history row IS one real button — both of its lines, so the clickable area is exactly the hover band — and selecting it splits the pane: the entries stay on the left, that commit's information opens on the right (metadata, then its file list with per-file churn and git's own binary answer) | ✅ |
| One height budget for the whole column (`ui/panel-layout.ts`): every region is bounded, the change list is the only one that grows (a zero flex basis keeps its content out of the arithmetic, so a thousand changed files cannot squeeze the drawers or the dock), the staged drawer is content-sized with no floor — a collapsed one leaves no blank band, so the commit box sits tight against it — and the dock's drag, plus any height it remembers from a taller window, is clamped at what the other regions leave it | ✅ |
| Section headers pinned to the top of the list they scroll in: a partially scrolled change list still says whether it is showing changes or untracked files | ✅ |
| A change row's menu: right-click it (or Shift+F10 / the menu key on the focused row) for that row's own action — stage, unstage, or mark a conflict resolved. It opens in the same floating layer as the branch list, flipping above the row when the panel has no room below | ✅ |
| Discard a change (FR-6.1): a working-tree row gains a third button — and its menu a third entry — that takes two clicks and says "cannot be undone" between them. It restores a tracked file from the index (never from HEAD, so it also works before the first commit) and deletes a file the index has never seen; a staged or conflicted row offers it nowhere | ✅ |
| Undo the newest commit (FR-3.8): the newest history row's menu carries one armed entry whose confirmation says which undo is coming — an unpublished commit is reset (`--mixed`, its changes return to the working tree), a published one is reverted (a new commit; history is never rewritten). The host re-resolves HEAD and re-asks the pushed question at execution time, so a stale row is refused rather than silently undoing a commit nobody pointed at | ✅ |
| The stash (FR-6.2), opened from the rail like the branch list: save the working tree (with an optional label, and untracked files only if you ask for them), read the stack, apply or pop an entry, or drop one. Entries are addressed by commit id rather than by `stash@{n}`, so a stack another window shifted cannot be acted on at the wrong position; dropping is the one irreversible action here and takes two clicks | ✅ |
| A switch git refuses because the working tree is in the way (FR-4.4) shows git's multi-line refusal and offers "stash, then switch to …": one click stashes (untracked files included, because those are exactly what git sometimes names) and retries the very switch that was blocked | ✅ |
| Drill into one file of a commit (FR-7.2): every row in a commit's file list is a button that opens that file as the commit changed it, in the same bottom diff tab a change row uses — `git show <hash> -m --first-parent -- <path>`, read against the revision rather than the working tree, so an uncommitted edit to the same file cannot appear in it. The reading follows moved refs only, and it is not swept away when the file is absent from the change list | ✅ |
| Commit graph (FR-7.1): every history row carries its own swimlane strip — a first parent continues straight down, an extra parent opens a lane, and a line rejoins when the branches meet. The assignment is one pass over all loaded commits, so loading the next page extends the diagram without redrawing it (pagination cannot break the lines); the strip's width is one number shared by every row, so a merge cannot shift the hashes | ✅ |
| Rewriting a commit (drop / squash / reset), multi-repository scanning, the v1.0 release pass | ⏳ M5b |

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
               the commit-scope decision, the unified-diff parser, the change
               list as a file tree, credential addressing (an origin → a record
               id), and the AI commit message's prompt/truncation/cleaning
  diff-engine/ word-level marks, from VS Code's diff engine (`vscode-diff`)
src/host/      git runner, git service, git state probe (filesystem events with a
               polling fallback), git directory lookup, askpass helper
  adapter/     the only place the host names DSH (webServer, sessions, logger,
               the credential seam, and the model services
               `llm` + `agentDefaultModel`)
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

The host bundle carries two runtime `@deepseek-ai/*` imports, both behind an
adapter. `host/adapter/llm.ts` uses the harness's own `BlockAssembler` and
`createUserMessage` rather than reimplementing stream assembly
(`@deepseek-ai/dsh-llm`, D23). `host/adapter/credentials.ts` stores HTTPS
credentials through the harness's credential seam, `ctx.credentials`, rather
than a store of this plugin's own (`@deepseek-ai/dsh-credentials`, D44). Both
are peer dependencies; a composition that mounts neither still mounts the panel,
and the features that need them explain themselves instead of failing silently.

## Check

```sh
npm install
npm run check      # tsc --noEmit && 493 tests && build
```

## Install

Requires DSH >= 0.1.5-rc.1 (the right-sidebar tab-type registry this builds on)
and git >= 2.20.

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-git-plugin
# then restart `dsh web` — a NEW bundle is composed at startup
```

The panel appears through the right sidebar's **＋** control as "Git changes".

## Custom file-type icons

Each change row leads with a glyph for what the file IS: nine built-in kinds
(code, markup, stylesheet, data, image, prose, shell, settings, or a plain page).
A deployment can replace any of them per extension with its own SVG, by writing a
small map at **`$DSH_HOME/git-panel-icons.yml`** (or wherever
`config.fileIconsPath` points):

```yaml
# extension: path to an SVG file
ts: ~/icons/typescript.svg
.tsx: /home/me/icons/tsx.svg   # the leading dot is optional
md: ~/icons/markdown.svg
```

Rules, all of them deliberate:

- **Keys are extensions only** (case-insensitive, with or without the dot), and
  matching is on the last dot of the file name. A name like `Dockerfile` keeps its
  built-in glyph.
- **Values are absolute paths** (`~/…` is expanded). A relative path is refused,
  because there is no meaningful base to resolve it against.
- **The file must be an SVG**, at most 64 KiB, and the map at most 64 entries.
- Everything else keeps its **built-in glyph**, and every line that could not be
  used is logged with the reason (`icon for .md is not an SVG document: …`) — a
  silently missing icon is the one failure that is hard to debug.
- The map is read **per panel mount**, so editing it (or an icon) and reloading the
  panel is enough; nothing has to restart.
- The SVG is handed to the browser as an image (`data:` URL), never injected into
  the panel's DOM, so a configured file cannot run or fetch anything.

Lines may be commented with `#`; quote a value (`'…'` or `"…"`) when the path
itself contains a ` #` or leading/trailing spaces.

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
- `test/change-tree.test.ts` — the change list as a tree (FR-1.3): nesting,
  directories before files in git's own byte order, the compaction of a
  single-child chain and where it must stop, and the per-directory count
- `test/commit-graph.test.ts` — the swimlanes (FR-7.1): a linear chain in one
  lane, a merge opening a lane its second parent's line rejoins, a first parent
  that merges back into an existing lane, an unrelated tip claiming its own lane,
  and the property the pagination rests on — a prefix of the history is a prefix
  of the graph
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
- `test/git-probe.test.ts` — the git state probe over real repositories and real
  filesystem events: a file an agent writes (which moves nothing inside `.git`), an
  empty commit and an `update-ref` (which move only the reflog or a ref), a burst
  coalesced into one report, a strategy that fails at start and one that gives up
  while running (both handing over to the next), a released subscription going
  quiet, and the polling fallback's two signals
- `test/host-auth-flow.test.ts` — the credential path end to end: a real
  `git fetch` against a real HTTP server that answers 401 until Basic
  credentials arrive. Without a stored credential the failure is `auth-required`
  with the origin git named; storing one in the map makes the same fetch succeed
  and really move `refs/remotes/origin/<branch>`. Also the store's checks — an
  origin the repository does not have, a remote that is not a bare origin, and a
  deployment with no credential provider — and the audit line's refusal to carry
  the value
- `test/host-mount.test.ts` — `apply()` from the plugin entry to the wire, and the
  panel mounting in a composition with no language model at all
- `test/client-panel.test.ts` — the panel rendered in jsdom: groups, badges, path
  splitting, clean and failure states, lazy history, the commit box's four scopes
  and its `Ctrl+Enter`, per-row and per-group staging, the sync buttons' enabled
  states, in-place operation errors, what one reported change re-reads (the panel,
  but the history only for `refs` and nothing at all when the reading came back the
  same), the diff pane (opening, folding, layout
  memory, binary placeholder, the list→box→diff DOM order, and the dock's height
  default and drag clamp), the branch picker (listing, switching, creating from
  HEAD or a base, the two-click delete, the forced second ask for an unmerged
  branch, Escape), the branch dropdown's floating layer (absolute, measured from
  the rail, dismissed by a press outside but not by one inside it or on the
  trigger that owns the toggle), the merge bar (continue held while conflicts remain, abort
  armed), the sparkle (offered only with a staged diff, the message landing in the
  box, the truncation note, `no-llm`), the conflict row's label, the commit detail
  (files, churn, binary, remembered across folds), the file tree (nesting,
  compaction, the directory caret actually turning, folds remembered per group,
  the mode switch and its memory, and staging/opening a diff from inside the
  tree), and the two-stage registration

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
  load-bearing: the git state probe watches that file, so a read that wrote it would
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
