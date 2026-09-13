# 计划 · 展示 work tree（仓库的多个工作树）

- **来源**：`docs/plan.md` §10.3（产品方 2026-09-13 提出）
- **对应 TODO**：[TODO.md](../TODO.md) A-13
- **状态**：未排期

## 背景

- git 的 **worktree**（`git worktree add`）让一个仓库有多个工作树，共享同一份对象库与 refs。
  本仓库自己就在用：主工作树 `dsh-git-plugin`（`master`）旁边挂着
  `../dsh-git-plugin-a9`（`feat/a9-diff-op-groups`）——正是为并行会话隔离工作区。
- 本插件**现在完全没有** worktree 概念：`docs/plan.md` §12 把「工作树隔离」记成非目标，
  同 profile 的 `dsh-client-ui-git-graph` 有 `/git/worktree-*`。
- 已有的基础：`src/host/git-dir.ts:30` 的 `gitDirOf` 已经会读 linked worktree 的 `.git`
  **文件**（`gitdir: <path>`），所以面板在**非主工作树里本来就能跑**（读状态、执行操作、
  fs.watch 探测都成立）。缺的只是「把兄弟工作树列出来」。

## 目标

在面板里看到当前仓库的**全部工作树**：路径、所在分支（或游离 HEAD）、以及
`bare` / `locked` / `prunable` 标记。**纯只读**——不做 `add` / `remove` / `prune` / `lock`。

## 做法

1. **解析（core，纯函数）**：新增 `parseWorktreeList`，吃
   `git worktree list --porcelain` 的 stdout。本机实测（git 2.43.0）的形状：空行分隔若干
   record，每段以 `worktree <path>` 开头，随 `HEAD <oid>`、`branch refs/heads/<name>`
   （无 `branch` 行即游离 HEAD），以及可选的 `bare` / `locked [reason]` / `prunable [reason]`。
   形状落 `src/core/types.ts` 的 `WorktreeEntry`（字段：`path`、`head`、`branch | null`、
   `detached`、`bare`、`locked`、`prunable`）。
2. **host**：新增 `worktrees(sessionId)`，一次只读调用（`GIT_OPTIONAL_LOCKS=0`，与其它只读
   同一条环境策略），路由 `GET /git-panel/worktrees` 进 `READ_OPERATIONS`。
3. **client**：`GitRemoteClient.worktrees` 镜像一份，UI 落点见「待定」。

## 待定（要产品方定）

1. **入口**：仓库下拉（FR-8）里加一个只读分组 / 分支行新开一层（像贮藏）/ 底部 dock 新标签 /
   别的。
2. **是否允许切到另一个工作树**。若做，语义是把那条路径选成 repo root，与 FR-8 的多仓库
   选择是同一条路（`selectRepo`）。但有个硬冲突要先解决：`resolveRepo` 只在**会话目录及其
   一层子目录**里找仓库（`host/repo-discovery.ts` 的规则），而工作树常在会话目录**之外**
   （本仓库的 `../dsh-git-plugin-a9` 就是），浏览器又只许传不透明 `sessionId` + 相对路径
   （§5.5），所以「越界的绝对路径」怎么校验必须单独定——这是安全面，不能由客户端给。
3. **只有一条 record**（没有兄弟工作树）时是否整节隐藏，还是显示一条。
4. 是否给主工作树一个标记（`git worktree list` 的第一条即主工作树，但要在代码里判断它，
   得比 `git rev-parse --git-common-dir`）。

## 验收

- 在有两个工作树的真仓库里：面板列出两条、分支名正确；游离 HEAD 的有说明；`locked`
  显示标记；只有一个工作树时不出现空盒子。
- 只读：整个过程不发任何会改写 `.git` 的命令（`GIT_OPTIONAL_LOCKS=0` 有测试钉住）。
