# 执行计划 · dsh-git-panel

本文件跟踪 `docs/requirements.md` 的实现进度。

`docs/requirements.md` 是需求文档 v0.2 的**逐字节副本**（20 778 字节，sha256
`f42d4277a71c1951ce1df9d2b9a8277428b0e5c6de2ff92109d036171e229d09`，与原始
附件一致）。它是规格，**只读、不要就地编辑**：要改就先出 v0.3 版本再整体替换，
否则「规格」和「实现」会一起漂移，这份计划也就失去了参照物。

需求文档是**唯一规格来源**。本文件只记录「做到哪、怎么做的、和文档哪里不一样、
下一步做什么」；两者冲突时以需求文档为准，并把差异登记到下面的
「与需求文档的偏差」。

- 代码：`src/`（20 个源文件）、`test/`（7 个测试文件）
- 校验：`npm run check` → `tsc --noEmit` + 84 项测试 + 两个打包产物

---

## 1. 状态总览

| 里程碑 | 内容 | 验收标准（文档 §7） | 状态 |
|---|---|---|---|
| **M0** | core 骨架（types/ports/git-parse）+ host/client adapter + 依赖方向规则 | 解析器测试全绿；adapter 目录是唯一碰 DSH API 的地方 | ✅ 完成 |
| **M1** | host service + status/log/branches 只读 + sidebar tab 渲染变更列表 | 面板能看到当前仓库变更分组与分支 | ✅ 完成并在 GUI 中确认 |
| **M2** | stage/unstage/commit/push/pull + 提交框 + 历史 | 不碰终端完成 改→暂存→提交→推送 全流程 | ⏳ 下一步 |
| **M3** | diff 视图 + 逐词高亮 + 布局切换 | 点文件可见 VS Code 级 diff | ⬜ 未开始 |
| **M4** | 新建/删除分支、sync、冲突标记、AI 提交信息 | 分支管理与同步全在面板内闭环 | ⬜ 未开始 |
| **M5** | discard、stash、提交图、撤销、多仓库 | 发布 v1.0 | ⬜ 未开始 |

---

## 2. M0 交付

| 文档要求 | 落点 |
|---|---|
| `core/` 零 DSH 依赖，纯 TS | `src/core/{types,ports,git-parse,format}.ts` — 只 import 自己的相对模块 |
| porcelain v2 / numstat / log 解析（纯函数） | `src/core/git-parse.ts`（numstat 留待 M2 的提交详情） |
| `host/adapter/` 与 `client/adapter/` 是唯一允许 import DSH 的地方 | `src/host/adapter/{logger,routes,workspace}.ts`、`src/client/adapter/{git-client,locale,sidebar-tab,tab-body}.tsx` |
| 解析器测试全绿 | `test/git-parse.test.ts`（字节级 fixture）+ `test/git-integration.test.ts`（真实仓库） |
| 客户端打包产物 | `build/build.mjs` → `lib/index.js`（ESM）+ `lib/client.js`（`window.__ModuleLoader__.load` 工厂） |
| 依赖方向用 eslint `no-restricted-imports` 强制 | **改为** `test/dependency-direction.test.ts`，见偏差 D3 |

## 3. M1 交付

| 文档要求 | 落点 |
|---|---|
| FR-1.1 三组变更（+ 冲突组） | `groupsOf()`；冲突单独成组、不重复列出 |
| FR-1.2 状态徽标 + 保留文件名截断目录 | `badgeFor()`（字母随所在分组）+ CSS flex（文件名不收缩、目录可裁） |
| FR-1.5 分支行：分支名 / ↑n↓n / detached / 空仓库 | `BranchInfo` + `BranchRail` |
| FR-1.4 自动刷新（mtime 监听 + 轮询兜底 + 手动刷新） | `src/host/watcher.ts` + SSE + 刷新按钮，见偏差 D4 |
| FR-3.6 历史列表（短 hash / subject / 作者 / 相对时间 / ○●） | `History` + `markPushed()` |
| FR-3.7 分页（默认 30、加载更多、上限 500） | look-ahead 分页（多取 1 条即知 hasMore），见偏差 D5 |
| §5.4 service 契约（只读部分） | `status` / `branches` / `log` / `stagedPaths` |
| §4.2 布局（分支行 + 分组列表 + 最近提交） | `src/client/ui/StatusPanel.tsx` |
| §4.3 全部颜色走 `--dsw-alias-*` | `src/client/ui/styles.ts`；无任何写死色值 |
| §6 国际化 zh/en | `src/client/locales.ts`（中文为 key 集来源，英文按 key 校验） |

**已在真实环境确认**：运行中的 `dsh web` 上 `status`/`branches`/`log` 返回真实仓库
数据，SSE 送出 `ready`，右侧栏能看到 Git 标签页。

---

## 4. 与需求文档的偏差

均为有意决策，逐条记录原因。

| # | 文档写的 | 实际做的 | 原因 |
|---|---|---|---|
| **D1** | §4.1「与内置 Files 标签并列」的 sidebar tab | 注册为**右侧栏** tab type（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab` 两段式） | DSH 0.1.5-rc.1 里 Files 就在右侧栏（`dsh-client-ui-sidebar-right`）。文档的意图（与 Files 并列、非模态）达成，只是换了一侧 |
| **D2** | §5.3 首选 TypertRemoteService，备选 webServer 路由 | 采用 **webServer HTTP 路由 + SSE**（文档自己的备选） | Remote 的 wire schema 由 `@deepseek-ai/dsh-typert-generator` 从主仓 FaceModel 生成；该生成器未随发行版安装、也未发布。`ctx.typert.register()` 接受手写 schema，但无先例。同 profile 里成熟的第三方 git 插件也走 HTTP 路由。改动面被限制在 `client/adapter/git-client.ts` + `host/adapter/routes.ts` 两个文件，端口不变 |
| **D3** | §5.2 用 eslint `no-restricted-imports` | 改为可执行测试 `test/dependency-direction.test.ts` | 会跑的规则比「配了但没人跑」的规则更可靠。它在开发中真的抓到了违规（`routes.ts`、`locales.ts` 都曾从 adapter 之外碰 DSH），因此把它们移进 `adapter/` |
| **D4** | FR-1.4「mtime 监听 + 面板可见时 10s 轮询，不可见时停止」 | 订阅期间按 1s 轮询 `.git/index`/`HEAD`/`packed-refs` 等；「可见」表达为「存在 SSE 订阅者」 | 文档 §8.2 自己指出 mtime 监听在同步盘/网络盘不可靠，故只做轮询不做 `fs.watch`。「停止」由浏览器断开 SSE 实现——没人看时不花任何代价。轮询 1s 而非 10s，以满足 §4.4「1s 内自动反映」 |
| **D5** | FR-3.7 历史分页显示总数，上限 500 | 多取 1 条判断 hasMore；`total` 故意为 `null` | 算总数需要 `git rev-list --count HEAD`，在大 monorepo 上要遍历全部历史（秒级），只为显示一个「加载更多」不需要的数字。上限 500 已实现 |
| **D6** | §5.5 安全需求（假定路由在 DSH 鉴权之后） | **额外**加了 loopback-only 网关 | 实测：`/` 无凭据返回 401，而插件注册的 `/git-panel/*` 返回 200——DSH 前端鉴权不覆盖第三方 `webServer` 路由。详见 §6 |
| **D7** | FR-1.2 路径过长截断目录（隐含字符预算实现） | 用 CSS flex：文件名不收缩、目录可裁切 | 侧栏宽度可变，字符预算需要测量容器；CSS 在任意宽度下都正确。因此删掉了已写好的 `shortenPath()` 纯函数，不留无人调用的代码 |

---

## 5. M2 必须遵守的两条结论

1. **`GIT_OPTIONAL_LOCKS` 默认为 `0`，这是承重设计，不是优化。**
   实测：`=0` 时 `git status` 不改写 `.git/index`；`=1` 时会改写。
   而变更监听器正在轮询该文件——一次会写它的读取会让面板无限自我刷新。
   `GitRunner.run(args, { optionalLocks })` 默认 `false`；**所有写操作（add/commit/
   push/pull/checkout）必须显式传 `true`**，否则拿不到 index 锁。
   已有一条测试专门守住这个性质（`the change stream` → `does NOT fire from the
   panel reading status`）。

2. **watcher 先建立基线，再宣布 ready。**
   第一版在定时器首跳时才建立基线，于是「订阅后、首跳前」发生的改动会被当成基线
   吞掉。现在 `watch()` 返回 Promise，其 resolve 即「从现在起一定能看见」的语义保证；
   SSE 的 `ready` 在 await 之后才发出。改这块时不要把它变回「先 ready 再落基线」。

---

## 6. 安全现状

- **浏览器只传不透明 session id**，host 用自己 session store 里的 cwd 解析真实路径
  （`host/adapter/workspace.ts`）。不从客户端接受任何路径，因此没有穿越/越权检查
  可写错。
- **loopback-only 网关**（`host/adapter/routes.ts`）：接受 `127.0.0.1`、`::1`、
  `::ffff:127.0.0.1`、`127.x`，其余一律 403。因为 DSH 前端鉴权不覆盖第三方路由
  （见 D6）。
- **M2 待办**：写操作会引入副作用，因此还需要
  - §5.5 的形状校验（hash `^[0-9a-f]{4,40}$`、分支名禁 `..`/`:`/控制字符/`-` 开头、路径禁绝对与 `..`）——建议做成 `core/` 里的纯函数并测试
  - 破坏性操作（discard / deleteBranch / undoCommit）的审计日志
  - CSRF 面：跨站 GET 读不到响应（无 CORS 头），但写操作需要额外防护（非简单方法 /
    校验 `Origin`）
  - 若将来要支持 LAN 访问，再补「可信 authority / 配对设备 cookie」的逃生口

---

## 7. M2 任务清单

文档 §7 对 M2 的验收是「不碰终端完成 改→暂存→提交→推送 全流程」。

**host**
- [ ] `stage(paths)` / `unstage(paths)`（`restore --staged`；空仓库用 `rm --cached`）
- [ ] `commit(message)`：只提交暂存区，`optionalLocks: true`
- [ ] `commitAll(message)`：显式 `add -u` + commit（对应 FR-3.4 的文案）
- [ ] `push()`：无上游时自动 `--set-upstream origin <branch>`（FR-5.2）
- [ ] `pull()` / `sync()`（FR-5.1）
- [ ] 非 fast-forward 拒绝时的可读提示（FR-5.4：引导改用「同步」）
- [ ] 参数校验纯函数 + 审计日志（§5.5）

**client**
- [ ] `CommitBox`：常驻提交框、多行、`Ctrl+Enter`（FR-3.3）
- [ ] **提交范围显式化**（FR-3.4）——这条是文档里竞品的核心教训，建议把判定做成
      `core/` 纯函数（有暂存→只提交暂存区；无暂存但有已跟踪改动→按钮文案变
      「提交全部已跟踪更改」并明示 `add -u`；只有未跟踪文件→禁用并提示先暂存）
- [ ] 文件行 `+` / `−`（hover 显现，FR-3.1）
- [ ] 分组标题的批量「全部暂存 / 全部取消暂存」（FR-3.2，对应竞品教训「首次提交
      几十文件是灾难」）
- [ ] 操作级错误就地显示、不清空列表（§4.3）
- [ ] 二次确认用「点击武装→3s 内再点」模式，不用原生 confirm（§4.3）

**测试**：真实临时仓库跑 stage/commit/push/pull 全流程；FR-3.4 的判定表；
错误就地显示（含 git 多行输出保留换行）。

---

## 8. M3–M5 概要

- **M3（diff）**：移植 VS Code `DefaultLinesDiffComputer` 的逐词标记入 `core/diff-engine/`
  （纯函数，天然属于 core）；`DiffView.tsx` 支持 inline / side-by-side 并记住选择；
  二进制提示（FR-2.5）；>5000 行默认折叠（FR-2.6）。渲染建议走虚拟滚动（§6 性能）。
- **M4**：分支新建/删除/切换（FR-4.1–4.4，含切换失败时展示 git 多行输出 + 「贮藏后切换」）、
  sync、冲突态 UI（FR-9）、AI 提交信息（`HostPorts.generateText` ← `ctx.llm` adapter，§8.3 token 成本）。
- **M5**：discard（二次确认「不可恢复」）、stash、提交图 SVG 泳道、撤销最近提交
  （未推送 `reset --mixed`／已推送 `revert`，执行前后端重新核实 —— FR-3.8）、多仓库扫描（FR-8）。

---

## 9. 风险与开放问题（对应文档 §8）

| §8 | 现状 |
|---|---|
| 1 client-plugin API 稳定性 | **已证实是真问题**：本 profile 里装着 `@dsh-plugin/dsh-loader`，它的存在理由之一就是 `httpServer` 被改名为 `webServer`。防腐层正在起作用——DSH 变更的改动面被收口在 `adapter/` |
| 2 watcher 可靠性 | 已用轮询（非 `fs.watch`）规避；但**同步盘/网络盘仍未实机验证** |
| 3 AI 提交信息成本 | 未涉及（M4）。注意文档要求「默认按钮触发、不自动生成」 |
| 4 大仓库性能 | timeout 15s + `truncated` 标记已就位；**未在真实 monorepo 上压过** |
| 5 兼容层的代价 | 接受。代价是简单功能也要过一道 ports；收益是 `core` 能在裸 Node 里测试 |
| 新增 | **第三方 `webServer` 路由不在 DSH 鉴权范围内**（见 D6/§6）。凡是注册路由的插件都要自带网关 |
