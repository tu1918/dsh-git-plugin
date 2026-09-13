# 计划 · git 操作的端到端超时（点 fetch 一直转圈）

- **来源**：`docs/plan.md` §10.3（产品方 2026-09-13 报来）
- **对应 TODO**：[TODO.md](../TODO.md) F-1
- **状态**：未排期（缺陷，未修）

## 现象

点「获取所有远程」（fetch）后，rail 上的 spinner 一直转，**不成功也不失败**，用户只能
关标签页或刷新页面。

## 现状（两层，均已实测）

- **host 有 deadline，但它只覆盖「能被 SIGTERM 杀死的子进程」。** 每个 git 进程的 15s
  来自 `execFile` 的 `timeout`（`src/host/git-exec.ts:39` `DEFAULT_TIMEOUT_MS = 15_000`）。
  Node 的 `timeout` 到点**只发 SIGTERM**、不升级 SIGKILL；而 `execFile` 的回调挂在进程
  `close` 上（要等子进程退出**且 stdio 管道关闭**）。子进程不理会 SIGTERM 时，promise
  永不 settle。
  **本机实测**：PATH 里放一个 `trap "" TERM` 的假 `git`，`createGitRunner().run(…,
  { timeoutMs: 15_000 })` 在 **31s 后仍未 settle**。替身对应的真实情形有两类：
  `git fetch` 拉起的 `git-remote-*` / `ssh` helper 活过父进程并占着管道；进程处于
  不可中断睡眠（D 状态，挂在网络盘 / FUSE 上）。
- **同一层的第二处缺口**：`DirectoryQueues`（`src/host/git-exec.ts:120`）对**排队等待**
  不设任何 deadline——deadline 只从进程 spawn 起算，排在别人后面的请求可以无限期不开始。
- **已排除**：黑洞 http / https / ssh 远端（TCP 接受后一言不发）都会在 ~15s 以
  `timedOut: true` 返回。普通网络挂起这条**是好的**，别把它当成这次的病根。
- **client 完全没有 deadline**。`src/client/adapter/git-client.ts` 的 `request` / `mutate`
  只透传调用方的 `AbortSignal`，而那个 signal 是**标签页生命周期**的
  （`src/client/ui/StatusPanel.tsx:133`「Aborted when the tab closes」），标签页开着就永不
  abort；面板也没有取消按钮。于是只要 host 那一层不回答，spinner（`busy 或 pending`）
  就一直转下去。
- **配置面还有一个静默失灵的洞**：`Config.gitTimeoutMs`（`src/host/index.ts:39`）原样透传
  给 `execFile`，而 Node 的 `timeout: 0` 等于**不限时**——profile 里写 0 会悄悄关掉整条
  安全网，不报错。

## 目标

任何一次 git 操作都要么在有限时间内给出结果，要么给出「还在跑 / 超时，结果未知」的明确
状态并恢复控件；面板不能出现没有出路的 spinner。

## 做法（建议，待排期时定）

1. **host：`execFile` 换成 `spawn`**，换来三件事：① 到期先 SIGTERM、宽限后 **SIGKILL**；
   ② 在进程 `exit` 上就 settle 并 destroy stdout/stderr，而不是等 `close`——这一步才是
   「helper 占着管道」的解；③ 暴露 abort，让上层能主动杀进程。
2. **host route：给每个请求加一层 deadline**（定时器 + 竞速），即使 git promise 永不
   settle 也先给浏览器一个信封。信封的措辞必须是「等太久了，**结果未知**」，而不是
   「操作失败」——git 可能已经改了仓库。
3. **client：给每个请求自己的 deadline + 一个取消入口**。注意 mutation 的取消不等于操作
   没发生：超时后的文案只能是「等太久了 / 结果未知，已重新读取」，随后回读仓库状态。
4. 顺手把 `gitTimeoutMs` 的 0 变成显式语义（拒绝，或在文档里写明 0 = 不限时），别让配置
   静默关掉安全网。

## 待定

- 三处时限的数值（进程 deadline / SIGTERM 宽限 / 请求 deadline / client deadline）。
- 取消一个 mutation 后，host 是否要主动 kill 对应 git 进程（需要把请求与队列里的任务关联）。
- 是否给在途操作条（FR-9.3）加一句「已经跑了 Xs」的进度说明。

## 验收

- 用不理会 SIGTERM 的 git 替身验证：面板在请求 deadline 内给出可见结果，spinner 停下、
  按钮恢复可用。
- 黑洞远端仍按 ~15s 报超时；一次正常 fetch 的行为不变。
- 取消 / 超时一次 mutation 后，面板回读并如实显示仓库最终状态，不谎报成功或失败。
