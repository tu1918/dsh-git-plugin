# 执行计划 · dsh-git-panel

本文件跟踪 `docs/requirements.md` 的实现进度。

`docs/requirements.md` 是需求文档 v0.2 的**逐字节副本**（20 778 字节，sha256
`f42d4277a71c1951ce1df9d2b9a8277428b0e5c6de2ff92109d036171e229d09`，与原始
附件一致）。它是规格，**只读、不要就地编辑**：要改就先出 v0.3 版本再整体替换，
否则「规格」和「实现」会一起漂移，这份计划也就失去了参照物。

需求文档是**唯一规格来源**。本文件只记录「做到哪、怎么做的、和文档哪里不一样、
下一步做什么」；两者冲突时以需求文档为准，并把差异登记到下面的
「与需求文档的偏差」。

- 代码：`src/`（24 个源文件）、`test/`（10 个测试文件）
- 校验：`npm run check` → `tsc --noEmit` + 153 项测试 + 两个打包产物

---

## 1. 状态总览

| 里程碑 | 内容 | 验收标准（文档 §7） | 状态 |
|---|---|---|---|
| **M0** | core 骨架（types/ports/git-parse）+ host/client adapter + 依赖方向规则 | 解析器测试全绿；adapter 目录是唯一碰 DSH API 的地方 | ✅ 完成 |
| **M1** | host service + status/log/branches 只读 + sidebar tab 渲染变更列表 | 面板能看到当前仓库变更分组与分支 | ✅ 完成并在 GUI 中确认 |
| **M2** | stage/unstage/commit/push/pull/sync + 提交框 + 历史 | 不碰终端完成 改→暂存→提交→推送 全流程 | ✅ 完成（`npm run check` 全绿；重启 `dsh web` 后确认加载的是 M2 构建：`POST /git-panel/stage` 被接受，两个产物含 M2 文案且构建时间早于进程启动时间。界面控件未由我目视确认——本会话浏览器 provider 不可用，见 §11） |
| **M3** | diff 视图 + 逐词高亮 + 布局切换 | 点文件可见 VS Code 级 diff | ⏳ 下一步 |
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

## 4. M2 交付

文档 §7 对 M2 的验收是「不碰终端完成 改→暂存→提交→推送 全流程」。这条验收
由一个端到端测试守着（`test/host-mutations.test.ts` →「the full M2 flow」），
它在一个真实仓库 + 真实裸远程上依次跑完 改/暂存/提交/推送，并核对远程的 ref
确实指向新提交。

| 文档要求 | 落点 |
|---|---|
| FR-3.1 文件行 `+`/`−`（hover 显现） | `ChangeRow` → `action.stage` / `action.unstage` |
| FR-3.2 分组批量「全部暂存 / 全部取消暂存」 | `Group` 的 `batch`；staged→取消暂存，unstaged/untracked→全部暂存 |
| FR-3.3 常驻提交框、多行、`Ctrl+Enter` | `src/client/ui/CommitBox.tsx`（受控组件，草稿由面板持有） |
| FR-3.4 **提交范围显式化** | 纯函数 `src/core/commit-scope.ts` → `CommitScope`/`CommitPlan`；文案与调用由它派生 |
| FR-5.1 拉取 ↓ / 推送 ↑n / 同步 ⇅ | `BranchRail` 三个按钮 + `push`/`pull`/`sync`；按 ahead/behind/upstream 启用 |
| FR-5.2 首次推送自动设上游 | `pushRepo`：无 upstream 时 `push --set-upstream <remote> <branch>` |
| FR-5.3 pull 冲突进入冲突态 | 冲突被识别为 `conflict`，冲突文件已落在既有的「合并冲突」分组；专用 UI 归 FR-9 |
| FR-5.4 推送被拒（non-fast-forward）给可读提示 | 失败分类为 `non-fast-forward`，面板文案直接指向「同步」 |
| §4.3 操作级错误就地显示、不清空列表、保留 git 多行输出 | `data-action-error` 区块；`errorCopy(…, 'action')`；`data-multiline` 保留换行 |
| §4.3 主题 token | `styles.ts` 新增类全部走 `--dsw-alias-*`，无写死色值 |
| §5.4 service 契约（写入部分） | `stage`/`unstage`/`commit`/`commitAll`/`push`/`pull`/`sync`，名字与文档一致 |
| §5.5 参数形状校验 | 纯函数 `src/core/validate.ts`（路径、消息）+ `test/validate.test.ts` |
| §5.5 破坏性操作审计日志 | 每个写操作经 `ports.log('info', …)` 记一行（含仓库根、路径数、提交的 oid 与 subject） |

**未做（有意）**：FR-3.5 AI 提交信息（文档排在 M4）、FR-3.6 的提交详情下钻与
FR-3.8 撤销提交（M4/M5）。二次确认的「点击武装」模式在 M2 没有用户——
M2 没有不可逆操作（push 可重试，commit 可 reset）——按 D7 的原则，代码等 M5 的
discard/deleteBranch 一起写。

---

## 5. 与需求文档的偏差

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
| **D8** | FR-5.1「同步 = pull --rebase=false + push」 | 实现为 `git pull --no-rebase --no-edit` | 两条 flag 都是「不要等一个不存在的终端」：`--no-rebase` 让分叉的 pull 产生合并提交（文档自己的措辞），而**分叉时必须合并**意味着 git 会要一个提交信息——没有 `--no-edit` 它会等到 15s deadline 被杀掉（已实测）。**代价**：忽略用户 `pull.rebase=true` 的偏好；分叉时留下一个合并提交 |
| **D9** | §5.5 假定路由在 DSH 鉴权之后 | **写入路由额外**加同源（`Origin` ↔ `Host`）校验 | loopback 只挡别的机器，不挡别的页面：本机任何网页都能向 `POST /git-panel/*` 发请求。写在 200/400 之前，跨源一律 403。无 `Origin` 的请求（curl、测试、自带工具）放行，由 loopback 兜底 |
| **D10** | §5.4 服务契约未规定传输细节 | 读用 `GET`（session 在 query），写用 `POST`（session + 参数在 JSON body）；**body 形状错也算操作失败**，与业务失败一样走 200 + 信封 | 前端只有一条错误路径（信封），这是本文件一以贯之的选择（见 `routes.ts` 头注释）。只有「body 根本不是 JSON」「没有 session」「方法不对」「跨源」才用非 200 |
| **D11** | §5.5 要求「所有 git 参数校验形状」 | M2 只实现**真的有调用方**的两个校验：路径、提交信息；hash/分支名校验留到 M4/M5 使用它们的操作一起写 | 遵循 D7 的同一条理由（不留无人调用的代码）。`.git` 路径是**额外**加的：`git status` 永远不报告它，所以只可能是手写请求——正是要挡的那种 |

---

## 6. 承重设计（改这块前先读）

1. **`GIT_OPTIONAL_LOCKS` 读为 `0`、写为 `1`。**
   实测：`=0` 时 `git status` 不改写 `.git/index`；`=1` 时会改写。而变更监听器
   正在轮询该文件——一次会写它的读取会让面板无限自我刷新。
   `run(args, cwd, optionalLocks = false)`：**所有读走默认值，所有写显式传 `true`**
   （M2 的 7 个写操作全部如此），否则写操作拿不到 index 锁。守住这条性质的测试：
   「the change stream」→ `does NOT fire from the panel reading status`。

2. **watcher 先建立基线，再宣布 ready。**
   第一版在定时器首跳时才建立基线，于是「订阅后、首跳前」发生的改动会被当成基线
   吞掉。现在 `watch()` 返回 Promise，其 resolve 即「从现在起一定能看见」的语义保证；
   SSE 的 `ready` 在 await 之后才发出。改这块时不要把它变回「先 ready 再落基线」。

3. **未出生分支的 unstage 是另一条命令。**
   `git restore --staged` 是从 HEAD 恢复，而空仓库没有 HEAD（实测：
   `fatal: could not resolve HEAD`）。`unstage` 先探一次 `rev-parse --verify --quiet
   HEAD`，没有 HEAD 时改用 `git rm --cached -r --quiet`。删掉这个分支会让「第一次
   提交前取消暂存」直接报错。

4. **`optionalLocks` 的默认值写在 `run` 的形参上，不写在 `options` 里。**
   调用点必须**显式**说「我要写」，读代码的人才能一眼看出哪些调用会动 index。

---

## 7. 安全现状

- **浏览器只传不透明 session id**，host 用自己 session store 里的 cwd 解析真实路径
  （`host/adapter/workspace.ts`）。不从客户端接受任何路径，因此没有穿越/越权检查
  可写错。
- **loopback-only 网关**（`host/adapter/routes.ts`）：接受 `127.0.0.1`、`::1`、
  `::ffff:127.0.0.1`、`127.x`，其余一律 403。因为 DSH 前端鉴权不覆盖第三方路由
  （见 D6）。
- **写操作的 CSRF 面**（D9）：`POST` + 同源校验 + 请求体 1 MiB 上限。跨源页面可以
  让浏览器发出请求，但不能让它声称本站源。
- **参数形状**（D11）：路径禁绝对/`..`/`.git`，消息禁空与 NUL；所有 git 调用都用
  参数数组 + `--` 分隔，无 shell 插值。
- **审计日志**：每个写操作记一行（`stage`/`unstage` 记路径数，`commit` 记
  short oid 与 subject，`push`/`pull` 记分支与仓库根）。
- **M5 待办**：discard / deleteBranch / undoCommit 这三个**破坏性**操作落地时，
  需要各自的「点击武装→3s 内再点」确认（§4.3）与更明确的审计（删了哪个分支、
  丢弃了哪些路径）。若将来要支持 LAN 访问，再补「可信 authority / 配对设备
  cookie」的逃生口。

---

## 8. M3 任务清单

文档 §7 对 M3 的验收是「点文件可见 VS Code 级 diff」。M2 留下的两个钩子已经就位：
变更行是 `div`（不是按钮），`ChangeRow` 已按分组拿到 `area`，所以点一行即可决定
「HEAD↔工作区」还是「HEAD↔索引」（FR-2.2）；未跟踪文件按全新增渲染。

**core（纯函数，M3 的主体）**
- [ ] `core/diff-engine/`：移植 VS Code `DefaultLinesDiffComputer`，输入两段文本、
      输出行级 hunks + 逐词（word-level）区间（FR-2.3）。纯函数，测试直接喂字符串
- [ ] unified diff 的**解析**（`git diff` 输出 → hunks）也要在 core，别放进 host：
      它是字节解析，与 `git-parse.ts` 同类

**host**
- [ ] `diff(sessionId, path, area, contextLines)`：`worktree` 用 `git diff --no-color`
      （可选 `--` path），`index` 用 `git diff --cached`；`optionalLocks` 保持 `false`
- [ ] 新建文件：`git diff --no-index /dev/null <path>` 或读文件后按全新增渲染
- [ ] 二进制探测（FR-2.5）：`--numstat` 的 `-\t-` 即二进制；**不要**把二进制内容
      读进内存
- [ ] 大文件保护（FR-2.6）：沿用 `maxStdoutBytes` 的 `truncated` 语义，>5000 行
      在响应里标记而**不是**在 host 里折叠
- [ ] 路由：`GET /git-panel/diff`（读操作，沿用现有信封）

**client**
- [ ] `DiffView.tsx`：inline / side-by-side 切换，选择记在 `localStorage`（FR-2.4）
- [ ] 变更行点击 → 侧栏内嵌 diff（FR-2.1，**不弹模态**）。注意：行内 `+`/`−` 按钮
      必须 `stopPropagation`，否则点暂存会同时打开 diff
- [ ] `>5000` 行默认折叠 + 「加载」按钮；二进制显示占位文案
- [ ] 逐词高亮只上色一次、不做 O(n²) 比较（§6 性能）

**测试**：diff 引擎的逐词标记用固定输入；hunks 解析用真实 `git diff` 输出；
`DiffView` 在 jsdom 里的布局切换与折叠；路由的 `truncated`/`binary` 两个标记。

---

## 9. M4–M5 概要

- **M3（diff）**：移植 VS Code `DefaultLinesDiffComputer` 的逐词标记入 `core/diff-engine/`
  （纯函数，天然属于 core）；`DiffView.tsx` 支持 inline / side-by-side 并记住选择；
  二进制提示（FR-2.5）；>5000 行默认折叠（FR-2.6）。渲染建议走虚拟滚动（§6 性能）。
- **M4**：分支新建/删除/切换（FR-4.1–4.4，含切换失败时展示 git 多行输出 + 「贮藏后切换」）、
  sync、冲突态 UI（FR-9）、AI 提交信息（`HostPorts.generateText` ← `ctx.llm` adapter，§8.3 token 成本）。
- **M5**：discard（二次确认「不可恢复」）、stash、提交图 SVG 泳道、撤销最近提交
  （未推送 `reset --mixed`／已推送 `revert`，执行前后端重新核实 —— FR-3.8）、多仓库扫描（FR-8）。

---

## 10. 风险与开放问题（对应文档 §8）

| §8 | 现状 |
|---|---|
| 1 client-plugin API 稳定性 | **已证实是真问题**：本 profile 里装着 `@dsh-plugin/dsh-loader`，它的存在理由之一就是 `httpServer` 被改名为 `webServer`。防腐层正在起作用——DSH 变更的改动面被收口在 `adapter/` |
| 2 watcher 可靠性 | 已用轮询（非 `fs.watch`）规避；但**同步盘/网络盘仍未实机验证** |
| 3 AI 提交信息成本 | 未涉及（M4）。注意文档要求「默认按钮触发、不自动生成」 |
| 4 大仓库性能 | timeout 15s + `truncated` 标记已就位；**未在真实 monorepo 上压过** |
| 5 兼容层的代价 | 接受。代价是简单功能也要过一道 ports；收益是 `core` 能在裸 Node 里测试 |
| 新增 | **第三方 `webServer` 路由不在 DSH 鉴权范围内**（见 D6/§7）。凡是注册路由的插件都要自带网关 |
| 新增 | **`commit.gpgsign=true` 的仓库里，面板提交可能卡在 gpg 密码提示上**，直到 15s deadline。`GIT_TERMINAL_PROMPT=0` 管不到 gpg。M2 不传 `--no-gpg-sign`（那会静默产生未签名提交，比超时更糟）；待办是识别这个失败并给出「请检查签名配置」的具体文案 |
| 新增 | **凭据缺失的 push/pull 只报 git 原文**（`could not read Username … terminal prompts disabled`）。够用，但没有专门文案；等 M4 做远程同步完善时再分类 |
| 新增 | **`push`/`pull` 会走真实网络**，测试里只覆盖了 file transport 与裸仓库；https/ssh 未实机验证 |

---

## 11. 与同 profile 另一个 git 插件的分工

同一个 web profile 里装着 `@linxin666/dsh-client-ui-git-graph`（v0.3.20，成熟第三方
插件）。两边**都**在右侧栏出现、**都**用分支图标、名字都带「Git」，因此很容易被当成
同一个东西。它们其实是**两套几乎不相交的功能**，各自注册自己的路由前缀：

| | 本插件 `/git-panel/*` | 它 `/git/*` |
|---|---|---|
| 变更列表 | ✅ 三组 + 冲突组 | ✅ `/git/status` |
| **暂存 / 取消暂存（含分组批量）** | ✅ | ❌ 无对应路由 |
| **提交（范围显式化，含 `add -u` 分支）** | ✅ | ❌ |
| **推送 / 拉取 / 同步** | ✅ | ❌ |
| 提交图谱 | ⬜ M5（FR-7.1） | ✅ `/git/graph` |
| 切换 / 新建分支 | ⬜ M4（FR-4） | ✅ `/git/switch`、`/git/create-branch` |
| 工作树隔离、设置卡 | ⬜ 非目标 | ✅ `/git/worktree-*` |
| 输入框分支胶囊（空白会话） | ⬜ 非目标 | ✅ |
| diff 视图 | ⬜ M3（FR-2） | ❌（其 README 未声明） |
| 遥测 | **无**（不外发任何数据） | 每 UTC 日一次匿名安装心跳（其 README 声明） |

结论：不是「谁是谁的子集」，而是**文档 §1.2 指出的那个缺口仍然成立**——它给了
分支/图谱/工作树，但没有「常驻侧边栏 + 可写提交」这条闭环；本插件的 M2 正是补这条。
反过来它的图谱与分支管理对应本插件的 M5 与 M4，属于**尚未做的里程碑**，不是设计放弃。

命名上如果要更清楚，可把本插件 tab 从「Git」改成更具体的名字（`type.label`），
但它出现在右侧栏、以「Git 变更」为引导条目名，与它那个输入框胶囊不在一处，
实际不易混。**不要**为了避开它而改 `kind`/`id`：`id` 是本体注册的 key
（`sidebar.right.pane.tab` 的 key），改名等于让已打开的标签失效。
