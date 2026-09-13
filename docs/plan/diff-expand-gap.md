# 计划 · diff 行间操作：展开两处 hunk 之间的行

- **来源**：`docs/plan.md` §10.3「diff 行间操作：展开两处 hunk 之间的行」（产品方 2026-09-13 提出）
- **对应 TODO**：[TODO.md](../TODO.md) A-12
- **状态**：未排期；**两处待定都已定**（2026-09-13）：行数用算式推导；
  内容走"**逐处展开、开到底**"（新增一条按 revision 读内容的路由）

## 目标

在两处 hunk 之间渲染一行控制，点开后把 git 省掉的未修改行补进视图——
**点哪一处就开哪一处，且开到底**，不受 diff 的 context 上限约束。

## 一、行数：纯算式，不需要新数据

`DiffHunk` 就带起止（`core/types.ts:481-497`：`oldStart` / `oldCount` / `newStart` / `newCount`），
两处 hunk 之间的未修改区间因此可以直接算：

```
gap.oldStart = prev.oldStart + prev.oldCount      // 1-based，紧接上一处 hunk 的第一行
gap.oldCount = next.oldStart - gap.oldStart
```

new 侧同理，两侧只差一个固定偏移（区间内没有改动），偏移就取
`gap.newStart - gap.oldStart`。

边界与例外：

- **hunk 紧邻**（`gap.oldCount === 0`）：不渲染，不留空行。
- **两处 hunk 之间**是唯一"不需要文件总行数"的情形——产品方点名的范围正好落地。
- **第一个 hunk 之上 / 最后一个 hunk 之下**要展开就必须知道文件总行数，而
  `FileDiff` 里**没有**这个字段（`core/types.ts:507-535` 的 `lines` 是各 hunk 正文行数之和）。
  这两个方向**不做**；若将来要做，接口形状同下（区间换成 `1 .. prev.oldStart - 1`）。

写成 `core/` 下的纯函数，单测覆盖：相邻 hunk、hunk 紧邻、首个 hunk 之前、末个 hunk 之后。

## 二、内容：新增一条读路由，只读一侧

### 为什么必须新增

`FileDiff.hunks[].lines` 只含 **hunk 内**的行（`core/types.ts:495`），host 按
`--unified=<context>` 取（`src/host/git-service.ts:1102`）——git 的 hunk 之间一行都没有。

复用现成的 `diff` 路由（它本来就接 `context` 查询参数，`routes.ts:397` / `:399`，
host 夹到 `MAX_CONTEXT_LINES = 50`）**已被否决**：context 是整请求的共同参数，
点一处会把所有缝隙一起放开；context 变大后相邻 hunk 会合并、被点的缝隙可能直接消失；
且 50 行封顶，开不到底。它实现的是"上下文调到 50"，不是"展开这一处"。

### 接口

```
GET /git-panel/fileLines?…&from=<int>&count=<int>
```

- 端口方法（`core/ports.ts` 的 `GitRemoteClient`）：
  `fileLines(sessionId, path, target, from, count, signal) => Result<FileSnippet>`，
  `FileSnippet = { from, lines: string[], truncated }`（`from` 是 1-based 首行号）。
- 加入 `routes.ts` 的 `READ_OPERATIONS`（`routes.ts:65-77`）：它只读，因此是 `GET`。
- 校验照抄 `diffPath`（`git-service.ts:1076-1095`）：先 `validatePaths([path])`，
  commit 目标再 `validateHash`，然后 `repoRoot`；`from` / `count` 也要 host 侧夹取
  （count 给一个上限，别让手写请求一次拉整个文件）。

### 为什么只读一侧（关键简化）

**缝隙里的行在两侧逐字相同**——这正是"hunk 之间"的定义。所以取一侧就够，
另一侧的行号由上面那个偏移推出来。取哪一侧：

| diff 区域 | old 侧的来源 | 落成 git 命令 |
|---|---|---|
| `worktree`（工作区 vs 索引） | 索引里的 blob | `git show :<path>` |
| `index`（索引 vs HEAD） | HEAD 的 blob | `git show HEAD:<path>` |
| `commit`（提交 vs 第一个父） | 父提交的 blob | `git show <hash>^:<path>` |

选 **old 侧**是因为它在所有可能出现缝隙的情形里都是一个 git 对象，
**不需要读文件系统**——本插件至今没有直接读过文件（未跟踪文件也是走
`git diff --no-index`，`git-service.ts:1141-1156`），这条路线能保持这个性质。
无父提交（根提交）、无 HEAD 等"old 侧不存在"的情况本来就没有缝隙（整文件都是新增/删除），
让命令失败后如实报错即可。

host 侧拿整个 blob 的 stdout、按行切开、切出 `[from, from+count)` 再返回，
所以**响应只有用得着的那几行**，客户端不做全文件切片。

### 容量与失败

- 复用 runner 的 stdout 上限（`DEFAULT_MAX_STDOUT_BYTES = 8 MiB`，
  `git-exec.ts:42`，超限以 `truncated` 上报）。`truncated` 时**不画半截行**：
  该缝隙的展开行改成一句"内容过大，未能读取"。
- 二进制文件：`FileDiff.binary` 为真时本来就没有 hunk，不存在缝隙。

## 三、渲染

补齐的行就是 `kind: 'context'` 的 `DiffLine`（两侧都填 `oldLine` / `newLine`），
而 `splitRows` 对 context 的处理（`{ left: line, right: line }`，`DiffView.tsx:162-166`）
已经是正确形状，两侧各取各的行号。所以 `splitRows` 与 `LineCell` 不用改，只需要能遍历
"hunk 与缝隙交替"的序列：引入 `DiffSegment = {kind:'hunk',hunk} | {kind:'gap',gap}`，
`DiffHunks` / `SplitHunks` 改为遍历 segments。gap 行的控件就是 A-9 说的**行间操作**载体。

## 状态与并发

- 展开状态是 `DiffPane` 里的一个 `Set`（key 形如 `gap\u0000oldStart`），切换文件 /
  比较目标时清空（照 `expanded` 的重置写法，`DiffView.tsx:613-618`）。
  `DiffView` 保持纯渲染，只多收 `expandedGaps` 与 `onResolveGap` 回调。
- 同一文件多次展开共用一次读取：per-file 的 promise 缓存（key 含 path 与 side），
  外加一个 epoch 守卫作废 in-flight 的旧结果（better-sidebar 的
  `DiffRows.tsx:128-141` / `foldEpoch` 就是这个形状）。

## 不变量

- 展开只增加 context 行：`additions` / `deletions` / `lines` / `large` 都不因此改变。
- 左右对照下 gap 行要在两半都渲染且内容相同，否则两半错位。
- 展开后行数会明显增长，与 A-6（diff 虚拟滚动）互相牵扯：一次展开几千行会把今天
  "整块渲染"的代价放大。

## 验收

两处 hunk 之间出现可点的展开行，行数与算式一致；点开后补齐的行与文件内容逐字一致、
行号正确；两处 hunk 各开各的，开一处不影响另一处；`+N −M` 不变；
超过上限的文件如实报"读不了"而不是画半截；切换文件后状态清空。
