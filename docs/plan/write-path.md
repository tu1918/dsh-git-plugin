# 计划 · 统一写入口（把文件变更收成唯一入口）

- **来源**：`docs/plan/agent-collaboration.md` §5.9 / §5.10 / §5.11 / §5.12，以及 §9.2 的 MVP 定义
- **对应 TODO**：[TODO.md](../TODO.md) A-17
- **状态**：**已排期（观察者先行），尚未开工**。MVP 与分期见「排期」；接线与机制已查清；
  `passthrough` 默认按惰性记（P0 再确认）

## 目标

让本插件成为这个 harness 里**文件变更的唯一入口**：agent 的读 / 写 / 编辑走我们注册的
`ctx.fs` provider，从而在一个进程内同时得到四样东西——**归属**（谁写的）、**互斥**
（同一路径排队）、**陈旧编辑的安全落地**（按 base 校验 + 三方重放）、**审计**。

## 为什么落在本仓

产品方 2026-09-13 定：工作量够得上独立插件，但它**依赖本仓已有的能力**——仓库 / 工作区的
解析、git 状态与忽略规则、面板这个 review 面。所以不拆仓。

## 现状：已查清的事实（2026-09-13，实读 profile 里的官方包）

| 事实 | 出处 / 含义 |
|---|---|
| provider 靠 overlay 选，同时只有一个 | `dsh-base/cordis.patch.yml` 用 loader id **`fs-sandbox`** 插入 `@deepseek-ai/dsh-fs-sandbox`；`dsh-fs-local` 只是它的父类依赖，不单独挂载。替换 = profile patch 里 `- id: fs-sandbox` + `disabled: true`，再 `- insert:` 我们的行 |
| 类链 | `FileSystem`（`dsh-fs`，缝）→ `LocalFileSystem`（`dsh-fs-local`）→ `SandboxedFileSystem`（`dsh-fs-sandbox`）。我们 `extends SandboxedFileSystem` 以保留沙箱 |
| 接线 | `dsh-tool-fs` 自己调 `ctx.waterfall("fs/write-intent" \| "fs/edit-intent", target, exec, () => void 0)`，把返回值当 `intent` 传给 `ctx.fs.writeText` / `editText`，写完再 `ctx.emit("fs/observed", …, {version})` |
| 取消 read-before-edit | 把 `dsh-fs-observation-policy` **disable** 掉即可（waterfall 回落到 `() => void 0`，intent 变成「无守卫」），守卫逻辑搬进我们的 provider |
| sandbox | `sandboxPolicy` 由工具**每次调用**算好传入（`sandbox.resolvePolicy("write" \| "edit", args, exec)`），provider 原样转给 `super` |
| base 白拿 | 作为 provider 我们看得见每次 `read` / `write` / `edit` / `stat`，自己维护 version→content 缓存，不依赖那个 policy |

## MVP 做法（讨论文档 §9.2 的六件事）

1. 按 `FsTarget` **进程内排队**（互斥）；
2. 记**归属**：`actor` → session / agent；
3. `writeText`：沿用 `expected`（CAS），不符即拒，错误里带现状摘要；
4. `editText`：按 §5.12 的规则——在 **base** 上精确且唯一地解析锚点；`disk == base` 直接写；
   否则 `git merge-file(disk, base, base+edit)`（**fuzz 0**），只有干净**且**编辑区间与磁盘
   已变区间不相交才落盘；否则返回**带两侧内容的类型化冲突**；
5. **审计一行**（actor / path / 结果 / 是否归并或冲突）；
6. 配置开关 `passthrough`：打开即逐字回到父类（**kill switch**）。

**明确不用**：`patch --fuzz`（GNU patch 自己的 BUGS 承认重复代码会「改错还报成功」）；
「相似度 < 1.0 的近似锚点」一律不收。

## 落地形状【已定：同包两行】（2026-09-13）

产品方定：**同一个包、bundle patch 里插两行**，每行都能按 loader id 单独 disable。

- `package.json` 的 `exports` 加一个 host 子路径（如 `"./fs": "./lib/fs.js"`），
  `build/build.mjs` 多产一个 host bundle（**只有 provider**，不含面板与客户端）。
- 本包自己的 `cordis.patch.yml` 插两行：

```yaml
- insert:
    - id: ui-git-panel      # 面板（现有那行）
      name: dsh-git-panel
    - id: fs-provider       # 统一写入口
      name: dsh-git-panel/fs
```

- 部署侧（profile patch）按需开关，全都用现成的 id 定向机制：
  - `- id: fs-provider` + `disabled: true` → 只要面板、不要写入口；
  - **`- id: tool-fs` + `disabled: true`** → 让出 `read` / `write` / `edit` / `read_image`
    四个**工具名**给我们注册（见「已定的设计决定」#1：同 scope 工具名不能重复，只能整包让位）。
    行 id 已核对：`dsh-base/cordis.patch.yml` 里就是 **`tool-fs`**；
  - `- id: fs-sandbox` + `disabled: true` → 把 `ctx.fs` 让给我们的 provider；
  - 可选 `- id: fs-observation-policy` + `disabled: true` → 取消 read-before-edit。

**包内子路径可用，有先例**：同一个 loader 里已经在挂 `@linxin666/dsh-web-all/git-graph`、
`@deepseek-ai/dsh-tool-subagent-control/list-agents` 这种**包内子路径**（loader 的
`import(name)` 直接吃模块标识符），所以 `dsh-git-panel/fs` 是同一机制。

## 已定的设计决定（2026-09-13，产品方逐条定）

1. **工具面：整包接管 fs 工具**（原「替换现有编辑工具」的落地形状）。
   **已验证的机制**（实读 `dsh-tools` / `dsh-tool-fs`）：
   - **没有**「全局按名字盖掉官方工具」这回事——`restrict()` 拒绝全局使用（实现原话：
     「a context-global restriction would mask every agent」），同 scope 重名注册直接抛
     （`tool "edit" is already registered`），而且**没有** `unregister(name)`（`register`
     只返回**自己的** disposer）。
   - 唯一的作用域手段是 **per-agent**：「scoped registrations shadow globals」，且只在
     `agent.ctx` 下可用。**要全局换掉 `edit`，只能换掉注册它的那个插件。**
   - `edit` 来自 `dsh-tool-fs`，与 `read` / `write` / `read_image` 在同一处注册，
     **`Config` 没有单工具开关**——所以只能整包替换。
   - `str_replace_editor`（`dsh-tool-str-replace-editor`）**本 profile 没挂**，
     「替换它」在这里是空动作。

   **形状**：profile patch 里 disable `dsh-tool-fs` 那一行；我们注册自己的
   `read` / `write` / `edit` / `read_image`——**工具名不变**，模型端只看到 schema 变了。

   **代价（要一并接过去）**：read 的分页 / 流式 / 上限（`readLimit` / `readMaxLineLength` /
   `readMaxBytes` / `readStreamMinSize`）、`read_image` 的 attachments 接线、
   `presentationMeta` 的 diff、以及那几段 system-prompt section。

   **先例**：`lynx-gt/dsh-subagent-tools` 就是 disable 官方 `dsh-tool-subagent` 行 + 插自己的包，
   自述「patches no official package file」。
2. **冲突 UX：类型化错误 + 修复信息。** 不写盘；返回路径、base / current / 本次尝试的结果、
   以及该区域的新锚点，让 agent 一轮修好，而不是重读整个文件。**不写 git 冲突标记**
   （半成品进工作区，还会随下一次编辑嵌套）。
3. **kill switch：全局一个开关。** `passthrough` 打开即整个 provider 逐字回到父类行为；
   本 profile 开着 `patchReload: live`，翻配置可能不必重启（到时验）。
4. **安全策略：严格失败优先。** 我们自己的代码抛非预期错误时**也拒写**，不回落父类——
   回落的写就不可审计。拒写必须带一个**可 grep 的「内部错误」错误码**，与「你的锚点有问题」
   区分开。代价：我们的 bug 率就是编辑被挡的概率，**测试门槛因此最高**；kill switch 是唯一的
   逃生口。
5. **base 的存放：内存 LRU + 只有 stale 才起进程。** 按路径缓存 `version → content`，字节上限 +
   LRU（如 32 MB），同一 host 进程内按 workspace realpath 共享；用内容哈希做 `disk == base`
   的快路径（命中则零额外进程），只有 stale 才跑 `git merge-file`。host 重启后缓存为空，
   之后的第一次 stale 编辑只能硬拒（要求重读）——这是安全方向。

**一处仍待确认**：第 4 条只定了「自身故障也拒写」；选项里「默认惰性（装上不生效，开了才管）」
没有被否掉，先按**默认惰性**记——要「装上即生效」说一声。

## 不在本 MVP 里（见讨论文档）

黑板 / intent（§5.8）、推送消息（§5.7）、提交签名与出处（§4）、Mergiraf 结构合并（§5.6）、
bash 的 sandbox 收紧与检测-回退（§5.10）、面板 UI。

## 排期（2026-09-13 定）

产品方定：**观察者先行**——先把位置占住、同时开始产出 reviewer 缺的那份数据，**再**开强制。
位置确实稀缺（同一时刻只有一个 `ctx.fs` provider，同一个 scope 一组工具名只能被一个插件注册），
但「抢」的方式是**不参与决策的观察者**，所以 P1 不可能出错。

| 期 | 内容 | 行为 | 验收 |
|---|---|---|---|
| **P0 前置** | 定 `./fs` 入口与 build 产物；本包 patch 两行；确认 `passthrough` 默认惰性 | 无 | 两个 bundle 都能构建；profile 侧 disable `tool-fs` + `fs-sandbox` 后，面板与编辑照常 |
| **P1 观察者** | provider（`extends SandboxedFileSystem`，**passthrough**）+ 自注册 `read` / `write` / `edit` / `read_image`（原样转发）+ **归属** + **审计** + **shadow 决策日志** | **零变化** | 装上后行为逐字不变；每次 `write` / `edit` 留下带 actor 的一行审计；shadow 能说出「本来会归并 / 本来会拒」；关掉 `fs-provider` 行即回原状 |
| **P2 review 面** | 变更行的**来源胶囊**；dock 第三 tab「**活动**」；两条读路由 + SSE 帧（见下节 schema） | 无 | 人能看见「这一行是谁写的」；活动流倒序可分页；复用既有 SSE/刷新链路，不新增轮询 |
| **P3 开强制** | 按路径排队、base 校验 + 三方重放、类型化拒绝 + 修复信息、严格失败优先 + 内部错误码、kill switch | **开始变化** | 本文件「验收」六条 |
| **P4 开关项**（各自默认关） | **黑板**（`blackboard: false`——产品方：不是所有人都用，且是新的尝试）与**出处 / 签名**（讨论文档 §4） | 开启才变化 | 各自独立验收；不开时零足迹 |

## 与 UI 的接口 schema（第一步）

产品方定：**第一步先把和 UI 交互的接口 schema 写出来**，其余都好说。
数据只有两类、方向只有两个：**host → UI 的只读数据**，以及（P3 才有的）**UI → host 的动作**。

### 一、host → UI：纯类型（放 `core/write-path.ts`，零 DSH 依赖）

```ts
/** 谁写的。身份是 ambient 的，不来自参数。 */
export interface WriteActor {
  readonly sessionId: string
  readonly agentId: string | null      // 委派树里的会话 id
  readonly subagentId: string | null   // 直接子会话（若是 subagent）
  readonly tool: string                // 'write' | 'edit' | …
  readonly model: string | null        // provider/model，若上下文可得
}

/** 这次写的结果：有意拒绝与「我们自己的故障」必须分开。 */
export type WriteOutcome =
  | { readonly kind: 'applied' }                                // 直接落盘
  | { readonly kind: 'merged' }                                 // stale，三方归并后落盘
  | { readonly kind: 'refused'; readonly reason: WriteRefusal }  // 有意拒绝
  | { readonly kind: 'internal-error'; readonly code: string }   // 我们的故障，可 grep

export type WriteRefusal =
  | 'anchor-not-found'          // 锚点在 base 里找不到
  | 'anchor-ambiguous'          // 在 base 里不唯一
  | 'anchor-count-changed'      // base 唯一、disk 变重复
  | 'overlaps-external-change'  // 与磁盘已变区间相交
  | 'merge-conflict'            // 三方归并有冲突
  | 'approximate-anchor'        // 相似度 < 1.0，一律不收

/** 一个文件的当前归属：变更行上的「来源」胶囊读它。 */
export interface FileAttribution {
  readonly path: string
  readonly version: string             // FsVersion 字符串化
  readonly at: number                  // epoch ms
  readonly actor: WriteActor
  readonly outcome: WriteOutcome
  readonly baseVersion: string | null  // 这次编辑基于哪个版本；stale 时 ≠ version
}

/** 审计流的一条：dock 的「活动」tab 读它。 */
export interface WriteAuditEvent {
  readonly seq: number                 // 单调，客户端据此增量拉
  readonly at: number
  readonly path: string
  readonly actor: WriteActor
  readonly outcome: WriteOutcome
  readonly mergedFrom: string | null   // 归并时：base 版本
  readonly shadow?: WriteOutcome       // P1 专用：没执行时「本来会怎么做」
}
```

### 二、UI → host：P1 / P2 只有读，动作留到 P3

| 接口 | 形状 | 说明 |
|---|---|---|
| `GET /git-panel/write/attribution?session&paths=a,b` | `{ files: FileAttribution[] }` | 变更列表按行问；缺 `paths` 回空 |
| `GET /git-panel/write/audit?session&cursor&limit` | `{ events: WriteAuditEvent[]; nextCursor: string \| null }` | 倒序分页；`limit` 夹在 1–200 |
| SSE `/git-panel/events` 新帧 `{ kind: 'write', seq }` | — | **不新增流**：复用既有探测 / SSE，客户端收到就重读 |

- 都在既有读路由的约定里：session 在 query、失败走 200 信封（D10）、**不进** `WRITE_OPERATIONS`。
- 审计存在 host 的**内存环形缓冲**（按 workspace realpath 键控，上限 N 条），**不落工作区**
  （§6.3 的教训）。
- P3 的动作（**形状先定，实现留到 P3**）：

```ts
/** 待人的拍板项：写入口想执行、但要人确认的一次写。 */
export interface PendingDecision {
  readonly id: string
  readonly at: number
  readonly path: string
  readonly actor: WriteActor
  readonly reason: 'irreversible' | 'contract-change' | 'overlaps-uncommitted'
  readonly summary: string          // 面板上显示的一句话
}
```

| 接口 | 形状 |
|---|---|
| `GET /git-panel/write/pending?session` | `{ items: PendingDecision[] }` |
| `POST /git-panel/write/decide` | ← `{ session, id, decision: 'approve' \| 'deny' }`；→ `{ ok: true }` 或信封失败；**进 `WRITE_OPERATIONS`**（同源 + loopback） |

- P4 的黑板走**独立命名空间、默认不注册**。

### 三、落点

- `core/write-path.ts`：上面这些纯类型（沿用 `core/types.ts` 的风格：readonly + 判别联合）。
- host：写入口发布一个 **`ctx.writePath` 服务**（查询 + 事件），**自己不注册任何 HTTP 路由**——
  网关仍只有面板那一处。
- 面板的 `host/adapter/routes.ts` 把它暴露成上表两个读路由；`client/adapter/git-client.ts`
  加两个读方法。
- 归属与变更行的对应：**按 path**（一次编辑一行审计）；同一 path 的 staged / unstaged 两行
  共享同一个「最后写者」。

## 验收（讨论文档 §9.2 的六条）

1. 现有 `read` / `write` / `edit` / `str_replace` 行为不变（回归）；
2. 两个会话并发写同一文件**串行**，审计能点名 actor；
3. **不重叠**的 stale 编辑自动归并，并发改动被保住；
4. **重叠**的 stale 编辑返回带两侧内容的冲突，而不是静默覆盖；
5. kill switch 打开即回旧语义；
6. 无新增依赖（除 git 本身），Windows 上临时路径有测试。
