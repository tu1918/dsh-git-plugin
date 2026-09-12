# 执行计划 · dsh-git-panel

本文件跟踪 `docs/requirements.md` 的实现进度。

`docs/requirements.md` 是需求文档 v0.2 的**逐字节副本**（20 778 字节，sha256
`f42d4277a71c1951ce1df9d2b9a8277428b0e5c6de2ff92109d036171e229d09`，与原始
附件一致）。它是规格，**只读、不要就地编辑**：要改就先出 v0.3 版本再整体替换，
否则「规格」和「实现」会一起漂移，这份计划也就失去了参照物。

需求文档是**唯一规格来源**。本文件只记录「做到哪、怎么做的、和文档哪里不一样、
下一步做什么」；两者冲突时以需求文档为准，并把差异登记到下面的
「与需求文档的偏差」。

- 代码：`src/`（56 个源文件）、`test/`（20 个测试文件）
- 校验：`npm run check` → `tsc --noEmit` + 462 项测试 + 两个打包产物

---

## 1. 状态总览

| 里程碑 | 内容 | 验收标准（文档 §7） | 状态 |
|---|---|---|---|
| **M0** | core 骨架（types/ports/git-parse）+ host/client adapter + 依赖方向规则 | 解析器测试全绿；adapter 目录是唯一碰 DSH API 的地方 | ✅ 完成 |
| **M1** | host service + status/log/branches 只读 + sidebar tab 渲染变更列表 | 面板能看到当前仓库变更分组与分支 | ✅ 完成并在 GUI 中确认 |
| **M2** | stage/unstage/commit/push/pull/sync + 提交框 + 历史 | 不碰终端完成 改→暂存→提交→推送 全流程 | ✅ 完成（`npm run check` 全绿；重启 `dsh web` 后确认加载的是 M2 构建：`POST /git-panel/stage` 被接受，两个产物含 M2 文案且构建时间早于进程启动时间。界面控件未由我目视确认——本会话的 `browser_*` 工具一律返回 “no usable browser provider is registered”） |
| **M3** | diff 视图 + 逐词高亮 + 布局切换 | 点文件可见 VS Code 级 diff | ✅ 完成（`npm run check` 全绿：192 项测试——15 项 diff 解析/逐词、8 项 host diff 服务 + 路由、15 项 DiffView/BottomPane/分组操作交互；两个产物重建。**重启后的运行实例已端到端核对**：用真实 session 打 `/git-panel/diff`，worktree / index / 未跟踪 / 二进制逐条验过，证据见 §8 末。**浏览器里的观感仍待人工看一眼**——本会话的 `browser_*` 工具一律返回 “no usable browser provider is registered”，交互行为由 jsdom 测试覆盖） |
| **M4** | 分支新建/删除/切换、冲突态 UI、AI 提交信息（+ 提交详情初步） | 分支管理与同步全在面板内闭环 | ✅ 完成（`npm run check` 全绿：268 项测试；三项收窄 D20–D22。分支/合并/详情在**真实仓库**上跑通，AI 生成用**桩模型**验证了提示词与清洗，唯一没验的是浏览器里的观感——本会话 `browser_*` 工具仍返回 “no usable browser provider is registered”） |
| **M5a** | 行级菜单机制、discard、撤销最近提交、stash（贮藏） | 破坏性写操作全部经「点击武装」确认 + 审计（文档 §7 的 M5 按 D24 拆分） | 🚧 **四个顺序全部交付、待产品方验收**：顺序 1 行级菜单机制、2 discard、3 undoCommit、4 stash（§10.1）；D20 有意留下的「贮藏后切换」随顺序 4 补回 FR-4.4 的受阻路径。`npm run check` 全绿（419 项测试）。**GUI 观感待人工确认**：宿主进程加载的是启动时的构建，本次构建要重启 `dsh web` 才会生效 |
| **M5b** | 提交图、提交详情下钻单文件 diff、多仓库、提交改写 | 发布 v1.0（文档 §7 原文） | 🚧 **进行中**：顺序 5（提交详情下钻单文件 diff）、顺序 6（复制类条目）与顺序 7（提交图）已交付，见 §10.2；顺序 8 多仓库、9 提交改写、10 发布收尾未开始。**GUI 观感待人工确认**（宿主进程加载的是启动时的构建，本次构建要重启 `dsh web` 才会生效） |

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
FR-3.8 撤销提交（下钻排在 M5b、撤销排在 M5a，见 §10）。二次确认的「点击武装」
模式在 M2 没有用户——M2 没有不可逆操作（push 可重试，commit 可 reset）——按 D7 的
原则，代码等第一个真的需要它的破坏性操作一起写：deleteBranch 在 M4 兑现，
discard 与 undoCommit 在 M5a。

---

## 5. 与需求文档的偏差

均为有意决策，逐条记录原因。

| # | 文档写的 | 实际做的 | 原因 |
|---|---|---|---|
| **D1** | §4.1「与内置 Files 标签并列」的 sidebar tab | 注册为**右侧栏** tab type（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab` 两段式） | DSH 0.1.5-rc.1 里 Files 就在右侧栏（`dsh-client-ui-sidebar-right`）。文档的意图（与 Files 并列、非模态）达成，只是换了一侧 |
| **D2** | §5.3 首选 TypertRemoteService，备选 webServer 路由 | 采用 **webServer HTTP 路由 + SSE**（文档自己的备选） | Remote 的 wire schema 由 `@deepseek-ai/dsh-typert-generator` 从主仓 FaceModel 生成；该生成器未随发行版安装、也未发布。`ctx.typert.register()` 接受手写 schema，但无先例。同 profile 里成熟的第三方 git 插件也走 HTTP 路由。改动面被限制在 `client/adapter/git-client.ts` + `host/adapter/routes.ts` 两个文件，端口不变 |
| **D3** | §5.2 用 eslint `no-restricted-imports` | 改为可执行测试 `test/dependency-direction.test.ts` | 会跑的规则比「配了但没人跑」的规则更可靠。它在开发中真的抓到了违规（`routes.ts`、`locales.ts` 都曾从 adapter 之外碰 DSH），因此把它们移进 `adapter/` |
| **D4** | FR-1.4「mtime 监听 + 面板可见时 10s 轮询，不可见时停止」 | 订阅期间按 1s 轮询 `.git/index`/`HEAD`/`packed-refs` 等；「可见」表达为「存在 SSE 订阅者」 | 文档 §8.2 自己指出 mtime 监听在同步盘/网络盘不可靠，故只做轮询不做 `fs.watch`。「停止」由浏览器断开 SSE 实现——没人看时不花任何代价。轮询 1s 而非 10s，以满足 §4.4「1s 内自动反映」。**⚠ 2026-09-12 由 D25 修订**：主路径换成文件系统事件，轮询降级为回退策略（原因见 D25） |
| **D5** | FR-3.7 历史分页显示总数，上限 500 | 多取 1 条判断 hasMore；`total` 故意为 `null` | 算总数需要 `git rev-list --count HEAD`，在大 monorepo 上要遍历全部历史（秒级），只为显示一个「加载更多」不需要的数字。上限 500 已实现 |
| **D6** | §5.5 安全需求（假定路由在 DSH 鉴权之后） | **额外**加了 loopback-only 网关 | 实测：`/` 无凭据返回 401，而插件注册的 `/git-panel/*` 返回 200——DSH 前端鉴权不覆盖第三方 `webServer` 路由。详见 §6 |
| **D7** | FR-1.2 路径过长截断目录（隐含字符预算实现） | 用 CSS flex：文件名不收缩、目录可裁切 | 侧栏宽度可变，字符预算需要测量容器；CSS 在任意宽度下都正确。因此删掉了已写好的 `shortenPath()` 纯函数，不留无人调用的代码 |
| **D8** | FR-5.1「同步 = pull --rebase=false + push」 | 实现为 `git pull --no-rebase --no-edit` | 两条 flag 都是「不要等一个不存在的终端」：`--no-rebase` 让分叉的 pull 产生合并提交（文档自己的措辞），而**分叉时必须合并**意味着 git 会要一个提交信息——没有 `--no-edit` 它会等到 15s deadline 被杀掉（已实测）。**代价**：忽略用户 `pull.rebase=true` 的偏好；分叉时留下一个合并提交 |
| **D9** | §5.5 假定路由在 DSH 鉴权之后 | **写入路由额外**加同源（`Origin` ↔ `Host`）校验 | loopback 只挡别的机器，不挡别的页面：本机任何网页都能向 `POST /git-panel/*` 发请求。写在 200/400 之前，跨源一律 403。无 `Origin` 的请求（curl、测试、自带工具）放行，由 loopback 兜底 |
| **D10** | §5.4 服务契约未规定传输细节 | 读用 `GET`（session 在 query），写用 `POST`（session + 参数在 JSON body）；**body 形状错也算操作失败**，与业务失败一样走 200 + 信封 | 前端只有一条错误路径（信封），这是本文件一以贯之的选择（见 `routes.ts` 头注释）。只有「body 根本不是 JSON」「没有 session」「方法不对」「跨源」才用非 200 |
| **D11** | §5.5 要求「所有 git 参数校验形状」 | M2 只实现**真的有调用方**的两个校验：路径、提交信息；hash/分支名校验留到使用它们的操作一起写（M4 已带来分支名、基点与 `showCommit` 的 hash；M5a 顺序 3 的 `undoCommit` 复用同一个 `validateHash`） | 遵循 D7 的同一条理由（不留无人调用的代码）。`.git` 路径是**额外**加的：`git status` 永远不报告它，所以只可能是手写请求——正是要挡的那种 |
| **D12** | §5.3「移植 VS Code `DefaultLinesDiffComputer` 入 core」 | 改为**依赖** `vscode-diff@^3.0.1`（MIT、零运行时依赖，就是那个引擎的抽取版），并给 `core` 的「零外部 import」守卫开一个**具名白名单**（`test/dependency-direction.test.ts` 的 `CORE_ALLOWED_PACKAGES`） | 手写同构算法只能复刻 Myers 搜索，复刻不了它上面那层启发式（丢短匹配、extend-to-word、把变更块细化到字符区间），而那层才是「VS Code 级」的实际含义。该包零依赖、纯 TS，`node --test` 仍能直接跑 core，所以守卫要保护的性质没变。**代价**：插件首次有运行时依赖（host bundle 仍 `packages: 'external'`，由 profile 的 node_modules 解析；client bundle 不引用引擎，浏览器打包规则不变） |
| **D13** | §8「`core/diff-engine/`：输入两段文本，输出行级 hunks + 逐词区间」 | 行级 hunks 由 **git** 产出、`core/diff-parse.ts` 解析；引擎只负责**一个变更块内部**的逐词区间与行对齐（`diff-engine/marks.ts`） | git 的行级 diff 尊重 `.gitattributes` 过滤器、rename 检测、二进制嗅探，且不需要把整文件读进内存；引擎做 git 不报告的那部分。VS Code 自己也是「diff computer / renderer」这样分工 |
| **D14** | FR-2.6「单文件 diff 超过 5000 行时默认折叠，点击加载」 | 响应里是两个**不同**的字段：`large`（行数 > `MAX_DIFF_LINES = 5000`，内容完整，客户端默认折叠、点「加载」展开）与 `truncated`（撞 host 字节上限，尾部确实没读到，只能提示） | 把两者合成一个布尔，会让「加载」按钮承诺一段根本没读到的内容。文档说的「在响应里标记而不是在 host 里折叠」照做：host 只计数，折叠是渲染决定 |
| **D15** | FR-2.2「未跟踪文件按全新增渲染」 | worktree 侧 `git diff` 空输出时，先探 `git ls-files --error-unmatch -- <path>`：tracked 才算「无改动」；否则用 `git diff --no-index -- /dev/null <path>` 重取一次，得到全新增的 diff（它退出 1 是「有差异」的正常答案） | `git diff` 不区分「未跟踪」与「无改动」，只有前者该渲染成全新增。**代价**：未跟踪文件走 `--no-index`，不经过 `.gitattributes` 过滤器（未跟踪文件本来也没有索引态可归一） |
| **D16** | FR-2.2 未区分冲突文件的 diff | `diff --cc`（`@@@` 两列前缀）被识别为 `combined` 并整段跳过，客户端显示「合并差异暂不支持」 | 那是另一套语法，按 unified diff 硬读会凭空造行。冲突渲染本身是 FR-9，排在 M4 |
| **D17** | §5.4 未规定 `diff` 的命令形状 | 固定 `--no-color --no-ext-diff --no-textconv --unified=N`，context 夹在 0–50 | 用户自己的 diff 配置会毁掉解析：外部 driver 输出解析器读不懂的语法，textconv 会把二进制文件转成文本——正好违反 FR-2.5 |
| **D18** | §4.2 布局：分支行 → 提交框 → 变更分组 → 历史 | 基准是 VS Code 源代码管理视图，最终为：分支行 → **已暂存的更改（抽屉，常驻）** → **提交框** → **工作区列表**（冲突/更改/未跟踪）→ **底部 tab 区**（最近提交 / 所选文件的 diff）。中间经历过几版被推翻的顺序，以本行为准 | 产品方在 M3 验收后逐条调布局，最后定调「参考 VS Code」——那里没有需要发明的顺序：源代码管理视图就是 输入框 → 变更分组 → 图/历史。**唯一跟不了的一处**：VS Code 把 diff 开在编辑器区，而本插件只注册了右侧栏 tab（`sidebarRightTabs`，本 profile 的客户端包里没有主区 tab 的注册缝），所以 diff 停靠在最下、默认半屏——这也符合「点文件在提交框下方看 diff」的要求。**代价**：diff 是固定占位而不是占满 body，列表可用高度变小。**2026-09-12 由 D27 重做**：那两处「变小」不再是散落的几个数，而是 `ui/panel-layout.ts` 里的一本预算 |
| **D19** | FR-3.2 只说「分组标题行提供组级批量操作」，没规定显隐 | M2 做成了 hover 才显形（`opacity: 0` → 1）；M3 验收后改为**常显**，并把分组名改成可省略号收缩、标题行 `min-width: 0` | 产品方在界面上**找不到**「全部暂存」——hover-only 的控件在窄侧栏里等于不存在，而同一份文档的 §4.2 示意图本来就把这两个操作画成可见控件。行内 `+`/`−` 保持 hover 显形不动：FR-3.1 明文要求「hover 显现」，那是需求本身的决定 |
| **D20** | FR-4.4 要求切换分支受阻时提供「**贮藏后切换**」快捷项 | M4 **只做降级**：原样展示 git 的多行输出并说明工作区不干净，不提供一键贮藏。stash 本身是 FR-6.2，排在 M5a（§10.1 顺序 4）。**✅ 2026-09-12 已补回**：受阻路径现在长出一个「贮藏后切换到 {name}」按钮，一次点击做「`stash push -u` → 重试同一次切换」（D33/D34） | 一键贮藏会写 `git stash`（动 `refs/stash` + 工作区），是 M5a 才交付的能力；在 M4 里半做它，等于把这个里程碑唯一的破坏性写操作藏在「切换失败」的补救路径里。产品方确认：先降级 |
| **D21** | FR-9.2 每个冲突文件提供「**打开文件**（调 DSH 文件编辑器）」与「标记已解决」 | M4 **不做打开文件**；冲突行只提供「标记已解决」（即 `+`，与 git 同一命令），路径仍可从行 tooltip 读出 | 本 profile 的文件区是 `dsh-better-sidebar`，它对外的缝只有 `registerTab`/`registerFileViewer`/`registerFileIcon`，没有「按路径打开编辑器」；`dsh-client-ui-open-in-app` 打开的是工作区目录给本地应用，也不对口。产品方确认：往后排 |
| **D22** | FR-3.6 提交详情「完整信息、文件清单、每文件增删行、**可下钻看该提交的 diff**」 | M4 做前三项（行内展开），**下钻 diff 与提交改写（drop/squash/reset、FR-3.8 的撤销）不在 M4** | 下钻需要一个「按提交取 diff」的第三种 `DiffArea`（客户端与路由都要扩），而提交改写是另一类操作（重写历史）。产品方确认：提交详情具备初步功能即可，提交管理往后排 |
| **D23** | §5.2 的意图是「DSH 名字只在 adapter 里，且最好是类型」 | `host/adapter/llm.ts` 引入了 `@deepseek-ai/dsh-llm` 的**运行时值**（`BlockAssembler`、`createUserMessage`），并把它声明为 peerDependency | 手写一份流式装配会复刻 harness 的块合并规则（工具调用截断、未知块、delta-only 协议都已在那层处理过），手写 message 形状则要跟住它的不可变创建契约。用宿主自己的装配器是唯一不会随宿主漂移的选择。**代价**：host bundle 首次带一个 `@deepseek-ai/*` 的运行时 import（此前只有 Node 内建 + `vscode-diff`），安装时必须能解析到宿主提供的 `dsh-llm`——`link:` 安装由本仓 devDependencies 提供，npm 安装由 peer 自动补齐 |
| **D24** | §7 的 M5 是**一个**里程碑：discard、stash、提交图、撤销、多仓库 → 发布 v1.0 | 拆成 **M5a**（行级菜单机制 + FR-6.1 discard + FR-3.8 撤销 + FR-6.2 stash）与 **M5b**（FR-7.1 提交图 + FR-7.2 下钻 diff + FR-8 多仓库 + 提交改写 drop/squash/reset），M5b 收尾即文档 §7 的 v1.0 | M5 的实际体量大于 M4：文档 §3.1 的 5 个功能跨 P1/P2，另加 M4 明确留下的两件（下钻 diff、提交改写）。拆点选在「破坏性写操作」这一侧——**discard 与 undoCommit 正是 §7 的 M5 待办点名的两个**，它们与已交付的 deleteBranch 共用同一套武装确认（`ui/armed.ts`）与审计通道，一起做才不重复实现；提交图与多仓库是纯新增表面，不改变任何写操作的安全性。产品方 2026-09-12 确认按此拆分并先开工 M5a，工作包与排序见 §10 |
| **D25** | FR-1.4 把「mtime 监听 + 定时轮询」当作刷新机制；D4 进一步把它收成「只轮询 `.git` 状态文件」 | 抽出**独立的 git 状态探测模块** `src/host/git-probe.ts`：主策略是文件系统事件（工作区递归 + git 目录各一个 `fs.watch`），轮询降级为**回退策略**；探测只产出中性事件 `GitChange`（`refs` / `index` / `worktree`），对 transport（SSE）与 UI 一无所知，客户端一侧再由 `ui/repo-change.tsx` 的事件总线分发给各面板 | 三条实测理由：① **工作区里发生的事不动 `.git`**——agent 新建/编辑文件时 `index`、`HEAD`、`logs/HEAD` 的 mtime 全不变，只盯 `.git` 的轮询永远看不见新文件（这正是产品方报的「写文件时丢更新」）；② **只盯 `index`/`HEAD` 会漏掉空提交与远端变化**——实测 `git commit --allow-empty` 只动 `logs/HEAD`，`git fetch` 只动 `FETCH_HEAD` 与 `refs/remotes`，两者都不动 index/HEAD；③ **客户端轮询太重**——同 profile 的 `dsh-better-sidebar` 用的是可见时 2s 轮询（`client/use-polling.ts`，Git lens 2s、变更列表 2.5s），而我们的 `/status` 一次要 2–3 个 git 进程，可见期间约每小时 5400 次 spawn，大仓库上 `git status` 是 100ms–1s 级。**代价**：`fs.watch` 在同步盘/网络盘上不可靠（D4 的老问题）——所以 `pollStrategy` 完整保留为回退（建立失败自动降级；那一路在 1s 状态 tick 之外每 10s 补报一次 `worktree`，文档 FR-1.4 自己的数字） |
| **D26** | FR-6.1「**文件行**提供放弃更改按钮」（未说哪些行） | discard **只在工作区侧的行**提供：`未跟踪`（删文件）与`更改`（用索引盖回工作区）；**已暂存**行只给「取消暂存」，**冲突**行只给「标记已解决」 | 面板从 M2 起就是「一行一态」：已暂存行展示的是索引里的那份改动，在那里点「放弃更改」会把该行**没在展示**的工作区改动一起丢掉——破坏性按钮最不该制造这种意外；要丢工作区那半，同一个文件在「更改」组里有一行，那里写着它丢的是什么。冲突行的索引是未合并态（实测：`git restore` 报 `path 'x' is unmerged`），`restore` 不猜用户要哪一边，而放弃一个冲突属于 FR-9 的「中止合并」而不是某个文件的按钮。这条规则是**一个纯函数** `ui/row-actions.ts`，行内按钮与行菜单都问它，避免两处各写一份而漂移 |
| **D27** | §4.2 只规定了分区的**顺序**，没规定各分区的高度约束 | 整列的高度收成**一本预算** `ui/panel-layout.ts`：**只有更改列表是弹性的**（`flex-grow: 1; flex-shrink: 1; flex-basis: 0`——零基准意味着它的**内容高度不参与 flex 分配**），其余分区各有上下限，其中已暂存抽屉是**按内容**画的（上限 `min(40%, 320px)`，不设下限——见该行末尾的修订），dock 的拖动上限 = 其余分区下限（已暂存那块计入的是**预留** `STAGED_RESERVED_HEIGHT`）之和 `DOCK_RESERVED`，样式表里 dock 的 `max-height` 与拖动器用的是**同一个常量**。**2026-09-12 修订**（产品方实测：「staged-pane 下面的空白……收起时让 commit-box 跟他贴在一起」）：抽屉的 `min-height` 从 72px 改回 `0`，它按内容画；72 这个数**降级为「预留给它多少」**——dock 拖动时不能吃掉的空间，而不是一段必须画出来的空白 | 产品方 2026-09-12 实测后提出四条：更改区被挤（当时它的下限只有 56px，长索引或拖开的 dock 都会压它）、暂存区与提交框没有明确上下限、dock 的拖动没有边界、滚动时看不出当前是哪个分组。做成预算而不是再散着写几个 `min-height`，是因为「谁可以长、谁必须让」只能有一个答案——多写几处，下一个分区加进来时就会开始互相矛盾。**代价**：`panel-layout.ts` 用 px 而不是百分比（侧栏高度不由窗口决定），很矮的窗口里退化到「各分区停在下限、整列溢出被侧栏裁掉」——这是有意的：宁可整列溢出，也不让某个分区消失或让别人越过下限 |

| **D28** | §4.3「无变更显示**干净状态图标**」 | 干净状态不再由 body 里的一段文字表达（原实现是「没有未提交的更改」+「工作区与 HEAD 一致。」两个 `<p>`，而且本来也没有图标）：改成「更改」与「未跟踪的文件」两个分组**常驻**，用表头 + 计数 0 表达；提交框自己的 `commit.hintClean`（「没有可提交的更改。」）在提交按钮旁边说同一件事 | 产品方 2026-09-12 指出这段文字与分组表头重复（「这个能扔了吗」），要求删掉。常驻是**必需的配套**：只删文字不常驻的话，干净状态下 body 会是一片空白。**代价**：放弃了文档要求的「图标」，也少了一句「工作区与 HEAD 一致」的完整句子——现在干净状态 = 三个 0 + 提交框一句提示，§4.3 的意图（让人知道现在是干净的）仍然成立。顺带定下：空分组的批量按钮不再常显，只有 staged 抽屉保留（它有 `emptyNote` 解释那个灰按钮） |
| **D29** | §5.4 的 `undoCommit(): { mode }` 是**无参**的 | 实现为 `undoCommit(hash)`：浏览器传它以为是最新提交的那个 hash，host 现读 `rev-parse HEAD` 并**要求两者相等**，不等则拒绝 | 「仅最新一条」若无参，则面板上一条过期行（点击之后 agent 又提交了一次）会撤销掉一个没人指着的提交。hash 是「点击落在哪一行」的证据，host 的重核是「该行仍然是最新」的证据——FR-3.8 的「执行前由后端重新核实」因此同时覆盖推送状态与行本身。顺带让 `validateHash` 得到复用（D11）。返回值在 `{ mode }` 之外带 `shortOid` 与 `subject`：reset 之后该提交从历史消失，通知与审计需要点名它 |
| **D30** | FR-6.2 只说「存（可带消息）、列表、应用（pop/apply）、删除」，没规定入口、寻址与确认；D20 只说要补回「贮藏后切换」 | 四条实现决定：① **入口是分支行上的一个图标按钮**，列表沿用顺序 1 的 `ui/popover.tsx` 层（`ui/StashPicker.tsx`），因为贮藏列表是「打开—读—关掉」的东西，塞进列里会把用户正在读的变更列表推走（与 BranchPicker 同一条理由；也因此不必在 D27 的高度预算里再领一个下限）；② **条目按 commit id 寻址，不按 `stash@{n}`** —— 选择器是栈里的位置，另一个窗口再贮藏一次就让所有位置位移，host 拿 id 现读自己的 `stash list` 再解析（缺失即 `bad-request`「that stash is no longer in the list」），与 D29 同一条「不信客户端那一行」；③ **只有 drop 武装**（§4.3）——它是唯一不可逆的（条目失去唯一的 ref）；`save` 把工作区搬进栈、`apply`/`pop` 是把它搬回来，都可逆，武装只会让常用动作多一次点击；④ 应用时不区分 pop/apply 的确认轻重：冲突时 git 自己保留条目，所以 `pop` 的承诺是「应用成功才删」 | 「列表」如果没有一个容器，就只能挤进变更列或底部 dock，两者都要动 D27 的高度预算；用已有的浮层是唯一不动布局的做法。按 id 寻址的代价是 host 多一次 `stash list`（本来就要读一次来解析选择器），换来的是「点到一个过期行」时不会误删/误用另一个条目。`stash push` 在空工作区会打印 "No local changes to save" 并**退出 0**（实测），所以 `stashSave` 先读一次 `status` 自己判断「有没有可贮藏的东西」并给出 `bad-request` 句子——否则面板的通知会宣布一次没发生的贮藏 |
| **D31** | §5.5 只要求「参数形状校验」；D11 定的原则是「只实现真的有调用方的校验」 | 新增 `validateStashMessage`：缺省/`null`/纯空白一律视为「没有说明」并返回 `null`（FR-6.2 的「可带消息」本来就是可选），只有非字符串、含 NUL、超长（4096）才拒绝；`stashApply`/`stashDrop` 的 id 复用 `validateHash`（D11、D29 的同一个函数） | 复用 `validateMessage` 会把「提交信息不可以为空」这句文案用在贮藏说明上，而空说明在这里是**合法**的；写成一个独立纯函数比在 host 里就地判断更容易被穷举测试。id 复用 hash 校验则让「4–40 位小写十六进制」这条形状只有一个实现 |
| **D32** | `FAILURE_PATTERNS` 原先把 `nothing-to-commit` 排在**第二**位（M2 时它只服务 `commit`） | 把它**移到最后**一位 | 实测：`git stash apply`/`pop` 失败时会把自身的 status 块打到 **stdout**，那块文字以 "no changes added to commit" 结尾——与真正的失败原因（`CONFLICT (`、`would be overwritten by merge`）同时出现在一次失败里。排在前面时它会把这两种状态**吞掉**（顺序 4 的测试就是这么抓到的：期望 `conflict`/`dirty-worktree`，拿到 `nothing-to-commit`）。它自己的那条规则（`git commit` 没东西可提交）永远不会被别的模式先匹配到，所以放最后不损失任何识别力 |
| **D33** | FR-4.4 只说「提供 **贮藏后切换** 快捷项」，没说这一击要不要连未跟踪文件一起收 | 「贮藏后切换」走 `git stash push -u`（**含未跟踪文件**），而列表里的「贮藏当前更改…」表单里那个复选框**默认不勾**（与 git 自己的默认一致） | 两处的承诺不同：表单的承诺是「把工作区收起来」，跟着 git 的默认最不容易让用户意外；捷径的承诺是「让这次切换成立」，而 git 拒绝切换时点的名既可能是已跟踪文件（"Your local changes … would be overwritten"）也可能是未跟踪文件（"The following untracked working tree files would be overwritten"）——只收已跟踪的话，后一种情况下这一击会「按了却没解决」，看起来像坏了。代价是未跟踪文件里与本次切换无关的那些也会进栈；它们没有丢（就在同一层列表里，可以 apply 回来），而通知与审计都点名了这次贮藏 |
| **D34** | FR-4.4 的受阻路径原先只有 git 的原始输出（M4 的降级，见 D20） | host 给这种拒绝一个**自己的错误码** `dirty-worktree`（`/would be overwritten by (checkout\|merge)/`），面板据此才在失败框旁边长出「贮藏后切换到 {name}」按钮 | 「按错误码分支」是本插件一贯的做法（`not-merged` → 武装成强制删除、`non-fast-forward` → 指向同步）；用文案匹配在客户端判断会把 git 的措辞变成 API。同一个码也覆盖 `stash apply` 被工作区挡住的情况，那里不显示捷径（`op` 不是 `checkout`），但标题会说清是「git 拒绝覆盖本地改动」 |
| **D35** | 无边框文字控件只有一种样式（`.ghost`，`label-tertiary`） | 拆成两档墨色：`.ghost` 仍是**脚注**（表单里的「取消」、diff 的「折叠」、分组的批量按钮），新增 `.accent` 给**动作**——打开表单的那两条（「新建分支…」「贮藏当前更改…」）、贮藏条目的「应用 / 弹出」、受阻切换的「贮藏后切换到 X」。动作取 `--dsw-alias-link`（DSH 自己给可点击文字用的 token，皮肤可覆盖），hover 仍是全局面板同一条淡底 | 产品方验收时实测原话：「『新建分支』『贮藏当前更改』这两个可以交互的纯文字……我都不知道这两个可以点」。同一份文档已经栽过一次同类问题（D19：hover-only 的批量按钮在窄侧栏里等于不存在）——可发现性只能由**静态外观**承担，不能指望用户去试探。没有把 `.ghost` 整体提色，是因为它同时服务「取消 / 折叠」这类真的次要的控件：全提亮会让每个表单里都多出一个看起来像主按钮的控件 |
| **D36** | FR-1.2 只要求「每个文件显示状态徽标（M/A/D/R/U/?）+ 相对路径」，没规定徽标在行的哪一端 | **行内顺序改成** `[复选框][类型图标][路径][hover 按钮列][状态徽标]`：徽标落在**行的最右端**，自成一列（文件变更状态列），字母因此在一列里对齐；它原来占的前导位置改放**文件类型图标**——`core/file-kind.ts` 的 `fileKindOf`（纯函数，路径进、类型出）+ `ui/icons.tsx` 的 `FileKindGlyph`（统一的纸张轮廓 + 每种一类小记号），共 9 类：code（`{ }`）/ markup（标签）/ style（`#`）/ data（网格）/ image（地平线 + 太阳）/ doc（三行）/ shell（`>_`）/ config（滑杆）/ 普通文件（唯一的纸张轮廓）。**每个类型各画各的、不共用外框**（第一版九类都画在同一张纸上，产品方实测原话：「乍一看都一样」）。徽标补上 `title`（「已修改」「未跟踪」…），因为它离文件名远了；分组标题的右内边距 12px → 32px（= 12 + 8 + 12），用来补出这一列，好让「全部暂存」仍与行的 `+`/`−` 同列 | 产品方原话：「我想把文件行的变更状态放在最后……」，随后在验收中定稿为「放在操作的右侧。文件行的最右侧，作为文件变更状态区域」。**两处取舍**：① 状态列抢在按钮列右边，代价是分组标题必须自己补出这 20px，否则两列对不齐（`.dgp-row` / `.dgp-group-head` 的注释各记了一半）；② 图标**单色**（`label-tertiary`），只靠形状区分——DSH 的规矩是「颜色全走 token」，而 token 里没有「每种语言一个颜色」，写死色值会毁掉皮肤；想要 VS Code 那种彩色图标，得先有对应 token |
| **D37** | FR-1.2 写的徽标字母是 `M/A/D/R/U/?`（git 自己的记号） | 徽标用**状态的英文首字母**，并照 VS Code 给冲突一个字母：未跟踪 `?` → **`U`**，冲突（unmerged）→ **`!`**。字母表于是是 `M/T/A/D/R/C/U/!`（`core/git-parse.ts` 的 `BadgeLetter`），**一个字母一个状态**，徽标不再需要「读它所在的分组」才能解释；颜色与 tooltip 都直接按字母取。中间实现过一版「`U` 兼指未跟踪与冲突 + `data-state` 分开配色」，定稿为 `!` 后那一层（`ChangeState`/`badgeStateOf`/`data-state`）已删除 | 产品方先要求「『?』改成『U』。都用状态的英文首字母」，随后要求「看 vscode 是怎么处理的」。**实测本机 VS Code**（`/mnt/d/codes/Microsoft VS Code/*/resources/app/extensions/git/dist/main.js` 的 `getStatusLetter` / `getStatusText` / `getStatusColor`）：字母是 `M/T/A/D/R/C/U/!`，**未跟踪 = `U`、冲突 = `!`**；冲突 tooltip 按 7 种细分（`Conflict: Both Modified` …）；`strikeThrough` 对删除与三种「被删」冲突为真；staged 行另用 `stageModifiedResourceForeground` / `stageDeletedResourceForeground`。冲突只能取 `!`——`C` 已被 copied 占用，`M`/`U` 也已名花有主。**没有跟的两处**：① VS Code 把字母画在文件名的标签里（workbench 的 SCM 行模板是 `[icon] label · .actions · .decoration-icon`），即字母在操作按钮**左边**；产品方选择保留「状态列贴在行最右、操作在它左边」（见 D36）；② 它的重命名/复制用偏绿的 `renamedResourceForeground`，我们仍用语义蓝（DSH 的 token 里没有那套装饰色） |
| **D38** | FR-1.2 的内置 9 类图标是代码里的，没有配置面 | 图标映射改成**用户可配**：`$DSH_HOME/git-panel-icons.yml`（可用 `config.fileIconsPath` 改）里一行一个 `扩展名: SVG 文件路径`。host 侧新增 `core/icon-config.ts`（YAML 子集解析器，纯函数）+ `host/file-icons.ts`（读文件、校验、按 mtime+size 缓存、按需重读），路由新增 `GET /git-panel/fileIcons` 一次把**已读到的** SVG 全量下发；客户端 `ui/file-icons.ts` 把每个文档转成 `data:` URL，行内按扩展名命中就用 `<img>` 画、否则回落内置 glyph（`customIconFor` 一条规则） | 产品方要求「改成用户可配的映射，用 yml 配置，后缀为 key，path 为 value」。**四处有意选择**：① **独立文件而不是塞进 profile patch**（产品方选定）——路径仍可由 `Config.fileIconsPath` 覆盖，测试与特殊部署都能指；默认 `$DSH_HOME/git-panel-icons.yml`，`~/` 会展开。② **不引 YAML 依赖**，手写只认「一行一个 `ext: path`、`#` 注释、引号值」的子集：需要的是扁平字符串映射，引入解析器（并给 core 的零依赖守卫开白名单，见 D12）换来的是这个文件用不上的锚点/嵌套/多行。③ **浏览器只被下发 SVG 文本、自己转 `data:` URL 交给 `<img>`**：图片是静态上下文（脚本与外链都不执行），配置里的文件因此永远不进入面板 DOM，也就没有 `dangerouslySetInnerHTML` + 净化器这一层；一次请求带全部图标，避免「一行一条请求」。④ **读得到就替换、读不到就回落**：限制 64 KiB/个、64 个、必须含 `<svg`，每条被拒绝的路径都在 host 日志里说明原因——图标静默缺失是最难查的那种失败 |
| **D39** | §9②③ 把复制类条目列为菜单的一部分；§10.2 顺序 6 说它们是「纯客户端 clipboard」 | 五条复制条目全部落地：文件行菜单加「复制相对路径 / 复制绝对路径」（顺序 1 那张菜单，D36 的路径列不变），提交行菜单加「复制短哈希 / 复制完整哈希 / 复制提交信息」。**四处决定**：① **提交菜单现在挂在每一行上**，不再只挂最新一行——复制属于任何提交，FR-3.8 的撤销仍只由最新行提供（`canUndo` 随行下传，不再用「有没有菜单」表达「能不能撤销」）；② **「复制提交信息」复制的是 subject 首行**，因为历史列表读的就是 `%s`（`CommitInfo.subject`），提交正文不在客户端——要复制全文得让 host 多读一次 `%B`，那与顺序 6「纯客户端」的定位相悖；③ **剪贴板自己写**（`ui/clipboard.ts`：Clipboard API 优先，`execCommand` 回退，两者都没有就返回 `false`），不把 primitives 的 `writeClipboard` 包一层 adapter——依赖方向第 3 条不允许 `ui/**` 碰 DSH，而 `document`/`navigator` 本来就是 ui 直接用的浏览器能力；④ **写失败也是普通失败**：`GitErrorCode` 新增 `clipboard`，拒绝的写入在面板同一条错误通道里说一句，而不是静默或抛异常 | 产品方按 §10.2 顺序 6 下令。**两处代价**：① 提交菜单从「只有一行有」变成「每行都有」，顺序 3 的验收测试按新契约重写（旧契约「老行没有菜单」不再成立，但「老行不能撤销」仍成立，只是改由条目断言）；② `repoAbsolutePath`（`core/format.ts`）按根自己的分隔符风格拼接——`git rev-parse --show-toplevel` 在 Windows 上给 `C:/…`，若根本身就是反斜杠那就补反斜杠，粘出去的路径才与该平台的文件对话框一致 |
| **D42** | FR-5.1 的同步动作只有三个（拉取 / 推送 / 同步），文档没有 fetch | 新增第四个动作**获取所有远程**：`git fetch --all`，挂在分支行、紧挨「拉取」左边，字形是**虚线 ↓**；`POST /git-panel/fetch`；仓库没有远程时以 `bad-request` 说明而不是静默成功。**不做 `--prune`** | 产品方要求在面板里能 fetch，并指定「第四个小按钮、虚线 ↓」「fetch 所有远程」——参考 IDEA 的 Fetch All Remotes。三处决定：① **`--all` 而不是默认远程**：分支行只描述一条分支，但 ↑↓ 计数、○/● 标记与 `upstreamGone` 都读 `refs/remotes`，而一个仓库可以配多个远程；② **不 prune**：prune 会删掉远端已不存在的远程跟踪 ref，那不是「按一下获取」隐含同意的动作——留一条过期的 `origin/xxx` 比删一个 ref 意外更小，真要清理是另一条命令；③ **无远程先问一次 `git remote`**：`git fetch --all` 在没有远程时**退出 0 且一个字节都不打印**（实测），不问就会宣布一次没发生的获取。**代价**：远程分支的名字仍然不进分支选择器（FR-4.1 只要求本地分支）——fetch 看得见的效果是 ↑↓ 计数、○/● 标记与 `upstreamGone`；要「取回一个远程分支」得像 git 一样先 `checkout -b`（本插件今天没有这条路径，见 §12） |
| **D41** | FR-7.1「历史列表旁内嵌 SVG 泳道图（分叉开新道、合并收道），分页不断线」 | 泳道分配是 core 的纯函数 `core/commit-graph.ts`（`buildGraph`：一行给出 `lane`/`from`/`to`/`edges`/`lanes`），渲染是每行一个内联 SVG（`ui/History.tsx` 的 `GraphCell`），**没有新增 host 路由**——`CommitInfo.parents` 从 M1 起就在 `LOG_FORMAT` 里，本项是纯客户端 + core。三处决定：① **每行一个 SVG、y 用百分比**（`0%`→`50%`→`100%`）、不设 viewBox：行高由文字决定，百分比让线段在不知道高度的情况下连到相邻行，`align-self: stretch` + `display: block` 保证不留缝；② **分页不断线是「对全部已加载提交跑一次」的结果**，不是补丁——分配是从新到旧的一趟、每行只依赖它上面的行，所以第 2 页只是把图**延长**，第 1 页逐字节不变（测试钉住）；③ **条带宽度 = 所有行的最大泳道数**（上限 8），每行共用同一个数——否则某一行开了新道就会把自己那行的 hash 推右，整列 hash 对不齐 | 文档只要求「分叉开新道、合并收道、分页不断线」，没规定颜色、也没规定图在行内还是行外。**颜色的代价**：DSH 的 token 集里**没有图表调色板**，泳道只能借语义色（brand / business / success / warn / gray 按车道取模循环，刻意避开 error 红——一条红线会读成对提交的警告）；车道号只要线还在就不变，所以一条线的颜色跨行稳定，被回收的车道可能与前一条同色。**另外两条实现选择**：① 颜色按**目标**车道取——合并的斜线用它汇入/开出的那道色，与下方竖线一致；② 上限 8 是防「多父 octopus 合并」把提交信息挤出面板，超出部分被裁掉（真实历史远在 8 以下） |
| **D40** | §4.3「操作级错误**就地**显示、不清空列表、保留 git 多行输出」；M2 起实现为列内的两条带——成功一行、失败一块，都占列表上方的整行 | 成功与失败的反馈都改成**悬浮通知**（`ui/notice.tsx`），挂在状态栏之下、盖在列表之上，不再占列内的行。「不清空列表」与「保留多行输出」照旧；**成功 4s 自动关闭（`NOTICE_DURATION_MS`），失败一直等到按 ×** | 产品方要求「把通知作为悬浮的一层，过指定时间自动关闭」，并确认成功与失败都浮起。**三条理由**：① 每一条反馈原本都把变更列表、提交框、dock 往下推，而列表才是面板的主语——一次操作的报告不该移动用户正要点的东西；② 两种生命周期的差别是硬的：成功是一句可以错过的话，失败是「这一击为什么没生效」的解释，还带着 git 的多行原文与（切换受阻时）一个「贮藏后切换到 X」按钮，按时间抹掉它比不显示更糟，所以 `durationMs` 是调用方给的值；③ 它是**层**不是模态：不拦点击、点别处也不消失（`popover` 的 outside-press 契约对通知是错的），只有 ×（或成功的时钟）能关掉它。**代价**：反馈不再把内容顶开，于是会暂时盖住列表最上面几行与合并状态栏；`z-index: 4` 让它压在行菜单（3）之上。**时长可配**：目前是组件的一个 prop、面板传 4s；「在设置里自定义」需要 DSH 的插件配置面（`settings.section` 槽 + host settings 命名空间与读写路由，像 better-sidebar 的「Side card」），已登记到 §10.3，等真有功能需要设置时一起做 |


---

## 6. 承重设计（改这块前先读）

1. **`GIT_OPTIONAL_LOCKS` 读为 `0`、写为 `1`。**
   实测：`=0` 时 `git status` 不改写 `.git/index`；`=1` 时会改写。而变更监听器
   正在轮询该文件——一次会写它的读取会让面板无限自我刷新。
   `run(args, cwd, optionalLocks = false)`：**所有读走默认值，所有写显式传 `true`**
   （M2 的 7 个写操作全部如此），否则写操作拿不到 index 锁。守住这条性质的测试：
   「the change stream」→ `does NOT fire from the panel reading status`。

2. **探测模块先「活着」，再宣布 ready。**
   第一版在定时器首跳时才建立基线，于是「订阅后、首跳前」发生的改动会被当成基线
   吞掉。现在 `GitProbe.watch()` 返回 Promise，其 resolve 即「从现在起一定能看见」
   的语义保证（`fs.watch` 建立完成，或轮询基线落定），SSE 的 `ready` 在 await 之后
   才发出。改这块时不要把它变回「先 ready 再启动探测」。另一侧的窗口由客户端关：
   `ready` 也当成一次「可能变了」（见 `git-client.ts`），否则「面板首次读到探测建立」
   之间那一瞬的改动没人报。

3. **未出生分支的 unstage 是另一条命令。**
   `git restore --staged` 是从 HEAD 恢复，而空仓库没有 HEAD（实测：
   `fatal: could not resolve HEAD`）。`unstage` 先探一次 `rev-parse --verify --quiet
   HEAD`，没有 HEAD 时改用 `git rm --cached -r --quiet`。删掉这个分支会让「第一次
   提交前取消暂存」直接报错。**同一个陷阱在 discard 上只差一个 flag**：
   `git restore --source=HEAD -- <path>` 同样报 `could not resolve HEAD`（实测），
   而 discard 要的本来就是「用索引里的版本盖回工作区」，默认源就是索引，所以
   `git restore -- <path>` 在未出生分支上照常工作（有测试钉住）。

4. **`optionalLocks` 的默认值写在 `run` 的形参上，不写在 `options` 里。**
   调用点必须**显式**说「我要写」，读代码的人才能一眼看出哪些调用会动 index。

5. **破坏性操作一律走 `ui/armed.ts` 的同一套武装。** 删分支与中止合并共用一个
   `useArmedKey`：按 key 武装、3 秒过期、武装态**在界面上是可见的另一种按钮**。
   本文件说的「点击武装 → 3s 内再点」（§4.3）只有这三条性质同时成立才算实现；
   「未合并再点一次强制删除」是同一机制的第二种武装变体（`force` 标志）。

6. **`llm` / `agentDefaultModel` 必须用 `ctx.get()` 读，不要写进 `inject`。**
   写进去会让插件在没有模型的 composition 里直接不挂载——而面板 99% 的功能
   与模型无关。`generateText` 在缺服务时返回 `no-llm`，是一个普通失败。

7. **`RepoStatus.merging` 来自 `MERGE_HEAD` 的 `stat`，不是来自冲突分组。**
   冲突全部 staged 之后分组就空了，而合并还在——那正是「继续合并」按钮该出现的
   状态。改这块时不要把它换成「`groups.conflicted.length > 0`」。

8. **`execFile` 的退出码在 `error.code`，不在 `error.status`。**
   实测（Node 24）：`git diff --no-index` 退出 1 时 `error.code === 1`、`error.status
   === undefined`。旧映射只读 `status`，于是**所有非零退出码都变成 `code: null`**——
   而 `null` 同时是「被信号杀掉」的意思，调用方再也分不清 git 的正常回答与崩溃。
   M3 的未跟踪文件渲染正好要靠「退出 1 = 有差异」与真失败区分（D15），于是在
   `git-exec.ts` 里两个字段都读（`code` 为字符串的两种情况——ENOENT、缓冲溢出——
   都在上面处理掉了）。凡是要靠退出码区分失败种类的调用，先确认这个映射还在。

9. **刷新是「探测 → 事件 → 订阅」，中间没有谁认识谁（D25）。**
   `host/git-probe.ts` 只认路径与 git 自己的状态文件，产出 `GitChange`（`refs` /
   `index` / `worktree`）；`adapter/routes.ts` 只把它塞进 SSE；客户端 `ui/repo-change.tsx`
   是面板内唯一的总线，各面板自己订阅、自己决定重读什么（历史订 `refs`、diff 订全部）。
   **不要**为了省事把 `generation` 之类的计数器再顺着 props 往下传，也不要在探测里
   加 session/HTTP/UI 的概念——那正是这个模块存在的理由。两条附带性质：探测按 burst
   窗口合并（一次 `npm install` 不等于几千条事件），面板在**重读结果与上次指纹相同**
   时不发布（`core/status-signature.ts`），所以「有事件」不等于「要重渲染」。
   另一个容易忽略的点：**只盯 `index`/`HEAD` 是不够的**——空提交只动 `logs/HEAD`，
   fetch/push 只动 `FETCH_HEAD` 与 `refs/remotes`，工作区里发生的事什么都不动。

10. **分区高度是一本预算，不是一个 flex 巧合（D27）。**
    面板的列是五个分区：状态栏 / 已暂存抽屉 / 提交框 / 更改列表 / 底部 dock。**只有更改
    列表是弹性的**（`flex-grow: 1; flex-shrink: 1; flex-basis: 0`），其余分区在
    `ui/panel-layout.ts` 里各有上下限；dock 的拖动上限是
    `DOCK_RESERVED = 其余分区下限之和`（已暂存那块是它的**预留**高度，不是它的 CSS 下限：
    抽屉按内容画，收起或空的时候只有表头高，好让提交框贴着它），样式表里 dock 的
    `max-height` 用的是**同一个数**（常量插值进模板字符串，所以两半不会各写一份）。
    三件容易被改坏的事：
    ① **更改列表的 `flex-basis` 必须是 0**——用默认的 `auto` 时，列表的**内容高度**会成为
    它的基准尺寸，几千个文件会让整列超载，flexbox 于是按比例去压每一个可压缩分区
    （已暂存抽屉与 dock 一起被压），这正是产品方报的「更改区把别的区挤没了」；
    ② **dock 记忆的高度也要夹**（内联 `maxHeight` 用同一个 `calc(100% - DOCK_RESERVED)`），
    否则在更高的窗口里拖出来的高度，会在更矮的窗口里把上面的分区挤破下限；
    ③ **极限情况下的顺序是「各分区停在下限、整列溢出」**，不会有谁越界——所以任何新增
    分区都要在这里领一个下限，否则它就成了那个偷偷吃掉别人的区。

11. **失败模式的匹配顺序是一张优先级表，`nothing-to-commit` 必须留在最后。**
    `FAILURE_PATTERNS`（`host/git-service.ts`）按数组顺序取第一个匹配到的模式，而 git 会把
    一次失败拆到两个流上：`stash apply`/`pop` 失败时它打的 status 块（在 **stdout**）以
    "no changes added to commit" 结尾，真正的拒绝原因（`CONFLICT (`、
    `would be overwritten by merge`）同时在输出里。把这个宽泛的模式排到前面，就会把
    「冲突」和「工作区被挡」都判成「没东西可提交」（D32 记了这次的实测）。新增模式时先问
    它是否可能和别的模式同时命中。

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
- **配置里的图标**（D38）：浏览器拿到的 SVG 只来自它**没有**参与指定的地方——图标路径在 host 自己的配置文件里，客户端只带 session id；下发前校验「像 SVG / ≤64 KiB / ≤64 个」，并且只以 `data:` URL 交给 `<img>`（图片是静态上下文，脚本与外链都不执行），配置里的文件因此不进入面板 DOM。
- **复制类条目只写本机剪贴板**（顺序 6）：路径、哈希、提交首行由客户端直接写系统剪贴板，**不经过 host、不出网络**；写失败（非安全上下文、权限被拒、jsdom）在面板里说一句。它是用户主动的一次数据外带，且带的是面板屏幕上已经显示的东西。
- **审计日志**：每个写操作记一行（`stage`/`unstage` 记路径数，`commit` 记
  short oid 与 subject，`push`/`pull` 记分支与仓库根，`stash push`/`apply`/`pop`/`drop`
  记选择器、id 与仓库根——drop 还记 subject，因为条目随后就从列表里消失了）。
- **M5a 待办**：discard / deleteBranch / undoCommit 这几个**破坏性**操作落地时，
  需要各自的「点击武装→3s 内再点」确认（§4.3）与更明确的审计（删了哪个分支、
  丢弃了哪些路径）。deleteBranch 已在 M4 交付（`not-merged` → 同一行武装成强制删除），
  **discard 已在 M5a 顺序 2 交付**（行内按钮与菜单条目各自武装，审计逐条记路径，
  `auditPaths` 只保留前 20 条 + 计数），**undoCommit 已在 M5a 顺序 3 交付**（历史行
  菜单武装确认；host 执行前重核 HEAD 与推送状态；审计记 hash、仓库、reset/revert
  与 subject），**stash 已在 M5a 顺序 4 交付**——四个动作里只有 `drop` 是不可逆的
  （条目失去唯一的 ref），所以只有它武装（§4.3），其余三个是常用动作、按一次就执行；
  save/apply/pop/drop 各自按 id 重核，`apply`（保留条目）与 `pop`（应用成功才删）
  是两个动作。**M5a 的四个顺序至此全部落地**（§10.1），剩 M5a 的产品方验收。
  若将来要支持 LAN 访问，
  再补「可信 authority / 配对设备 cookie」的逃生口。

---

## 8. M3 交付

文档 §7 对 M3 的验收是「点文件可见 VS Code 级 diff」。M2 留下的两个钩子果然够用：
变更行是 `div`（不是按钮），`ChangeRow` 已按分组拿到 `area`，所以点一行即可决定
「HEAD↔工作区」还是「HEAD↔索引」（FR-2.2）。三块交付，每一块都有测试守着。

**core**
- `core/diff-engine/marks.ts` — 逐词标记：`wordMarks()` 给两段文本，`markHunk()` 给一个 hunk。
  引擎来源见 D12；这一层做三件引擎不管的事：把 1-based 的「行,列」区间翻成 0-based 的
  `DiffSpan` 偏移、合并相邻/重叠区间、丢掉「整行都变了」的区间（整行变色由行的样式承担，
  再叠一层高亮只会让高亮的颜色失去信息量）。
- `core/diff-parse.ts` — `git diff` 统一格式 → `DiffHunk[]`（见 D13）。容忍二进制、
  `diff --cc`（D16）、rename/mode 段落、`\ No newline at end of file`、以及被字节上限
  截断的半截 hunk。`MAX_DIFF_LINES = 5000` 在这里，`large` 由它算（D14）。
- 测试 `test/diff-parse.test.ts`（15 项）：两个 hunk 的行号与 counts、逐词区间（断言的是
  **被标记的文本**而不是偏移）、整行替换无标记、新文件全新增、二进制、combined、
  截断透传、5001 行的折叠门。

**host**
- `git-service.ts` → `diff(sessionId, path, area, contextLines)`：`index` 用 `git diff --cached`，
  `worktree` 用 `git diff`，未跟踪用 `--no-index /dev/null`（D15），命令形状固定（D17）。
- `routes.ts` → `GET /git-panel/diff?session&path&area&context`（读操作集合；缺 `path`
  或 `area` 不在 {`worktree`,`index`} 时，请求本身仍是**一次操作**，所以按 D10 走
  200 + `ok:false` 信封——不是 400。M4 给 `showCommit` 缺 `hash` 用了同一条规则，
  并有一条测试钉住它）。
- 测试 `test/host-service.test.ts`（+9 项）：真实仓库跑 worktree / index / 未跟踪 / unborn /
  二进制 / 无改动 / 非法路径与 area 拒绝 / context 夹取，外加路由的 200 信封、两个 400 信封与 405。

**client**
- `ui/DiffView.tsx` — `DiffView`（纯渲染：inline 与 side-by-side、逐词高亮、二进制/合并/空态、
  `large` 折叠 +「加载」、`truncated` 提示）、`DiffPane`（取数、布局记忆、按仓库变化重取、Esc 关闭）
  `BottomPane`（把 `DiffPane` 与 `HistoryPanel` 收进同一块底部区域、以两个 tab 切换，带折叠按钮与可拖高度）。
  默认高度刻意留在 CSS 里而不是挂载时量一次像素：窗口一变，「半屏」还是半屏。一次渲染、一次切片，
  没有 O(n²) 比较（§6）。
- `ui/StatusPanel.tsx` — 布局按 D18（照 VS Code）：提交框在上、变更列表居中、底部是 tab 区（最近提交 / diff）；
  打开 diff 不再顶掉列表。变更行可点（`role="button"` + Enter/Space），行内 `+`/`−` 那一层
  `stopPropagation`（键盘侧另有 `target === currentTarget` 守卫，否则 Space 会既暂存又开 diff）；
  `staged`→`index`、其余→`worktree`（FR-2.2）。刷新后文件已不在任何分组里就把 dock 收回。
- `ui/error-copy.ts` — 把 `errorCopy` 从 `StatusPanel` 抽出，避免 DiffView ↔ StatusPanel 互相 import。
- `ui/ChangeGroup.tsx` — 一个变更分组本身（表头/折叠/计数/批量按钮 + 变更行），行与分组是两种容器共用的
  （常驻抽屉、以及冲突那种普通分组），放在一处才不会各自漂移。
- `ui/ChangeGroupPane.tsx` — 常驻抽屉：`PaneResizer` + 自己的滚动体 + `Group`，已暂存/更改/未跟踪三个分组
  共用同一个形状（各自拖动、各自滚动、各自 40% 上限）。
- `ui/pane-resizer.tsx` — 可拖动分区高度的通用抓手（每个常驻抽屉一个、底部区域一个）。
- `ui/History.tsx` — 提交列表（提交行 + 分页加载），从 `StatusPanel` 抽出，成为底部区域的第一个 tab 内容。
- `ui/StatusPanel.tsx` 的分组批量按钮改为**常显**（见 D19），分组名在窄侧栏里先省略号收缩，
  保证按钮永远不被挤出可视区。
- 文案 zh/en 各 +16 键；样式新增 32 个类名，颜色全走 token（加法/删除底色用 `color-mix`）。
- 测试 `test/client-panel.test.ts`（+12 项）：点行开 diff、点 `+` 只暂存不误开、折叠与展开、
  二进制占位、布局写进 localStorage 并在重新挂载后生效、**提交框/列表/最近提交/dock 的 DOM 顺序**、
  dock 默认无内联高度（即走 CSS 的 `50vh`）与拖动后的夹取、**分组批量按钮静止时可见**
  （读安装好的样式表算出的 `opacity`，退回到 hover 显形就会失败）、**分组折叠与记忆**
  （折叠后行消失但计数保留，重新挂载仍折叠，localStorage 里写的是组名）。

**M3 之后的界面调整（产品方在 M3 验收后逐条提出）**

| 调整 | 落点 |
|---|---|
| **已暂存的更改上移到提交框上方**（有意偏离 VS Code 的「输入框在最上」）：暂存区就是提交框的操作对象，紧贴它读起来是「这些文件 → 这条信息 → 提交」；代价是暂存/取消暂存时行会跨过提交框跳一次（与 VS Code 两个分组之间的跳动同源），以及清除「提交框永远在顶端」这条。同时它做成**常驻抽屉**：没有暂存内容也在那里、计数为 0、展开显示「无暂存更改」，并有自己的高度拖动条（按「每个分区都能自己拖」） | `StatusPanel` 的 `.dgp-staged-drawer` + `staged.resize` |
| diff 从「叠在下面的一层」改为**底部区域的第二个 tab**：底部区域 = `[最近提交][diff]` 两个 tab + 折叠按钮 + 可拖高度；点变更行自动切到 diff tab 并展开，关掉 diff 则折回只留 tab 条；两个 tab 的内容常驻（切回不丢已加载的提交与滚动位置，也不多发一次 `git log`） | `ui/BottomPane.tsx` + `ui/History.tsx` |
| 顺序改为**照 VS Code 的源代码管理视图**：提交框在最上 → 变更分组 → 最近提交在下 → diff dock（VS Code 把 diff 开在编辑器里，本插件只有右侧栏 tab 注册能力，故改为停靠底部）；最近提交展开时自身滚动（`max-height: 40%`），不再把列表和提交框顶走 | `.dgp-history` + `StatusPanel` 渲染顺序 |
| 说明：中途按「列表在提交框上方」「提交框居中」各改过一版，最终都被这一条取代——**布局以 VS Code 为准**，不自创顺序 | D18 |
| 分组批量按钮**常显**，分组名先省略号收缩，按钮不再被挤出可视区 | D19 |
| 行内 `+`/`−` 加大：30×30 的按钮 + 16px 图标（原来是 26×26 / 13px，在密集列表里像个点） | `.dgp-row-actions .dgp-tool` |
| **每个分组可折叠**并记住折叠状态（`dsh-git-panel/collapsed-groups`）：折叠后行消失、计数保留；折叠是偏好，故写进 localStorage | `Group` 的 `aria-expanded` 开关 + `ui/group-collapse.ts` |
| 顺手修：历史区的展开箭头**从来没转过**——`data-open` 传给了图标组件，而图标只转发 `size`/`className`，属性丢在半路。现在两个箭头都按父按钮的 `aria-expanded` 旋转 | `styles.ts` 的 `historyCaret` / `groupCaret` |
| 滚动条不再压住行内 `+`/`−` 与分组批量按钮：面板内的滚动容器改成**占据列宽**的滚动条（Chromium 走 `::-webkit-scrollbar`，Firefox 走 `scrollbar-width: thin`），列表容器再留 10px 右内边距兜底 overlay 引擎——overlay 滚动条正好在滚动容器右缘浮起，而那里原本就是按钮的位置（滚动条出现 = 列表变长 = 按钮被盖住），这条是运行中实测后报来的 | `.dgp-body` 的 `padding-right` + `styles.ts` 的 scrollbar 区块 |
| **分区高度可拖**（⚠ **2026-09-12 收窄**：只剩 dock 一条，见本表末行）**：抽出通用 `PaneResizer`（`role="separator"` + 顶部 7px 拖动条），底部区域（tab 条 + 内容）整体可拖，变更列表作为剩余空间随之伸缩；默认高度按 tab 分：diff 固定 `50vh`，提交列表按内容高、上限 `40vh`（五条提交不该占半屏）；提交框 textarea 的可拖上限从 160px 提到 260px | `ui/pane-resizer.tsx` + `.dgp-bottom` |
| **「更改」「未跟踪」与「已暂存」同构**（⚠ **2026-09-12 作废**：抓手只留 dock 一条，见本表末行）**：抽出一个可复用的 `ChangeGroupPane`（`PaneResizer` + 自有滚动体 + `Group`），三个常驻分组各挂一个，各自拖动、各自滚动、默认高度都是自己内容的 40% 上限——「每个分区的高度要能自己拖」此前只有已暂存区满足；「已暂存」仍是唯一常驻（空态 + 计数 0）的抽屉，工作区两个分组没内容就不占位。冲突分组保持普通分组：它随合并来去，不值得为它长期让出高度（VS Code 也把冲突放在变更列表最上）。行/分组组件从 `StatusPanel` 移到 `ui/ChangeGroup.tsx`，面板从 884 行降到 662 行 | `ui/ChangeGroupPane.tsx` + `ui/ChangeGroup.tsx` + `.dgp-change-drawer`（原 `.dgp-staged-drawer`）；文案 `unstaged.resize` / `untracked.resize` |
| 顺手补测试：拖动条此前只测「按下并移动」，从不派发 `pointerup`——而抓手监听的是 `window`（指针移出 7px 条带也要继续拖），于是**没释放的抓手会继续改后面所有拖动的高度**。现在测试用 `dragGrip()`（按下 → 移动 → 抬起），并断言「抬起后再移指针不再改高度」「拖一个分区不动另一个」 | `test/client-panel.test.ts` 的 `dragGrip()` |
| **修：空索引上点「全部取消暂存」报错**（用户实测报来）。已暂存抽屉是唯一常驻的分组，计数 0 时批量按钮照样在，点了就发 `paths: []`——host 按契约拒掉（`validatePaths`：至少一个路径），面板把这条渲染成「请求不完整，请重新打开这个面板」，可面板本身没毛病，这句提示帮不上任何忙。三层修：① 分组批量按钮在**没有行时禁用**（仍常显、不回到 hover-only，`title` 用该分组自己的空态文案补完一句话，如「全部取消暂存 · 无暂存更改」）；② 客户端的 `stage`/`unstage` 对空数组直接 no-op，不发请求（host 侧契约不动：空列表就该被拒）；③ `perform` 把「git 客户端抛异常」也变成一次普通失败——此前 `await operation()` 抛出会让操作永远停在 `running`（转圈 + 按钮永久禁用，且不报错） | `ChangeGroup` 的批量按钮 + `StatusPanel` 的 `stage`/`unstage` 与 `perform`；样式 `.dgp-ghost:disabled` |
| 边界测试补齐：客户端「空分组不发请求 / 禁用按钮带解释 / 同组有行时照常工作」；`perform` 对抛异常客户端的失败呈现（原因保留、不误报成功）；host 侧 wire 级「`paths: []` 返回 `bad-request`、`paths` 不是字符串数组同样被拒、且仓库状态未被 no-op 改动」，并据此钉住本适配器的**状态码约定**：*操作*失败走 200 + `ok:false` 信封，只有「请求根本没成为一次操作」（缺 session、body 读不出、body 不是对象）才 4xx | `test/client-panel.test.ts` + `test/host-mount.test.ts` |
| **修：行内 `+`/`−` 太靠边、被挡**（用户实测报来）。原因是几何而非配色：`.dgp-row` 同时有 `width: 100%` 和左右内边距（12px + 8px），而全表没有全局 `box-sizing: border-box`（只有 `.dgp-head` 与提交框 textarea 各自声明过），于是行的边框盒比裁剪它的抽屉还宽 20px，贴在行右内边距上的 30px 按钮正好落进被裁掉的那条。改：行声明 `box-sizing: border-box`；行与分组表头的右内边距统一到 12px（两者本来就该是同一列控件，且行右缘就是按钮，行的内边距决定它看着是否贴墙）；再把「按钮离边缘的余量」放到真正拥有行的滚动容器上——`.dgp-change-body` 加 10px 右内边距（`.dgp-body` 那份原样保留，它是为 body 自己的兜底滚动条留的）。现在按钮右边到抽屉边缘：行内 12px + 滚动容器 10px = 22px（滚动条出现时，它自己那一列再占 10px） | `.dgp-row` 的 `box-sizing`/右内边距 + `.dgp-group-head` 的右内边距 + `.dgp-change-body` 的 `padding-right`；回归测试读 `getComputedStyle` 断言这几项 |
| **抓手只留一条：分组不再各自拖高**（产品方实测报来：「更改的下面为什么有两个拉动条。能不能不用这个拉动条的方式」）。原因是**几何**：每个可拖分区都在自己的**自由边**上带一条 7px 透明抓手，而「未跟踪」为空时不占位，于是「更改」的底边抓手与 dock 的顶边抓手正好上下贴在一起，再加 dock 自己的 `border-top`，读起来就是「两条杠 + 一根线」。产品方随后定调：**不要分组的手动高度，只保留底部「最近提交 / diff」那一条**。现在冲突/更改/未跟踪三个分组**流入同一个滚动体**（`.dgp-body` 本来就是滚动容器），已暂存列表是唯一画在提交框上方的分组、有 40% 上限但不带抓手 | `styles.ts`：删 `changeDrawer`/`changeBody` 及它们的相邻边框规则，新增 `stagedPane`（40% 上限 + 自己滚动），`.dgp-body > .dgp-group + .dgp-group` 的组间细线保留；`StatusPanel` 的三处 `ChangeGroupPane` 改成 `Group`（staged 外包一层 `stagedPane`），`ChangeGroupPane.tsx` 整个删除；`pane-resizer.tsx` 去掉 `edge` 参数与「向下拖」的分支（只剩顶边一种语义，留一个永远取同一值的选项等于留一份没人用的抽象），模块文档改成「面板为什么只有一个可拖分区」；`locales.ts` 删掉三个 `*.resize` 键。测试改成**反转后的契约**：全panel只有一个抓手且属于 dock、三个分组是 `.dgp-body` 的直接子元素、staged 是 40% 上限的滚动体。**代价**：放弃「每个分组各自拖高」（更早那两行调整因此作废，已就地标注）——换来相邻双抓手消失、滚动条从 4 个降到 1 个，形态与同 profile 的 better-sidebar「变更」视图一致 |
| **修：提交的相对时间显示成「1 分钟后」**（产品方在验证刷新链路时实测报来：「刚刚那个提交显示的时间是一分钟后」）。两个原因叠在一起：① `HistoryPanel` 的 `now` 是**挂载时取一次**（`useState(() => Date.now())`），于是面板打开之后产生的提交比这个基准还新，`Intl.RelativeTimeFormat` 便输出未来时态——面板开得越久偏得越多，那一例恰好开了约 1 分钟，于是显示 `in 1 minute`；② 同一个冻结的基准让**所有**行的年龄永远停在挂载那一刻，「2 分钟前」会一直是「2 分钟前」 | 两处修。`core/format.ts` 的 `relativeTimeParts` 把未来时间**钳到 0**：提交不可能来自未来，而 0 经 `numeric:'auto'` 本地化成「现在 / now」，是唯一不说谎的说法。`ui/History.tsx` 的 `now` 改成会走的钟——**激活时重置 + 每 30s 走一格**（`CLOCK_TICK_MS`），每次列表读取后再同步一次，于是刚读到的提交立刻显示「现在」。它是**标签**不是读取，不花任何 git 调用。测试：`format.test.ts` 一条（未来时间 → 0）、`client-panel.test.ts` 两条（未来时间的提交必须渲染成 now 且绝不出现 `in N`；「30 seconds ago」走 60s 后变「1 minute ago」，由 `node:test` 的 mock timers 驱动 `Date` 与 `setInterval`）。**顺带修测试基建**：jsdom 里渲染的面板从不卸载，新加的钟让测试进程永远退不出（挂着的 `setInterval` 撑住事件循环）——现在 `render()` 记录 root、`afterEach` 统一卸载并清空 body |
| **分支下拉改成独立浮层**（产品方要求：「改成独立的下拉，不要用现在的点击 → 在暂存区上方增加一个分支操作区」）。原来 `pickerOpen` 把 `BranchPicker` 插在 rail 与已暂存抽屉**之间**，于是打开分支列表会把暂存抽屉、提交框、变更分组一起往下推——指针正要点的文件行会跑掉。现在抽出可复用的 `ui/popover.tsx`（M5a 的行级菜单要用的同一个件，见 §10.1）：`position: absolute` 挂在 rail 之下，**top 与高度上限都是从 rail 和面板量出来的**（所以列表再长也在面板内自己滚，不会跑出侧栏，也不受祖先 `overflow`/`transform` 摆布）；`z-index: 3` 盖住分组表头（1）与底部 tab 条（2）；阴影用主题自己的 `--dsw-alias-bg-mask-2`，不是写死的黑。关闭归**层**管：点外部（`pointerdown` 捕获相）关、Esc 关，而触发按钮不算外部——它自己管开关，否则第二次点击会「关掉又打开」。**绝对定位而非 fixed/portal**：面板自己的盒子就是边界，且 Tab 顺序保持「rail → 它打开的东西」 | 新模块 `ui/popover.tsx`（`Popover`：度量 + 两种关闭 + `role="dialog"`）；`BranchPicker` 去掉自己的 Esc 监听，只负责层内容；`StatusPanel` 用 `railRef` + `useId()` 接上 `aria-haspopup="dialog"` 与 `aria-controls`；`styles.ts` 的 `.dgp-root` 加 `position: relative`、新增 `.dgp-popover`、`.dgp-branch-picker` 让出 border/background/max-height/overflow。测试 3 项：层是 `absolute` 且打开只在根下多一个元素（列的 DOM 顺序不变）、量出的 `top: 42px` / `maxHeight: 554px`（把 38px 的 rail 与 600px 的面板喂成假矩形，jsdom 没有布局）、点外部关而点层内与触发按钮都不关 |
| **修：展开/收起已暂存分组会压缩底部 tab 区**（产品方实测报来）。`.dgp-bottom` 原本是 `flex: 0 1 auto`——**可收缩**：展开暂存列表使它内容增高、列总高超界时，flexbox 按基准尺寸比例向所有可收缩项征税，dock 与变更列表一起被压（变更列表早已在 140px 下限上无处可让时，dock 独自挨刀）；收起时 dock 又弹回。现在 dock 是 `flex-shrink: 0`（写成三条长写而非简写：jsdom 不展开 `flex` 简写，简写会让布局契约测试断言不到任何东西——与 `.dgp-body` 同一条理由）：dock 的高度只由**拖动、内容、预算夹**（`max-height: calc(100% - DOCK_RESERVED)`）决定，兄弟长高不动它。暂存抽屉自己的增高改由它自己吸收——它是 `0 1 auto` 且自带滚动体，内容超出时就缩进自己的份额里滚 | `styles.ts` 的 `.dgp-bottom`（`flex: 0 1 auto` → 三条长写的 `0 0 auto` + 注释记下原因）；`client-panel.test.ts` 布局契约测试补一条 `flexShrink === '0'` 断言（"squeezed the tab area" 这个 bug 正是 jsdom 断言不到简写才漏进来的） |
| **更改/未跟踪分组补上空态文案**（产品方要求：「更改和未跟踪的文件也和暂存的更改一样，如果没有文件也展示一个文案」）。原先刻意只给已暂存抽屉空态句、工作区两组只留计数 0——现在三个常驻分组同构：空时各说一句（无更改 / 无未跟踪文件），批量按钮也随之**常显但禁用**，tooltip 借空态句补完一句话（「全部暂存 · 无更改」），与已暂存抽屉的既有行为一致。冲突组仍无：它不常驻，合并开着时空不空不是问题 | `StatusPanel` 给 unstaged/untracked 两个 `<Group>` 传 `emptyNote`；`locales.ts` +2 键（`group.unstagedEmpty`/`group.untrackedEmpty`，中英）；`styles.ts` 的 `.dgp-group-empty` 缩进从 32px 收到 54px——行首多了 14px 复选框 + 8px 间距，空态句要仍对齐在行的路径文字列（多选交付时漏改的连带项）；测试两处改断言（全干净时三句都在；空组的禁用按钮带「Stage all · No changes」tooltip） |

---

**重启后的运行实例核对（2026-09-12，已做）**

重启后 host 路由立刻换成新构建（`GET /git-panel/diff` 由 404 变 400「the session is
required」）。用一个**真的在跑**的 session（`cwd` = 本仓库）打四条路径：

| 请求 | 结果 |
|---|---|
| `path=README.md&area=worktree&context=2` | 8 hunks、`+31 −9`；改行带逐词区间（` + M3`、`, and the`、`diff view`），行号两侧成对 |
| `path=src/core/diff-engine/marks.ts&area=worktree`（未跟踪） | 1 hunk、`+236 −0`，全新增（D15 的 `--no-index` 路径） |
| 临时文件 `git add` 后 `area=index` / 同一文件 `area=worktree` | 前者 `+3 −0`（HEAD↔索引），后者 0 hunk——FR-2.2 的两侧确实是两个对比 |
| 二进制临时文件 `area=worktree` | `binary: true`、0 hunk（FR-2.5） |

临时文件用完即删，索引恢复原状。**没验的是浏览器里的观感**（内嵌 diff 的排版、
左右对照的对齐、拖动条的手感）——本会话的 `browser_*` 工具一律返回 “no usable
browser provider is registered”，所以这部分只有 jsdom 的行为测试，没有目视。

**人工看一眼的清单（客户端改动只需刷新页面，不必重启 host）**
1. 点一个未暂存文件 → 变更列表**仍在**，diff 出现在**提交框下方**，约半屏高，头部有 `+n −m`；
2. 拖 diff 顶部那条窄边 → 高度跟着走，松手后停住；拖到顶也压不掉上面的列表与提交框；
3. 同一文件同时有暂存与未暂存改动时，点两行看到各自的对比（FR-2.2）；
4. 点未跟踪文件 → 全新增；
5. 切「左右对照」→ 关闭再点开仍是左右对照（FR-2.4）；
6. 让 agent 改一下当前打开的文件 → diff 自己刷新（§4.4）；
7. 二进制文件 → 「二进制文件不显示差异」（FR-2.5）。

---

## 9. M4 交付（已完成）与 M5 概要

- **M3（diff）已完成**，见 §8。留给后面的两件：diff 的**虚拟滚动**（§6 性能 P1 未做，
  现在靠 FR-2.6 的折叠门兜底）；FR-7.2「提交详情里下钻看某文件 diff」现在可以直接复用
  `DiffView` + `git show <hash> -- <path>`（M4 只做到详情列表，下钻仍未接，见 D22）。
- **M4（分支 + 冲突 + AI + 详情）已完成**，范围与产品方逐条确认，三项收窄见 D20–D22：

| 文档要求 | 落点 |
|---|---|
| FR-4.1 分支下拉、切换 | `core/validate.ts` 的 `validateBranchName`（§5.5 + git 自己的 ref 语法）→ `git-service.checkout`（先 `show-ref --verify` 确认是**本地**分支，再 `checkout`，因此不会 DWIM 出分支）→ `ui/BranchPicker.tsx`；分支行本身变成可点的把手（`aria-expanded`） |
| FR-4.2 新建分支（可指定基点） | `git-service.createBranch` + `validateBranchBase`（**只**接受本地分支名或 4–40 位 hash，不接受 `HEAD~1` 这类 git 表达式）；面板给「当前 HEAD / 指定分支」两种起点 |
| FR-4.3 删除分支 + 保护提示 | `git-service.deleteBranch`（`-d`／`-D`）；当前分支由 host 直接以 `bad-request` 拒绝，未合并由 git 拒绝并被分类为新错误码 **`not-merged`**——面板据此把同一行**武装成强制删除**（`ui/armed.ts` 的 `useArmedKey`，§4.3 的「点击武装 → 3s 内再点」首次落地） |
| FR-4.4 切换受阻展示 git 多行输出 | 复用 M2 的 `error.detail` 通道；测试驱动真实「local changes would be overwritten」拒绝，断言完整输出到达。**「贮藏后切换」按 D20 不做** |
| FR-9.1 冲突独立分组 | M1 起就有；M4 只把行内 `+` 的文案改成「标记已解决」（命令不变：`git add` 就是标记已解决） |
| FR-9.3 继续合并 / 中止合并 | `RepoStatus.merging`（`host/git-dir.ts` 的 `gitDirOf` + `stat MERGE_HEAD`，**不额外 spawn**；`git status --porcelain=v2` 不报告这件事，而冲突全部解决后分组会空掉）→ `git-service.continueMerge`（`commit --no-edit`，用 git 自己的 `MERGE_MSG`）／`abortMerge`（`merge --abort`，二次确认）；面板在合并期间顶部出一条状态栏 |
| FR-3.5 AI 提交信息 | 纯函数 `core/commit-message.ts`（截断、提示词、清洗答案）+ `HostPorts.generateText` ← 新适配器 `host/adapter/llm.ts`（`ctx.llm.stream` 流式 + `BlockAssembler`，路由取自 `ctx.agentDefaultModel.currentSelection()`），服务端 `generateCommitMessage`，客户端提交框内的 ✨ | 
| FR-3.6 提交详情（初步） | `parseNumstat`（两句 rename 写法都归到当前路径、二进制报 `null` 计数）→ `git-service.showCommit`（合并提交按 `-m --first-parent` 取，否则 `git show` 对合并什么都不打印）→ `GET /git-panel/showCommit` → 历史行内展开（元信息 + 文件清单 + `+n −m`） |

**M4 的承重细节**

1. **`llm` / `agentDefaultModel` 是可选服务，不进 `inject`。** 用 `ctx.get('llm')` 读，
   没有模型时返回 `no-llm`——面板照常挂载，只有 ✨ 那个按钮解释自己。`host-mount.test.ts`
   在「没有任何模型」的上下文里驱动了整条路由来钉住这一点。
2. **删分支的「武装」必须看得见。** 第一次点击只把该行变成危险色 + 一句「再点一次…」，
   第二次才调用；未合并被拒后，面板用拒绝里的 `not-merged` 把**同一行**武装为强制删除。
   没有 `window.confirm`（§4.3 禁止），也没有「点了没反应」的悬空状态。
3. **合并态的判定不能只看冲突分组。** 全部冲突解决后分组为空、`MERGE_HEAD` 仍在，
   而那正是「继续合并」该出现的时刻；所以状态读取里多了一次 `stat`，而不是一次 git 进程。
4. **AI 只看暂存区。** 提示词由 `git diff --cached` 构成，因此 ✨ 只在 `scope.kind === 'staged'`
   时可点（否则它会是一次注定被拒的往返）；diff 超过 `MAX_PROMPT_DIFF_CHARS` 就截断，
   并把 `truncated` 一路带到界面上说出来（§8.3）。
5. **提示词与清洗是纯函数。** `core/commit-message.ts` 不含任何 DSH 名字，因此「问什么、
   怎么读答案」可以在裸 Node 里测（13 项），只有「怎么调模型」在 adapter 里（7 项，用假 ctx 驱动）。

**M4 之后的界面调整（产品方提出）**

| 调整 | 落点 |
|---|---|
| **历史里的每条提交 = 整行一个按钮**（真 `<button>`，带 hover/选中底色）。对齐同 profile 的 `dsh-better-sidebar`「文件变动 → Git」lens 里提交行的效果，中间经过两次修正：① 原来是带 `role="button"` 的 `div` + 手写 Enter/Space —— 改成真按钮后焦点、原生 Enter/Space、将来的 disabled 都由元素承担；行容器同时带上 `data-commit={完整 oid}` 作为按提交操作的寻址身份（显示仍是短 hash）。② 第一版只把**标题行**做成按钮、底色却盖住两行，等于底色在骗人（产品方当场指出「点击热区没改」）—— 现在 `commitRow` 这个按钮自己包住「标题行 + 元信息行」，**热区与底色是同一块**；详情块是它的兄弟（展开的那条不该把详情一起点亮）。底色用 GUI 自己的交互别名：hover `--dsw-alias-interactive-bg-hover`、当前项 `--dsw-alias-interactive-bg-active`（`data-selected` 跟着开合走）| `ui/History.tsx` + `styles.ts`：按钮带 reset（`width: 100%`、`box-sizing: border-box`、去边框/背景、`font: inherit`），在**按钮自身上**给 hover/selected 底色与 `:focus-visible`，`aria-expanded` 也挂在它身上（caret 旋转随之改选择器）；两行内部退化成普通 flex 行。测试断言：`tagName === 'BUTTON'`、可 `focus()` 且成为 `document.activeElement`、`data-commit` 是完整 oid、按钮 `contains()` 标题行与元信息行、**点元信息行也能开合**（这条正是「热区回退成只有标题」时会红的断言）、`data-selected` 随开合翻转。底色是 CSS 规则，jsdom 解析不了 `var()`，因此按规则文本 + token 名断言 | **代价**：按钮里不能套按钮，所以计划里那两条行级操作（提交的还原/捡取、文件的放弃更改）将来只能做成按钮的**兄弟**（绝对定位在行右槽）或**行级右键菜单**——参考实现正是选了后者 |
| **抓手的边 = 分区的自由边**（产品方实测报来：向上对齐的抽屉，抓手却在上边缘）。规则：顶部锚定、内容自上而下流的分区（三个变更抽屉）自由边在**下**，拖下去长高；底部停靠的分区（底部 dock）自由边在**上**，拖上去长高。原来三个抽屉的抓手都在上边缘，于是「往上拖」的暗示与布局给的反馈相反——上面没有任何东西可以被它挤掉，抽屉实际是往下长的，**手势在说谎** | `ui/pane-resizer.tsx` 新增**必填**的 `edge: 'top' \| 'bottom'`（没有默认值：调用方必须说出自己的分区往哪边长；位移按边取号，底部边 `startHeight + travel`、顶部边 `startHeight - travel`，面板盒子的高度仍从抓手父节点量）；`ChangeGroupPane` 把抓手移到 body **之后**（`edge="bottom"`），`BottomPane` 保持 body 之前（`edge="top"`）。测试同时钉住两侧：抽屉的抓手是 `lastElementChild`（拖下长高、拖上撞下限）、dock 的抓手是 `firstElementChild`（拖上长高） |
| **底部 dock 默认展开**（产品方实测报来：「最近提交这个 tab 页默认打开，现在每次刷新都要手动打开」）。默认从「折成 tab 条」改成**展开在「最近提交」**，并且把「展开/折叠」与拖动后的高度一起记进 `localStorage`（`dsh-git-panel/bottom-pane`）——折叠是用户自己的选择，刷新不该替他改回来 | 新模块 `ui/bottom-view.ts`（`readBottomPane`/`writeBottomPane`，读取做了校验：`expanded` 必须是布尔、`height` 必须是正有限数，否则回落默认）；`BottomPane` 的 `expanded`/`height` 初值来自它，变更时写回。**连带影响**：`HistoryPanel` 的 `active` 在挂载时即为真，所以面板一打开就会读第一页提交（列表本身仍是「只在可见时读」——折叠状态下不花 git 调用，有测试钉住）。**2026-09-12 修订**（产品方要求：「最近提交右侧的那个下拉 icon 可以删，通过是否有 tab 页激活决定是否展开」）：右侧那个 chevron 删掉了，**面板是否展开 = 是否有 tab 处于激活**——点当前激活的 tab 就把面板收起（正是 chevron 原来承担的那个手势，也是唯一的非拖动收折方式），点未激活的 tab 展开。两个状态并成一个 `active: BottomTab \| null`（`null` 即 tab 条），因此不会再出现「展开着但没有选中任何 tab」那种渲染空 body 的状态；`bottomChevron` 类、它的旋转规则与 `bottom.expand` 文案一并删除，`bottom.collapse` 改成激活 tab 的 tooltip。**另外补上一个既有缺陷**：文件从变更列表消失时（被提交/被放弃）面板会清掉 `openFile`，原来 dock 会停在「指向一个已经不存在的 diff tab」而渲染空 body，现在回落到「最近提交」且保持展开——因为用户并没有关掉它 |
| **文件树与分组表头对齐**（产品方实测报来：「根目录的那个 `>` 应该跟上方的 `>` 更改 对齐，暂存区也是一样」）。原来目录按钮的左内边距是 0、分组的表头是 12px，根目录的 caret 因此比分组 caret 左移 12px | 目录按钮改成 `padding: 3px 12px`（与分组表头、与文件行同一份 12px 前导内边距），缩进步长从 14px 改成 **18px = caret 12 + 间距 6**：于是深度 0 的 caret 与分组 caret 同列、目录**名字**与分组名字同列、深度 1 的行与父目录名字同列。测试断言目录按钮与分组表头的 computed `padding-left` 相等，并钉住深度 1 的 `padding-left: 18px` |
| **提交信息改成在这个 box 内左右分栏**（产品方要求）：点击一条提交，**左侧保留提交列表、右侧打开这条提交的信息**，各占一半——原来是「行内展开详情」，那样列表会跳（点的那一行被详情的高度顶下去）、详情还会把后面的历史挤出可视区。现在：`historySplit` 一行两列，`historyList` 是左列、`CommitDetailPane` 是右列（**顺序即语义**：左 entry、右信息）；未选中时只有左列、列表占满整宽；右列自己带表头（短哈希 + 主题 + 收起按钮），因为被点的那一行在另一列、可能已滚出视野 | `ui/History.tsx` 拆成 `CommitRow`（只管行）与 `CommitDetailPane`（只管信息列），行不再接收 detail；`styles.ts` 新增 `historySplit`/`historyList`/`historyDetail`/`historyDetailHead` 并删掉行内的 `commitDetail`；`.dgp-bottom-scroll` 从「滚动体」变成「框」（`overflow: hidden` + flex），滚动交给两列各自承担——这是两列能独立滚动的前提。详情仍按需读、按 oid 缓存（重复点开不多发 `git show`）。测试断言：关闭时 `data-split='false'` 且只有一列、打开后两列且**左列含被点的行**、右列表头写着这条提交、右上角收起按钮能关、再点选中行也能关、点另一条只换右列内容（`[data-commit-detail]` 始终只有一个） |
| **删掉提交行左侧的展开箭头**（`›`）。整行已经是按钮、hover/选中底色也在说「这里可以点」，箭头那套「可展开」的暗示就是多余的第二个信号（产品方要求）。顺带把行左内边距从 22px 收回到 12px——那 22px 原本是给箭头留的槽；详情块的左缩进随之从 40px 收到 24px，仍比行文字深一格 | `ui/History.tsx` 去掉 `CaretGlyph`，`styles.ts` 删掉 `.dgp-history-caret` 及其 `[aria-expanded='true']` 旋转规则（`historyCaret` 这个类名一并从 `cls` 移除，避免留下无人使用的键），行/详情的内边距按上面收；`aria-expanded` 保留在按钮上（屏幕阅读器仍需要知道展开状态）。测试断言标题行里没有 `svg`、且第一个子元素就是哈希 |
| **FR-1.3 落地：变更文件按文件树展示**，并保留平铺列表与一个常显的切换按钮（文档要求「支持列表/树形两种展示模式切换（树形按目录折叠）」，所以两种都在）。**默认是树形**——产品方最新口径（文档没有规定默认值）；选择与目录折叠都写进 `localStorage`（`dsh-git-panel/view-mode`、`dsh-git-panel/collapsed-dirs`），像 diff 布局与分组折叠一样是偏好 | 纯函数 `core/change-tree.ts`（按 `/` 嵌套、**目录优先**、按 git 的字节序而非本机 locale 排序、把「只有一个子目录且自己没有文件」的链压成一行如 `deep/nested/dir`、目录带整棵子树的文件计数）→ `ui/ChangeGroup.tsx` 的 `Group`/`TreeNodeView`（**两种形状都在 Group 里**，因为两个容器都要用；缩进是外层 `treeNode` 的 `padding-left`，行自己的内边距仍归样式表，深度步长 14px）→ `ui/change-view.ts`（模式 + 折叠目录的读写与 `dirKey(area, path)`：每组各建自己的树，所以在「已暂存」里折叠 `src` 不会折叠「更改」里的）→ 状态栏末端一个 `aria-pressed` 的切换按钮（VS Code 把视图动作放在视图标题栏，本插件没有标题栏，就放在状态栏；字形画的是**将要切到**的那一侧） |
| 树的折叠状态是在嵌套里逐层渲染的（`TreeNodeView` 递归），行内动作与点行开 diff 都沿用 `ChangeRow`——树只改变路径**怎么画**，从不改变动作带着**哪个路径**走；因此树里的文件行不再重复目录前缀（`showDirectory={false}`），tooltip 仍是完整路径（FR-1.2） | `ui/ChangeGroup.tsx` + 测试断言树内 `+` 暂存的是完整仓库相对路径、点行读的也是同一个 path |

| **分区高度收成一本预算 + 分组表头常驻**（产品方实测提出五条：「更改区大小不要挤压其他区域，精简区域高度变动逻辑」「暂存区设置最小最大高度」「提交信息区设置最小最大高度」「tab 区可以手动改变高度，但限制，不要挤压其他区域导致其他区域越过最小高度」「更改区设置最小高度；untracked 与 change 如果在区域外都要让人能看见——向下滚动时更改标签固定在上方，untracked 同理」） | ① **预算**：新模块 `ui/panel-layout.ts` 给出状态栏 38 / 已暂存：内容高度（上限 `min(40%, 320px)`，预算里为它**预留** 72）/ 提交框 104–240（其中 textarea 52–140，是这一区唯一会变的量）/ 更改列表 ≥140 / dock ≥32 且 `max-height: calc(100% - 358px)`；`DOCK_RESERVED`（358）就是其余分区下限之和，样式表与 `PaneResizer` 的 `reserved` 用同一个常量。更改列表改成 `flex-basis: 0`：**它的内容不再参与 flex 分配**，所以几千个文件既不会压抽屉也不会压 dock，而是自己在区内滚动（旧写法 `flex: auto` 会把内容高度当基准，超载时按比例压所有可压缩分区——正是产品方看到的现象）。② **dock 的两条边界**：拖动由 `reserved` 夹住，**记忆的高度**同样被内联 `maxHeight: calc(100% - 358px)` 夹住，所以在更高的窗口里拖出来的高度不会在更矮的窗口里压破上面的下限。③ **分组表头常驻**：`position: sticky; top: 0`（原本就有）配上**不透明底色**与**表头自己的下边线**（原来那条「下一个分组的上边线」删掉，否则会贴在下一个表头上），于是滚动长列表时「更改」始终在上方，滚到下方时「未跟踪的文件」同样顶住——一眼能看出当前是哪个区、下面还有什么。测试 3 项：各分区的 computed `min/max-height` 与 dock 拖动后的内联夹子、预算的算术与样式表用的是同一个数、四个分组的表头在各自滚动体里都是 sticky 且带那条下边线 |

### 刷新链路重做：独立的 git 状态探测模块

产品方报障：「最近提交没有事件更新，刚刚丢更新了；你刚开始写文件的时候，文件也丢更新」。
先诊断，后重做——**两个症状是两个不同的 bug**，第三个是顺带发现的漏报：

| 症状 | 真因 | 处置 |
|---|---|---|
| **最近提交不更新** | 客户端 `HistoryPanel` 只在 `active && !loaded` 时读一次，`loaded` 永不复位，而那个「仓库变了」的计数器**只传给了 diff 面板**——所以事件其实触发了，列表也不会重读。与探测无关，是纯客户端 bug | 历史改订 `refs`（§6 第 9 条），重读时按**当前已展开的行数**取，不把用户翻出来的页丢掉。测试：「re-reads the history when a ref moves, and not when only a file does」 |
| **写文件时丢更新** | 工作区里新建/编辑文件**不动 `.git` 里任何文件**（实测 `index`/`HEAD`/`logs/HEAD` 三者 mtime 全不变），而当时的 watcher 只 stat `.git` 下的几个文件——**事件源根本不存在**，不是丢事件 | 探测模块改为文件系统事件为主（工作区递归 + git 目录），轮询降为回退。实测覆盖：新建/修改/删除/新目录/新目录里的新文件/整目录删除后重建 |
| （顺带）空提交、fetch、push 一直没信号 | `--allow-empty` 只动 `logs/HEAD`；`git fetch` 只动 `FETCH_HEAD` 与 `refs/remotes`；两者都不动 `index`/`HEAD`，而旧 stamp 列表里恰好一个都没包含 | 新增 `refs` 类信号；`test/git-probe.test.ts` 分别用空提交、`update-ref`、轮询回退三条测试钉住 |

| 落点 | 内容 |
|---|---|
| `src/host/git-probe.ts`（新，**替代并删除** `host/watcher.ts`） | `createGitProbe(ports, { strategies })`：策略列表按序尝试，启动失败或运行中 `unavailable` 就换下一个。`fileSystemStrategy`＝工作区递归 + git 目录各一个 `fs.watch`（**空闲零成本**，无定时器）；`pollStrategy`＝回退（1s 状态戳 + 每 10s 补报一次 `worktree`，因为「什么都没动」在 `.git` 里看不出来）。分类是两个纯函数（`kindsInWorkTree` / `kindsInGitDir`），burst 窗口 80ms 合并后才上报 |
| `src/host/adapter/routes.ts` | `/events` 退回纯 transport：`changed` 帧带上 `{"kinds":[…]}`。**订阅先于 ready**（探测 resolve＝已建立），客户端把 `ready` 也当成一次「可能变了」，关掉「面板首次读」与「探测建立」之间那一瞬的窗口 |
| `src/client/ui/repo-change.tsx`（新） | 面板内的事件总线（context + `useSyncExternalStore`，单调计数）：历史订 `refs`、diff 订全部。**`generation` 那条 prop 链已删除**——以后加面板不必再改中间层 |
| `src/core/status-signature.ts`（新） | 一次 status 读数的指纹。相同就不发布、不重渲染——「有事件」不等于「要重渲染」，否则 `.git/objects` 的写入会让整个面板每秒钟重画 |
| `src/core/ports.ts` | `watch(sessionId, onChange: (change: GitChange) => void)`；`GitChangeKind`/`GitChange` 是探测与 UI 共用**中性词汇**（谁都不提文件名） |
| 测试 | `test/git-probe.test.ts` 11 项（三类信号、burst 合并、启动失败换策略、运行中换策略、退订后安静、轮询回退的两种信号）+ 客户端 4 项（宿主报变化即重读、读数没变不发布、refs 重读历史而 worktree 不读、打开的 diff 跟随） |

### 已登记、本次不做的后续工作

以下三项都是产品方在提出「提交 entry 要像 better-sidebar 那样」时确认要**记录**的工作（本文档对
`dsh-better-sidebar@0.19.0-alpha.1`「文件变动 → Git」lens 的走查结论，源文件在同一 profile 的
`node_modules/dsh-better-sidebar/src/client/changes/GitLens.tsx`）。

| 事项 | 内容与需要补的东西 |
|---|---|
| **① 点击提交行在底部 pane 预览该提交的差异** | 这正是 FR-3.6 的「可下钻看该提交的 diff」/ FR-7.2，也是它替代行内展开的做法（`onPreview(commitRefOf(entry))` → 共享底部 `DiffPane`）。需要：`DiffArea` 增加「按提交取 diff」的形态（如 `{kind:'commit', hash}`）、host 侧 `git show --no-color --no-ext-diff --no-textconv --unified=N <hash>`（**合并提交仍用 `-m --first-parent`**，与 `showCommit` 同口径）、以及多文件 patch 的渲染（它的 `git.commit-diff` 直接回整条 patch；我们要么让 `core/diff-parse.ts` 把一条 patch 切成多个文件段、要么按文件下钻 `git show <hash> -- <path>`）。做完这一项，行内的详情块可以退化成「文件清单 + 点击文件下钻」。**✅ 2026-09-12 已在 M5b 顺序 5 交付**，走的是「按文件下钻」那一支：详情列的文件行成为按钮，命令是 `git show <hash> -m --first-parent -- <path>`，渲染复用底部 pane 既有的 `DiffPane`/`DiffView`，不新写解析器——细节与取舍见 §10.2 的「顺序 5 交付」 |
| **② 提交行的右键操作菜单** | 它的条目：查看提交差异 / 复制短哈希 / 复制完整哈希 / 复制提交信息 / 分隔线 / **还原此提交**（danger + 确认：「将在当前分支创建一个反转「{subject}」的新提交。」）/ **捡取此提交**（danger + 确认：「将「{subject}」的更改应用到当前分支。」）。复制类三项是纯客户端 clipboard，随时可做；还原/捡取属**改写历史**，与 FR-3.8 的撤销（M5a）、drop/squash/reset（M5b）同一批，需要 host 新路由 + §4.3 的确认（本插件的确认机制是 `ui/armed.ts`，不是原生 `confirm`）。**2026-09-12**：复制三项已随顺序 6 交付（提交菜单自此挂在**每一行**上，「撤销此提交」仍只在最新一行，见 D39）；「查看提交差异」由顺序 5 的详情列文件下钻承担；还原/捡取仍在顺序 9 |
| **③ 更改文件行的右键操作菜单** | 它的文件行菜单：在编辑器中打开 / 暂存·取消暂存（按该行所在的一侧）/ **放弃更改**（danger + 确认；未跟踪文件不提供）/ 复制相对路径 / 复制绝对路径。落到本插件的三处约束：**「打开编辑器」受 D21 限制**（本 profile 没有「按路径打开文件」的缝，本插件也没有 `--no-index` 之外的编辑器能力）；「放弃更改」是 FR-6.1，与 M5a 的 discard 一起做（§10.1 顺序 2）；「复制绝对路径」需要仓库根前缀（`RepoStatus.root` 已在客户端，`core/format.ts` 的 `repoAbsolutePath` 拼接，客户端不自己碰文件系统）。另外**菜单本身的实现方式要先定**：primitives 的 `Menu`/`Modal` 不能出现在 `src/client/ui/**`（依赖方向第 3 条），要么在 `client/adapter/` 里包一层中性接口，要么像 `BranchPicker`/`PaneResizer` 那样手搓一个轻量弹层（含定位、Esc、点击外部关闭、键盘导航）。**2026-09-12 已定并落地**：手搓 —— `ui/popover.tsx`（层）+ `ui/menu.tsx`（条目与键盘），见 §10.1 顺序 1；这张菜单现有该行自己的暂存动作 + 分隔线 + 「放弃更改」（顺序 2 已交付，且按 D26 只在工作区侧的行出现）+ 分隔线 + 「复制相对/绝对路径」（顺序 6 已交付，每一行都有） |

**这三项在 §10 里的排期**：① = M5b 顺序 5（**✅ 已交付**，见 §10.2）；②③ 的**菜单载体**
就是 M5a 顺序 1——顺序 1 不落地，这两张菜单各自都无从写起；其中「放弃更改」= M5a 顺序 2、
复制类条目 = M5b 顺序 6（**✅ 已交付**，见 §10.2）、「还原/捡取」= M5b 顺序 9、
「打开编辑器」受 D21 阻塞（§10.4）。

**M5 概要**（文档 §7 的原文范围）：discard（二次确认「不可恢复」）、stash、提交图 SVG 泳道、撤销最近提交
（未推送 `reset --mixed`／已推送 `revert`，执行前后端重新核实 —— FR-3.8）、多仓库扫描（FR-8），
以及 M4 明确留下的两件：提交详情里下钻单个文件的 diff（FR-7.2）、提交改写（drop/squash/reset）。
**这一范围已按 D24 拆成 M5a / M5b，工作包、依赖与开工顺序见下一节。**

---

## 10. 后续工作优先级（M5a / M5b）

范围按 D24 拆成两段：**M5a 是破坏性 / 高频写操作**（共享 `ui/armed.ts` 的武装确认与
§7 的审计通道），**M5b 是历史增强与发布收尾**。下面三张表合起来是全部待办，
**顺序即开工顺序**，每项都写明它对应文档哪一条、落在哪、以及为什么排在那里。

### 10.1 M5a（四个顺序已交付，待验收）

| 顺序 | 事项 | 文档条目 | 落点与依赖 | 粗估 |
|---|---|---|---|---|
| 1 | **行级菜单机制**：手搓轻量弹层 | —（前置，无文档条目） | 菜单的载体必须先定（§9 已登记②③正是卡在这里）：primitives 的 `Menu`/`Modal` 不能出现在 `src/client/ui/**`（依赖方向第 3 条），所以在 `ui/` 里做一个中性 popover（定位、Esc、点外部关闭、键盘可达），像 `BranchPicker`/`PaneResizer` 那样自成一体。顺序 2/3 与 §9 的②③都复用它。**✅ 已交付（2026-09-12）**：浮层通用件随分支下拉落地（`ui/popover.tsx`），菜单内容那一层是新模块 `ui/menu.tsx`（条目模型 + 分隔线 + 上下键选择），并接上第一个真实调用方——**文件行的右键菜单**（右键 / Shift+F10 / 菜单键打开），条目是今天就能用的该行暂存动作。细节见下方「顺序 1 交付」 | S–M |
| 2 | **放弃更改 discard** | FR-6.1 | host 新路由 `discard`：已跟踪走 `git restore --`（**未出生分支的陷阱与 `unstage` 同源**，见 §6 第 3 条）、未跟踪才真删文件；复用 `core/validate.ts` 的 `validatePaths`。FR-6.1 的原话是「**文件行**提供放弃更改按钮」，所以行内 `+`/`−` 旁多一个 danger 按钮（hover 显形，§4.3），同一个动作也进 §9③ 的菜单；武装用 `useArmedKey`，文案必须出现「不可恢复」（§4.3 禁止原生 `confirm`）；审计记「丢弃了哪些路径」（§7 的 M5a 待办）。第三个行内按钮在窄侧栏里的几何按 M3 的教训处理（`.dgp-row` 的 `box-sizing` 与右内边距，见 §8） | **✅ 已交付（2026-09-12）**：见下方「顺序 2 交付」 |
| 3 | **撤销最近提交** | FR-3.8 | host `undoCommit`：**执行前由后端重新核实推送状态**（不信客户端传来的任何东西），未推送 `reset --mixed HEAD~1`、已推送 `revert --no-edit`；入口挂在历史行上（用顺序 1 的弹层）；`core/validate.ts` 里的 `validateHash` 正好得到第一个调用方——这正是 D11 那条原则的兑现 | **✅ 已交付（2026-09-12）**：见下方「顺序 3 交付」 |
| 4 | **贮藏 stash** | FR-6.2 + D20 | 存（可带消息）/ 列表 / 应用（pop · apply）/ 删除；做完才能把 D20 的「贮藏后切换」补回 FR-4.4 的受阻路径——那正是 M4 有意留下的降级口 | **✅ 已交付（2026-09-12）**：见下方「顺序 4 交付」；「贮藏后切换」同批补回 FR-4.4（D33/D34） |

### 顺序 1 交付：行级菜单机制（2026-09-12，已完成）

| 落点 | 内容 |
|---|---|
| `ui/menu.tsx`（新） | 菜单**内容**层：条目模型（`item` / `separator`，外加 `disabled` 与 `danger` 两个标志）、一个高亮同时被指针与上下键移动、ArrowDown/Up（跳过禁用项与分隔线、两端回绕）、Home/End、Enter/Space、Esc/Tab 关闭。手搓而非 primitives —— 依赖方向第 3 条不许 `src/client/ui/**` 碰 DSH，包一层 adapter 又会把菜单的**外观**挪到适配器后面 |
| `ui/popover.tsx` | 新增**纯函数** `placeLayer`：层默认挂在锚点下方，下方放不下**且**上方更宽裕时翻到上方（行菜单可能开在面板最后一行，否则会被 `max-height` 压成几像素）。它是纯函数是因为 jsdom 没有布局：翻转用「给定的矩形」在测试里钉住，DOM 那一半只负责把量到的矩形喂进去。另加「锚点已脱离文档就不再测量」 |
| `ui/ChangeGroup.tsx` | `ChangeRow` 新增 `onMenu(entry, area, anchor)`，由右键与 Shift+F10 / 菜单键触发（行本身就是锚点，取的 `event.currentTarget`）。`Group`/`TreeNodeView` 只做透传 |
| `ui/StatusPanel.tsx` | 菜单状态（锚点元素 + 条目 + 所在分组）、条目由该行所在侧决定（已暂存 → 取消暂存；未暂存 → 暂存；冲突 → **标记已解决**，命令仍是 `git add`）、打开菜单时收起分支下拉（Shift+F10 没有 pointerdown，否则会两层叠着）、打开该行 diff 时收起菜单（点锚点不算「外部点击」）、该文件从列表消失时收起菜单（与会话切换时的清空一并做） |
| 可访问性 | 层 `role="menu"`（名字是「{path} 的操作」），条目 `role="menuitem"`，分隔线 `role="separator"`；焦点进菜单容器（不是某个条目，否则 Space 会走原生 click），关闭时**焦点回到打开它的那一行**——但仅当焦点还在菜单里或已落空，用户在别处的点击不会被抢回来 |
| 测试 | 18 项：`placeLayer` 5 项（下方放不下才翻、长列表不翻、面板没有高度时不动）、行菜单 7 项（挂在被右键的那一行上、跑对哪些路径、冲突项的名字、Shift+F10 打开且 Enter 执行并还焦点、外部点击与开 diff 两种关闭、同时只有一层）、`Menu` 5 项（条目/分隔线/danger/disabled 的渲染、跳过禁用项与回绕、Enter 先关后执行、Esc 与 Tab、指针与键盘共用同一个高亮）、样式表 1 项（hover 与 `data-active` 共用同一条高亮规则） |

**这张菜单现在只有一条条目**，是刻意的：它今天能做的只有该行自己的暂存动作，
「放弃更改」是顺序 2（要 host 新路由与武装确认）、「复制相对/绝对路径」是顺序 6、
「在编辑器中打开」受 D21 阻塞。机制与条目模型先落地，是为了让那三处各自只加一条条目，
而不是各自再造一个弹层。

### 顺序 2 交付：放弃更改 discard（2026-09-12，已完成）

| 落点 | 内容 |
|---|---|
| `host/git-service.ts` | `discard(sessionId, paths)`：先 `git ls-files -z -- <paths>` 问一次索引，**由索引而不是客户端**决定每条路径走哪条命令——已跟踪 `git restore --`（默认源就是索引，所以未出生分支也成立）、索引完全不认识的 `git clean -f --`。用 `clean` 而不是 `fs.rm` 是因为它会**拒绝**两件不该发生的事（实测两者都是 exit 0 且文件不动）：路径其实已被跟踪、路径被 `.gitignore` 忽略——过期的请求因此删不掉索引还记着的文件。冲突路径两条命令都会拒绝（`path 'x' is unmerged`），这正是「不替用户选边」的答案 |
| 审计（§7 的 M5a 待办） | 每次 discard 记一行，**逐条列出被丢弃的路径**（`auditPaths`：最多 20 条 + `… (+N more)`，因为请求体上限是 1 MiB，一行日志不该等于一个清单）。stage/unstage 只记条数，这一条需要更明确——文件已经没了，日志是唯一的记录 |
| `core/ports.ts` + `host/adapter/routes.ts` + `client/adapter/git-client.ts` | 服务端口 `discard` 双向各一个方法；`POST /git-panel/discard` 进 `WRITE_OPERATIONS`（GET 405、跨源 403、同源校验照旧） |
| `ui/row-actions.ts`（新） | 一条纯规则 `canDiscard(area)`：只有 `unstaged` / `untracked` 两种行提供放弃更改（**D26**）。行内按钮与行菜单都问它，所以两边不会一边有、一边没有 |
| `ui/ChangeGroup.tsx` | 行内第三个按钮（`DiscardGlyph`，hover 显形），自己一套 `useArmedKey`（键 = 路径）：第一击武装成 danger 文字按钮「再点一次：不可恢复」，第二击执行。行自带武装状态而不是用面板的共享键，理由与 `BranchPicker` 相同——这一行的武装随这一行消亡，而 panel 那份键属于它自己 chrome 里的控件 |
| `ui/menu.tsx` + `ui/StatusPanel.tsx` | 菜单条目新增 `stayOpen`：**这是 §4.3 的第一击**，条目武装而不是执行，菜单必须留着才能有第二击。菜单条目用面板的 `useArmedKey`（键 `discard:{area}:{path}`），`data-danger` + 武装后自己变成那行确认文字；第二击执行并关菜单。行菜单的形状因此变成 §9 的样子：暂存动作 → 分隔线 → 危险的放弃更改 |
| 与已有的两条规则对齐 | 打开菜单时收起分支下拉、行开 diff 时收起菜单、文件从列表消失时收起菜单——都沿用顺序 1 的三条；一次成功的 discard 之后面板自己的通知说「已放弃「{path}」的更改」，因为 `git restore` 什么都不打印，而用户需要听到自己刚放弃了哪个文件 |
| 测试 | 14 项（335 总计）：服务层 8 项真仓库（索引那一半保住、"three" 回到 "two"、未出生分支、删未跟踪文件、一次请求两半都走对、已暂存-only 是 no-op 且不动索引、删除的文件被恢复、冲突被拒绝且文件原样、四种非法路径 refusals 不发 git）、路由 1 项（POST 走通 + GET 405）、客户端 4 项（行内按钮先武装后执行且文案含「不可恢复」、已暂存/冲突行没有这个按钮而菜单也没有该条目与分隔线、菜单条目武装后菜单不关且第二击执行并关闭、被拒的 discard 落回列表旁）、菜单机制 1 项（`stayOpen` 的条目不关菜单，普通条目照旧先关后执行） |

### 顺序 3 交付：撤销最近提交 undoCommit（2026-09-12，已完成）

| 落点 | 内容 |
|---|---|
| `host/git-service.ts` | `undoCommit(sessionId, hash)`：**执行前全部重核，不信客户端的任何读数**——`rev-parse HEAD` 必须与传入 hash 相等（行已过期则拒绝，而不是默默撤销一个没人指着的提交）；推送状态用 `merge-base --is-ancestor HEAD <upstream>` 现问仓库（与历史行 ○/● 标记同一基准，两者不会打架），上游不存在或解析不出都算「未推送」——**reset 是安全的倾斜方向**（不碰远端）。未推送 → `reset --mixed HEAD~1`（改动退回工作区）；已推送 → `revert --no-edit`（新提交，不改写已发布历史）。两种明确拒绝：未推送路径上的**根提交**（没有 `HEAD~1` 可回退；「撤销」到分支不存在是另一个决定，不是撤销一个提交）与已推送路径上的**合并提交**（revert 需要 `-m` 选主线，那是用户在终端里的决定，不是面板猜的）；未推送的合并允许 reset（不需要选主线）。游离 HEAD 与未出生分支同样前置拒绝 |
| 审计（§5.5） | 每次 undo 记一行：短 hash、仓库根、`via reset`/`via revert` 与 subject——reset 之后提交从历史消失，日志是唯一的记录 |
| `core/types.ts` + `core/ports.ts` | 新增 `UndoResult { mode, shortOid, subject }`（文档 §5.4 的 `{ mode }` 加上提交身份，好让通知能说出撤销的是谁）；`WorkspaceGitService` 与 `GitRemoteClient` 各加一个方法。**API 形状有意带 hash**：文档 §5.4 的 `undoCommit()` 无参，但 hash 是「过期行」防线的一半（host 拿它与现读的 HEAD 比对），也是让 `validateHash` 复用得上的形状——登记为对文档的一处扩展 |
| `host/adapter/routes.ts` + `client/adapter/git-client.ts` | `POST /git-panel/undoCommit` 进 `WRITE_OPERATIONS`（GET 405、跨源 403、同源校验照旧） |
| `ui/History.tsx` | `CommitRow` 获得可选 `onMenu`（右键 / Shift+F10 / 菜单键，锚点就是行自身）；`HistoryPanel` 只把**最新一行**（`commits[0]`）接上菜单——FR-3.8 的「仅最新一条」在 UI 层就不提供入口，其余行的右键不作任何拦截 |
| `ui/BottomPane.tsx` + `ui/StatusPanel.tsx` | `onCommitMenu(commit, anchor)` 透传到面板：菜单状态并入既有的 `menu`（判别联合 `kind: 'file' | 'commit'`），同一套 `Popover` + `Menu`；条目只有一条 danger 的「撤销此提交」，`stayOpen` 武装（键 `undo:{oid}`），**武装文案跟着该行的 ○/● 标记走**：未推送「再点一次：改动退回工作区」、已推送「再点一次：创建反转提交（原历史保留）」——客户端的标记与 host 的现问同基准，所以预告不会说谎。成功通知按 host 返回的 `mode` 分两句，都点名被撤销的 subject（reset 后行已不在历史里，这句话是唯一记录）。「行从列表消失则收起菜单」的既有规则**不适用**于 commit 菜单（历史不在面板的 snapshot 里），过期行的答案就是 host 的拒绝 |
| `ui/error-copy.ts` | `bad-request` 不再丢掉 `error.message`：§5.5 的形状校验在诚实 UI 下不可达，而 undo 的拒绝是**可达状态**（过期行、根提交、已发布合并），那句原因必须被看见。原先「请求不完整，请重新打开这个面板」的文案键随之删除 |
| 测试 | 14 项（355 总计）：服务层 8 项真仓库（未推送 reset 且改动退回工作区、有上游但未推送仍 reset、已推送 revert 且远端不动而反转提交未推送、过期 hash 拒绝且 HEAD 不动、根提交拒绝、未出生与游离拒绝、已发布合并拒绝而未发布合并 reset 成功、五种非法 hash 不发 git）+ 审计 1 项（记 hash/仓库/mode/subject）+ 路由 1 项（POST 走通 + GET 405）+ 客户端 5 项（只有最新行有菜单且单条目 danger、未推送武装成 reset 文案且第二击执行并通知点名 subject、已推送武装成 revert 文案、Shift+F10 打开且 Enter 先武装后执行、拒绝落在列表旁且历史原样）；既有「不认识会话/非仓库」两表也补进 `undoCommit` |

### 多选交付：变更行勾选与批量操作（2026-09-12，已完成）

产品方要求：「支持选中文件。文件夹行也需要支持，选中文件夹中的文件行」。
不在文档的 FR 清单里，是文档外新增；FR-3.2 的整组批量按钮升级成「有选中时作用于选中子集」。

| 落点 | 内容 |
|---|---|
| `core/change-tree.ts` | 新增纯函数 `filesUnder(node)`：目录节点的全部后代文件 entry（深度优先、与渲染同序，compacted 链也算在其合并行的名下）。目录复选框「代表其下全部文件」靠它回答 |
| `ui/ChangeGroup.tsx` | 新组件 `RowCheckbox`：`role="checkbox"` 按钮 + `aria-checked`（`true`/`false`/`'mixed'`），外层 span 承担 `stopPropagation`（与行内 `+`/`−` 同一套路——点复选框绝不打开 diff）；勾选用既有 `CheckGlyph`、半选用 `MinusGlyph`。`ChangeRow` 行首挂一个（带 `data-selected` 供高亮与测试寻址）；`TreeNodeView` 的目录行挂一个三态的：全选其下文件、部分选中显示 `mixed`、再点全不选。`Group` 的 `GroupBatch` 加 `selection?: { count, run }`；头部批量按钮有选中时改文案为「暂存选中（N）/取消暂存选中（N）」并只作用于选中路径。新增 `GroupDanger`（选中集的批量丢弃）：只由可丢弃的分组（unstaged/untracked，`canDiscard` 那条规则）在选中非空时传入，第一击武装成确认文案、第二击执行（§4.3，用面板共享的 `useArmedKey`，键 `discard-selected:{area}`） |
| `ui/StatusPanel.tsx` | 选中状态：`Map<ChangeArea, Set<path>>`（同一路径可在两个分组各勾一次，是两句话）。**存活范围 = 当前会话**：快照刷新后修剪已不在该组的勾选（effect 里比较后再 set，不引发渲染循环）、切会话清空、不写 localStorage。`selectedIn(area, entries)` 按分组自身顺序返回选中路径——发给 git 的参数序 = 用户读列表的顺序。冲突组**保持无整组批量**的既有刻意决定，但选中非空时长出「暂存选中（N）」（即标记已解决，FR-9.2 同一命令）。批量丢弃的通知按条数说「已丢弃 N 个文件的更改」（逐个点名四十个路径不是一句话能承受的） |
| `styles.ts` | 14px 方框复选框：未选中只有边框，选中/半选填充 `state-business-primary` 让 tick 反色；目录行的复选框用 `margin-left: 12px` 取得与文件行行内边距相同的前导列（`.dirToggle` 的前导内边距相应归零，caret 跟在框后）；`data-selected='true'` 的行加 hover 同款淡底 |
| `locales.ts` | +9 键（中英）：`action.stageSelected` / `action.unstageSelected` / `action.discardSelected` / `action.discardSelectedArmed` / `select.check` / `select.uncheck` / `select.checkDir` / `select.uncheckDir` / `discard.doneSelected` |
| 测试 | +10 项（365 总计）：`filesUnder` 3 项（嵌套顺序、compacted 链、多子目录）；客户端 7 项（勾两个行 → 头部「暂存选中 (2)」→ 只发这两个路径；无选中时头部仍是「全部暂存」；已暂存组的取消暂存选中；树模式目录框全选/半选、头部计数、点框不开 diff；丢弃选中先武装后执行且已暂存组无此按钮；行消失后勾选被修剪；冲突组选中即标记解决；切会话清空选择）。既有树测试的两处 `must(..., 'button')` 改为指向 `dirToggle`（目录行第一个按钮现在是复选框），对齐断言从「caret 与分组 caret 同列」更新为「复选框占据前导列」 |

### 顺序 4 交付：贮藏 stash（2026-09-12，已完成）

FR-6.2 的四个动作（存 / 列表 / 应用 / 删除）加 D20 欠下的那条捷径，一起交付。

| 落点 | 内容 |
|---|---|
| `core/types.ts` | 新增 `StashEntry { oid, shortOid, selector, subject, createdAt }`。**`selector` 只用于显示**：`stash@{n}` 是栈里的位置，另一个窗口再贮藏一次就全体位移 |
| `core/git-parse.ts` | 新增纯函数 `parseStashList`：解析 `%gd%x00%H%x00%h%x00%s%x00%cI%x1e`，空输出 = 空栈（从未贮藏过、未出生分支都是这个答案），字段不足的记录跳过而不是猜 |
| `core/validate.ts` | 新增 `validateStashMessage`（D31）：缺省/`null`/纯空白 → `null`（= 没有说明），非字符串、含 NUL、超 4096 才拒绝；id 复用 `validateHash` |
| `core/ports.ts` | 服务端口四个方法 `stashes` / `stashSave(message, untracked)` / `stashApply(oid, pop)` / `stashDrop(oid)`，客户端端口镜像一份；`GitErrorCode` 新增 `dirty-worktree`（D34） |
| `host/git-service.ts` | `readStashes`（`git stash list`）、`findStash`（**按 id 现读现解析**，不在栈里就 `bad-request`「that stash is no longer in the list」——D30②）。`stashSave` 先读一次 `status` 判断「有没有可贮藏的东西」：`git stash push` 在空工作区会打印 "No local changes to save" 并退出 0（实测），不先问就会宣布一次没发生的贮藏；`-u` 只在调用方要求时加。`stashApply` 用解析出的选择器跑 `pop`/`apply`，`stashDrop` 只跑 `drop`。审计四条各自记关键信息（stash 是否含未跟踪、说明文字、apply/pop 的选择器与短 id、drop 的选择器 + 短 id + subject）。**`FAILURE_PATTERNS` 里 `nothing-to-commit` 挪到最后一位**（D32） |
| `host/adapter/routes.ts` | `stashes` 进 `READ_OPERATIONS`（GET），`stashSave` / `stashApply` / `stashDrop` 进 `WRITE_OPERATIONS`（POST + 同源 + 405/403 照旧）；`stashSave` 的 `message` 可以缺省（缺省 = git 自己写标签），`untracked`/`pop` 读 `=== true` |
| `client/adapter/git-client.ts` | 四个方法；id 与 `pop`/`untracked` 作为字段发出，与 `createBranch` 的 `base: null` 同一种「一个参数两种写法」 |
| `ui/StashPicker.tsx`（新） | 浮层里的栈：每条两行（`stash@{n}` 选择器 + git 自己的 subject），三个控件「应用 / 弹出 / 删除」；「删除」是图标按钮，第一击武装成 danger 文字按钮「再点一次：删除」（§4.3，`useArmedKey` 用自己的键 = 条目 oid，武装随层消亡）；底部是「贮藏当前更改…」表单（说明输入框 + 「包含未跟踪文件」复选框，**默认不勾** = git 的默认）。与 `BranchPicker` 同构：只描述层的内容，定位/点击外部/Esc 都归 `ui/popover.tsx` |
| `ui/StatusPanel.tsx` | 状态栏新增贮藏按钮（`aria-expanded` + `aria-haspopup="dialog"`，与分支按钮同一种「我打开一个层」的语义）；层打开时读一次栈、每次操作后再读（`stashReads` 计数器）。与分支下拉/行菜单互斥（一次只开一层，Enter 打开 diff 时也收起）。通知是面板自己的句子（git 的 `Saved working directory…` 不是用户要听的）：已贮藏（带说明）/ 已应用 / 已弹出 / 已删除，各点名选择器 |
| FR-4.4 的捷径（D20 / D33 / D34） | `checkout` 失败且错误码为 `dirty-worktree` 时记下**被挡住的那个分支名**，失败框（git 的多行输出原样在）下面长出「贮藏后切换到 {name}」：一击做 `stash push -u` → 重试同一次 `checkout`。未武装——搬进栈的东西可由同一层 `apply` 回来，可逆；重试仍被拒就照旧报第二次拒绝，并让捷径留在原处（`dirty-worktree` 之外的原因不给这条捷径） |
| `ui/error-copy.ts` + `locales.ts` | `dirty-worktree` 有自己的标题（「git 拒绝覆盖本地改动」），git 的原始输出仍作为 detail；+27 键（中英）覆盖贮藏按钮、层、表单、四个动作与三种通知、捷径文案 |
| `styles.ts` 的两档墨色（D35） | 新增 `cls.accent`：`--dsw-alias-link` + 全局面板同一条 hover 淡底，用于「新建分支…」「贮藏当前更改…」、贮藏条目的「应用 / 弹出」与「贮藏后切换到 X」；`.ghost` 保持 `label-tertiary` 只服务脚注（表单「取消」、diff「折叠」、分组批量按钮）。产品方验收时反馈：「这两个可以交互的纯文字……我都不知道这两个可以点」 |
| 测试 | +30 项（395 总计）：core 6 项（`parseStashList` 三段真实字节格式 + 空栈 + 多行/残缺记录；`validateStashMessage` 三类形状）；服务层 12 项真仓库（带说明贮藏并列出、未跟踪只在要求时收、已暂存与未暂存一并收走且两侧干净、空工作区拒绝、冲突合并中被 git 拒绝且不动冲突现场、apply 保留条目 / pop 删条目、**按 id 应用位移过的栈**、过期 id 拒绝、被本地改动挡住报 `dirty-worktree`、pop 冲突保留条目、drop 审计、非法 id 不发 git）；路由 2 项（GET 栈 + POST 405；三个写路由走通、GET 405、缺 id 走信封）；客户端 10 项（从状态栏打开并列出、表单带说明与未跟踪选项、按 id 应用/弹出、删除先武装、空栈提示、两档墨色：开表单的那两条是动作而表单的「取消」仍是脚注；FR-4.4：受阻后出现捷径并「先贮藏再切换」、重试成功后的通知点名分支、其它原因不给捷径） |

### 验收期改动：文件行的图标与徽标（2026-09-12，产品方提出）

不属于任何 FR 的新增，是验收时对 FR-1.2 那一行的排版反馈（见 D36）。

| 落点 | 内容 |
|---|---|
| `core/file-kind.ts`（新） | 纯函数 `fileKindOf(path)`：取最后一段路径名，先查按全名的表（`Dockerfile`/`Makefile`/`.gitignore`/`.env.local`/`LICENSE`… 这些的意义不在扩展名里），再查按扩展名的表；`.gitignore` 那种「唯一的点在开头」不算扩展名，认不出来就是 `file`（普通文件），不猜。**加类型只动两处**：`FILE_KINDS`（唯一的清单，`FileKind` union 由它派生）加一个名字 + `ui/icons.tsx` 的 `FILE_MARKS` 加一个记号——漏了记号是编译错误；而「哪些扩展名归到它」只是 `BY_EXTENSION` 里的一行。要上色也不用改 TS：行上的 `data-kind` 已经写出去了，加一条 `[data-kind='x']` 的 CSS 即可 |
| `ui/icons.tsx` | 新增 `FileKindGlyph`：**每个类型各画各的记号，不共用外框**，画满 16×16 的 3–13 区间：code（`{ }` 花括号，左在左、右在右）、markup（标签）、style（`#`）、data（2×2 网格）、image（地平线 + 太阳）、doc（三行长文）、shell（`>_`）、config（两条滑杆 + 旋钮）、file（唯一的纸张轮廓）。第一版九类都画在同一张纸上，产品方实测「乍一看都一样」，据此重画 |
| 图标映射可配（D38）：`core/icon-config.ts`（新）+ `host/file-icons.ts`（新）+ `GET /git-panel/fileIcons` + `ui/file-icons.ts`（新） | 一行一个 `扩展名: SVG 路径`（默认 `$DSH_HOME/git-panel-icons.yml`，`Config.fileIconsPath` 可改）；host 解析、校验（像 SVG / ≤64 KiB / ≤64 项 / 绝对路径或 `~/`）、按 mtime+size 缓存并按需重读、全量下发；客户端转 `data:` URL 用 `<img>` 画，命不中回落内置 glyph |
| `ui/ChangeGroup.tsx` + `styles.ts` + `core/git-parse.ts` | 徽标字母改成「状态的英文首字母 + VS Code 的冲突记号」：未跟踪 `?` → `U`、冲突 → `!`（`BadgeLetter` = `M/T/A/D/R/C/U/!`，一字母一状态，配色与 tooltip 都按字母取）；`ChangeRow` 的子元素顺序变成 `[复选框][类型图标][路径][hover 按钮列][状态徽标]`——状态是**行的最右端、操作右侧**的自成一列，字母沿列表纵向对齐；徽标补 `title`（`STATUS_COPY`：字母 → 译文键，键写错是编译错误），因为字母离文件名远了；新增 `.dgp-file-icon`（14px 定宽、`label-tertiary`）；分组标题的右内边距 12px → 32px（= 12 + 8 + 12，补出状态列），让「全部暂存」仍与行的 `+`/`−` 同列；空分组那句提示的缩进从 54px 改成 56px（= 12 + 14 + 8 + 14 + 8，跟的是新的前导列） |
| `locales.ts` | +9 键（中英）：`status.modified` / `typeChanged` / `added` / `deleted` / `renamed` / `copied` / `unmerged` / `untracked` / `unchanged` |
| 测试 | +24 项（419 总计）：`file-kind.test.ts` 8 项（只取最后一段、五类各取一个、大小写不敏感、按全名认得的那些、认不出时是普通文件、`.eslintrc.json` 与 `.gitignore` 的区别，以及图标键与命中规则）；`badgeFor` 2 项（未跟踪是 `U` 而不是 git 的 `?`；冲突一律 `!`，且 pair 里的 `?` 永远不会漏到徽标上）；`icon-config.test.ts` 5 项（点号可选/大小写、注释与空行、`#` 属于路径 vs 注释、后写的键覆盖先写的、坏行各自一句）；`file-icons.test.ts` 3 项（默认路径随 `$DSH_HOME` 或家目录、`~/` 展开、图标改过之后重读不靠重启）；路由 2 项（只下发读得到的 SVG、其余四种原因逐条进日志；没配置就是空映射）；客户端 4 项（行的子元素顺序、徽标字母与 tooltip、9 个类型互不相同且除回落类型外都不画那张纸、配置的图标按扩展名替换内置 glyph 且一次挂载只读一次） |

### 10.2 M5b（M5a 验收之后）

| 顺序 | 事项 | 文档条目 | 落点与依赖 | 粗估 |
|---|---|---|---|---|
| 5 | **提交详情下钻单文件 diff** | FR-7.2 = §9 已登记① | `DiffArea` 增加「按提交取 diff」的形态 + host `git show <hash> -- <path>`（合并提交仍 `-m --first-parent`，与 `showCommit` 同口径）；渲染直接复用 `DiffView`，不需要新的解析器 | **✅ 已交付（2026-09-12）**：见下方「顺序 5 交付」 |
| 6 | **复制类条目** | §9 已登记②③的一部分 | 短 hash / 完整 hash / 提交信息 / 相对路径 / 绝对路径——纯客户端 clipboard，成本最小、感知最直接，可穿插在 5 与 7 之间（「复制绝对路径」要仓库根前缀，`RepoStatus.root` 已在客户端） | **✅ 已交付（2026-09-12）**：见下方「顺序 6 交付」 |
| 7 | **提交图 SVG 泳道** | FR-7.1 | 分叉开道、合并收道、分页不断线。刻意排在 M5b 内靠后：同 profile 的 `dsh-client-ui-git-graph` 已提供 `/git/graph`（见 §12），它是本批次里**唯一「别处已经能用」的能力**——不是不做，而是边际价值最低 | **✅ 已交付（2026-09-12）**：见下方「顺序 7 交付」 |
| 8 | **多仓库** | FR-8.1 / 8.2（文档自己标 P2） | 工作区根非仓库时扫一层子目录（跳过 node_modules/dist/build/点开头）、仓库下拉、默认取 `.git` 最近活动的仓库、选择按工作区记忆；改动面在 `host/adapter/workspace.ts` 的 `resolveRepo` 与客户端的分支行 | M |
| 9 | **提交改写与还原 / 捡取** | §9 已登记② + D22 | drop/squash/reset，以及提交行的「还原此提交 / 捡取此提交」，全属**改写历史**，需新路由 + 武装确认（§4.3）；M4 时已由产品方确认往后排 | M–L |
| 10 | **v1.0 发布收尾** | §7 的验收标准 | 版本号 0.1.0 → 1.0.0、README 与本文件的已交付范围对齐（顺带修口径：本文件此前写 280 项测试、README 写 282，实际是 282）、安装路径核对（目前只验过 `link:` 装法） | S |

**开工说明**：M5b 原定「M5a 验收之后」，本次顺序 5 是产品方在 M5a 验收仍开着的时候直接下令开工的
（M5a 的 GUI 目视验收照旧待人工确认，见 §10.4）；顺序 6 随后同批下令。两者都只新增只读/客户端路径
（顺序 5 一条只读路由、顺序 6 零零条路由），不碰 M5a 的任何写操作，因此与 M5a 的验收互不阻塞。

### 顺序 5 交付：提交详情下钻单文件 diff（2026-09-12，已完成）

FR-7.2 的落点先定了一件事：**diff 显示在哪里**。两条路都能复用 `DiffView` —— 详情列内联展开，
或切到底部 pane 已有的 diff 标签页。产品方选了后者（与点变更行同一套交互，diff 拿到全宽），
所以本插件新增的是**一条只读的 diff 目标形态**，不是第二个 diff 表面。

| 落点 | 内容 |
|---|---|
| `core/types.ts` | `DiffArea` 增加第三个值 `'commit'`（它是 `FileDiff.area` 这个**标签**，渲染与测试都读它）；新增请求形态 `DiffTarget`：`{area:'worktree'} \| {area:'index'} \| {area:'commit'; hash}`。**hash 放在目标里而不是第二个可选参数**：一个没有提交的提交 diff 不是这个模型该表示得出来的值 |
| `core/diff-target.ts`（新） | 纯函数 `diffTargetKey(target)`：`worktree` / `index` / `commit:<hash>`。两个 panes 都问「屏幕上这条 diff 还是用户点的那条吗」，而同一路径的三种读法是三个不同的答案——键里少了 revision，点开另一条提交的同一个文件就会继续显示上一条 |
| `core/ports.ts` | 服务端口与客户端端口的 `diff(...)` 第二个参数由 `area` 变成 `target`（其余不变） |
| `host/git-service.ts` | `diffPath` 按 target 分三支。commit 支：`validateHash`（**先于任何 git 调用**，与 `undoCommit` 复用同一个校验）+ `git show --format= -m --first-parent -- <path>`，与工作区支共用同一份 `--no-color/--no-ext-diff/--no-textconv/--unified=N` 与同一个 `parseUnifiedDiff`。`--format=` 让字节预算全花在 patch 上；`-m --first-parent` **对每个提交都传**——git 自己规定 `-m` 在非合并提交上是 no-op，而对合并提交它给出与 `showCommit` 的 numstat 完全同一口径的首父 diff，于是「文件清单里的增删行」与「文件的 diff」不可能各说各话 |
| `host/adapter/routes.ts` | `GET /git-panel/diff` 接受第三个 area 值；`area=commit` 时 `hash` 必填（缺了是 malformed request，在路由层就拒），其余照旧（GET 之外 405、跨源 403、同源校验、loopback 全不变——**这是一条读路由，不进 `WRITE_OPERATIONS`**） |
| `client/adapter/git-client.ts` | `diff` 把 target 摊平成查询参数；commit 目标多带一个 `hash` 字段 |
| `ui/DiffView.tsx` | `DiffPane` 收 `target` 而不是 `area`；重置/重读以 target 的**两个原始值**（area 与 revision）为键，目标对象每次渲染重建也不会引发多余读取。**订阅也不同**：commit diff 只跟 `refs`，因为 `git show <hash> -- f` 不会因为 agent 改写 `f` 而变化——跟全部 kind 等于每敲一个键就花一个进程去读一份不可能过期的读数 |
| `ui/BottomPane.tsx` | `OpenFile` 由 `{path, area}` 变成 `{path, target}`；新增必填的 `onOpenCommitFile(commit, path)` 透传给历史面板（由面板实现，因为打开 diff 要收起 rail 上的层） |
| `ui/History.tsx` | `CommitFileRow` 由 `div` 变成真 `<button>`（带 `data-commit-file`、`aria-label`、hover 带与 focus ring）——与提交行同一条理由：热区必须就是那块 hover 底色。`CommitDetailPane` 收 `onOpenFile(path)`，`HistoryPanel` 收必填的 `onOpenCommitFile` |
| `ui/StatusPanel.tsx` | `diffAreaOf` 返回 `DiffTarget`；新增 `openCommitFile(commit, path)`（先收起菜单/分支层/贮藏层，再设 `{path, target:{area:'commit', hash: commit.oid}}`）。**既有那条「文件已不在变更列表里就收起 diff」的规则要跳过 commit 目标**：提交 diff 的主语是一段历史，它点名的文件通常根本不在变更列表里，否则这条 diff 一打开就会被自己关掉——它的过期由 host 回答，与撤销行的过期同一种处理 |
| `styles.ts` + `locales.ts` | `.dgp-commit-file` 拿到按钮 reset + hover/focus 两条规则；负外边距 `margin: 0 -6px` 把 6px 的 hover 带从详情列的 12px 内边距里「借」出来，文字仍与上方表头同列。`history.openFile`（中英）作为行的无障碍名字 |
| 测试 | +9 项（428 总计）：`diff-target` 3 项（三种读法各自成键、同一路径三读互不相等）；服务层 4 项真仓库（commit diff 读的是那次提交而不是工作区未提交的改动、合并提交按首父读且首父那侧的文件不被算进来、未触及的路径给空 diff、四种非法 hash 不发 git）；既有那条路由测试补进 commit 形态（`area=commit&hash=…` 走通并回 `area:'commit'`，`area=commit` 缺 hash 是 bad-request）；客户端 2 项（详情列的文件行是 BUTTON 且点开切到 diff 标签、读的是 `commit:<oid>:<path>@3`、`data-diff-area='commit'`，而列表与详情列仍挂在背后；commit diff 在变更列表刷新后**不被收起**、工作区变动**不重读**、ref 一动**才重读**） |

### 验收期改动：底部 pane 的 diff 标签（2026-09-12，产品方提出）

顺序 5 交付后产品方看完实际观感提了四条，全部是对**标签条**的反馈；其中「怎么关某一条」在第二轮又改了一次口径。

| 要求 | 处置 |
|---|---|
| **diff 要能多开** | 一次只有一个 `OpenFile` 的模型换成一张列表：`openFiles`（按打开顺序）+ `tab: BottomTab \| null`（`{kind:'history'} \| {kind:'file', key}`），两个状态都交给 `StatusPanel`（打开一个 diff 本来就是这个面板的决定），`BottomPane` 变成受控的标签条。一个文件一条标签，**每条都保持挂载**（切回去是一次重绘而不是一次 git 调用）；已经打开的文件再点一次不会重复开。折叠语义不变：`tab === null` 就是折起，点当前标签仍然是「收起来」 |
| **删掉标签上那个常显的 ×** | 标签条不再给每个标签挂一个常显的关闭按钮。**第二轮修正**（产品方：「hover 到标签条上的某个 tab 时候，显示 × 进行关闭；差异操作这行就只进行差异操作」）：关闭控件**回到标签上**，但只在 hover / `:focus-within` 该标签时显形（隐藏时保留宽度，所以显形不会把标签顶动），并且**每个 diff 标签各有一个、名字带文件路径**（一排 aria-label 都写「关闭差异」对读屏等于没说）；同时把 **diff 自己那行的 × 删掉**——布局切换与刷新留下，关闭不再混在里面。折叠语义不变：关掉一条时邻居接任，关掉最后一条回到历史并**保持展开**——用户关的是一条 diff，不是这个面板 |
| **diff 标签也要有「最近提交」active 时那条蓝线** | 这是**真 bug**：`data-active` 原本挂在装着标签与 × 的 `span` 上，而画线的规则是 `.bottomTab[data-active='true']`，所以 diff 标签永远拿不到下划线。现在属性挂在标签按钮自己身上，**复用同一条规则**（产品方原话：能复用就复用），并且把这条加进回归测试 |
| **文件名超长要省略** | 三处都补齐：标签（`.dgp-bottom-tab` 已有 ellipsis，现在配 `flex: 0 1 auto` + `min-width: 44px`，标签过多时标签条自己横向滚动，历史标签用 `data-resident` 保证不被挤走）、diff 头部路径、以及既有变更行路径。后两处原来 `flex: none` 谁也缩不了，等于被容器硬裁；现在**目录的收缩权重是文件名的 100 倍**（`flex: 0 100 auto` vs `flex: 0 1 auto`），所以先丢目录（FR-1.2），只有在名字自己都放不下时才省略它 |
| **左右对照必须固定两半、越界要有滚动条** | 两轮修正。第一轮：`.diffRow`/`.diffCell` 的 `min-width: min-content` 让网格轨道的自动下限跟着内容走，长行会把两半撑得不相等、右半被推出面板（「左右 diff 视图，固定分为左右两半区。现在有越界的情况」）。改成零下限后发现只剩「裁掉」一条路，产品方当场否掉（「合理在哪。如果有超出去的话在底部加滚动条」）——**这两条要求只有一种形状同时满足**：两半固定各占 50%（`flex: 1 1 50%`），**每一半各自是一个滚动容器**（`overflow: auto`），长行的横向滚动条出现在超出的那一半底部。于是左右对照不再是一个滚动器 + 每行两格，而是 `<SplitHunks>` 渲染的**两个半栏**：每栏各自渲染 hunk 头与「每行一格」，并由组件在两轴上都保持同步（纵向不同步 = 配对错位，横向不同步 = 两栏看的不是同一列）。配对与行高靠两件事保证：两侧渲染的是同一个 `splitRows` 序列，且每个格子都有 `min-height: 18px` 的行盒下限（补空格子与空行在 `width: max-content` 下必须一样高，否则两栏会逐行漂移）。**分界线是一条 16px 的「车道」**（`.diffSplit` 的 `gap`）加右半栏的 hairline：它在**两个滚动器之外**，所以不会被任何一侧的横向滚动推走——正是行操作按钮需要的落点（与某一行同排、纵向跟着两栏走、横向永不被长行拽偏）。产品方原话：「分界线处加点间距吧。预留行操作的空间」。**上下对照不变**：整行完整、由面板自己横向滚动 |
| 测试 | +8 项（436 总计）：多开两条 diff 各自一条标签且都挂着、切回来不重读；显示中的标签带 `data-active`、每个 diff 标签各有自己的 × 而 diff 头部只剩三个差异操作；按标签上的 × 只关它自己、邻居接任、最后一条回历史且面板仍展开；Escape 只关屏幕上那条（隐藏的 diff 虽然挂着但不再监听 document）；样式表断言五处 ellipsis 与两对收缩权重；样式表断言标签的 × 藏到 hover / focus 才显形；左右两栏的行为（两个半栏、行号与 removed/added 配对、重开仍是 8 个格）；两栏滚动同步（拖一边，另一边横纵都跟上，且不会回弹）；样式表断言两个半栏各自 `overflow: auto`、格子 `width: max-content` / `min-width: 100%` / `min-height: 18px`、上下对照仍保留 `min-content` |

### 顺序 6 交付：复制类条目（2026-09-12，已完成）

§9②③ 的五条复制项，两条菜单各自补齐；全部是客户端动作，零新增路由、零 git 进程。

| 落点 | 内容 |
|---|---|
| `ui/clipboard.ts`（新） | `writeClipboard(text)`：Clipboard API 优先，`execCommand('copy')` 回退（隐藏的只读 textarea + 选中），两者都没有就返回 `false`。**不抛异常**——拒绝的写是普通答案，调用方才有机会在列表旁说一句。手写而不是包 primitives 的 `writeClipboard`，因为 `ui/**` 不能命名 DSH 包（依赖方向第 3 条），而 `navigator`/`document` 本来就是 ui 直接用的浏览器能力 |
| `core/format.ts` | 新增纯函数 `repoAbsolutePath(root, path)`：按根自己的分隔符风格拼接（见 D39②）。`pathParts` 的邻居，同样是「有对错的小推导」 |
| `core/ports.ts` + `ui/error-copy.ts` + `locales.ts` | `GitErrorCode` 新增 `clipboard`；`errorCopy` 为它写一句面板自己的话（没有 git 原文可转述）；文案 +6 键（中英）：`copy.relativePath` / `absolutePath` / `shortHash` / `fullHash` / `message` / `done`，以及 `error.clipboard` |
| `ui/History.tsx` + `ui/BottomPane.tsx` | 提交行的菜单**不再只挂最新一行**：每一行都有，`onCommitMenu(commit, anchor, canUndo)` 把「这一行是不是最新」作为参数说出来——FR-3.8 的「仅最新一条」改由**条目**表达（`canUndo`），不再由「有没有菜单」表达。`CommitRow` 的 `onMenu` 仍在没有菜单主人时保持缺席（`undefined` 就不拦原生右键菜单），只是现在**每一行都会拿到一个** |
| `ui/StatusPanel.tsx` | `copyToClipboard(label, value)`：成功走既有的成功通知（`data-action-done="copy"`），失败走既有的错误框（`code: 'clipboard'`）——**不经过 `perform`**，因为复制不是仓库操作，没有要重读的东西。文件菜单 = 该行暂存动作 → 分隔线 → （可丢弃时）放弃更改 → 分隔线 → 复制相对路径 / 复制绝对路径；提交菜单 = 复制短哈希 / 完整哈希 / 提交信息 → （`canUndo` 时）分隔线 → 撤销此提交（仍是 `stayOpen` 的武装条目） |
| 三处有意的收窄 | ① **「复制提交信息」复制 subject 首行**：`CommitInfo` 只带 `%s`，提交正文从没上过线；要全文得让 host 多读一次 `%B`，与顺序 6「纯客户端」的定位相悖（记在 D39②）。② **「查看提交差异」没有做成菜单条目**：它在顺序 5 里由详情列的文件下钻承担，同一句话不需要第二个入口。③ **提交菜单里没有「复制完整信息」之类的合并项**：一行一条，条目名字就是它复制的东西 |
| 测试 | +7 项（443 总计）：`format` 3 项（拼接、根带尾部分隔符不重复、Windows 根跟随自身分隔符）；客户端 4 项（文件行菜单复制相对/绝对路径各自写对的内容并给出通知；提交菜单每一行都有三条复制项、只有最新行多一条 danger 的撤销，且复制的确是「这一行」的值；剪贴板拒绝时错误落在列表旁且列表原样；**语言切换后同一条通知用新字典重渲染**）。顺序 3 的既有验收测试按新契约重写（旧断言「老行没有菜单」不再成立，「老行不能撤销」改为断言菜单里没有 danger 条目） |
| **验收期修正：动作反馈改存「键」而不是已翻译的字符串**（2026-09-12，产品方实测报来） | 症状：**英文模式下通知显示「已复制：…」**。真因与复制无关：DSH 的 `t` 是**每次调用都读当前字典**的活函数（`client/adapter/locale.ts` 的注释与 `dsh-client-ui-renderer` 的 `localeSeat` 都这么说），而 `action` 状态里存的是**渲染好的字符串**——在中文下复制、再切到英文，那句通知就冻在中文，而菜单等其它文字全都跟着切了。这是一整类问题：所有操作通知、失败框标题与 AI 截断提示都一样。修法：`ui/translate.ts` 新增 `Sentence`（`{kind:'key', key, vars}` 或 git 原文的 `{kind:'raw', text}`）与 `say` / `verbatim` / `sentence`；`StatusPanel` 的 `ActionState.label`/`summary`、`aiNote`（连带 `CommitBox.aiNote` 的 prop 类型）全部改成 `Sentence`，**渲染时才查字典**，于是语言一切换整块反馈跟着重译。git 自己的 `master -> master` 仍走 `raw`——那是 git 的语言，不是面板的字典 |
| 修正的代价与边界 | ① **状态里不再是人能直接读的字符串**：`data-action-done` 的属性不变，但调试时看到的是 `{kind:'key',…}`（这是必要代价：`t` 活在渲染里，状态里存文本就一定会冻）。② **`errorCopy` 早就是渲染期计算的**（`failure` 在每次渲染现算），所以失败**正文**本来就会跟着切，这次只补齐了标题与成功通知。③ 没有做「语言切换时清掉反馈」那种更省事的替代：通知是刚刚发生的事的记录，切换语言不该把它抹掉，只该把它改说一遍 |

### 顺序 7 交付：提交图 SVG 泳道（2026-09-12，已完成）

FR-7.1 的三条要求（分叉开道、合并收道、分页不断线）落成一个 core 纯函数加一层渲染，
**零新增路由、零新增 git 进程**——`parents` 从 M1 起就随 `log` 一起读了。

| 落点 | 内容 |
|---|---|
| `core/commit-graph.ts`（新） | `buildGraph(commits)`：一趟从新到旧的分配，返回与提交等长的 `GraphRow[]`。每行给出 `lane`（节点所在列）、`from`（从上一行进来的车道）、`to`（往下一行走的车道）、`edges`（跨车道的父链，合并/汇合各一半）、`lanes`（本行占的列数）。规则：车道的槽位存「下一行该出现的提交 oid」，某个提交先被某个更靠上的子提交点名时就落在那一道（首父保直、其余父开新道），首父已被别的子提交占用时当前道就此结束、连线横跨过去（合并回收）。**尾部空槽每行裁掉**，好让一次宽合并不替后面整段历史保留列；已被引用的车道索引不动，这正是渲染可以把车道当固定列的前提。前缀稳定是它最关键的性质：处理到第 i 行只用到第 0..i 行，所以对全部已加载提交跑一次，翻页只会把图**延长** |
| `test/commit-graph.test.ts`（新，6 项） | 空历史；线性史一条道、首发与根各自开合；合并开道且第二父的线在 `base` 处汇回；首父已在他道时合并回收进那道；无人点名的 tip 自己开道；**分页：`buildGraph(前两行)` 深等于 `buildGraph(全史)` 的前两行** |
| `ui/History.tsx` | `GraphCell` 每行一个内联 SVG：`from` 画 `0%→50%`、`to` 画 `50%→100%`、`edges` 画 `50%→100%` 的斜线（颜色按**目标**车道取，与下方竖线同色）、节点是 `cy="50%"` 的圆。y 用百分比且不设 viewBox——行高由文字决定，百分比让线段在不知道高度时也连得上。`HistoryPanel` 对**整个已加载列表**跑 `buildGraph`，再把所有行的最大 `lanes` 取成一个共享宽度（上限 8 道）下发到每一行；`commitRow` 由纵向 flex 改成横向，文字两行收进新的 `commitLines`，图是它的兄弟（故「标题里没有前导字形」这条性质不变） |
| `ui/styles.ts` | `.commitGraph`（`flex: none; align-self: stretch`，宽度由组件内联给同一个值）+ `.commitGraph svg { display: block }`（行内 SVG 会坐在文字基线上留出降部空隙，把节点推离中线）+ `.commitLines`（承接原来按钮上的两行与 1px 间距）。`.commitRow` 的 `flex-direction` 由 column 改成 row |
| 测试 | +11 项（456 总计）：core 6 项（上表）；客户端 5 项——单条线性提交只有节点、条带是行的子元素且 `aria-hidden`、标题首子元素仍是 hash；合并行的第二父从 lane 0 斜到 lane 1 且用的是目标道的墨色、第二父的行在 lane 1、汇合后 base 回 lane 0、**所有行预留同一宽度**、**新开的 lane 只有那条斜线、没有竖直残桩**；**「普通提交 → 合并 → 两个父」恰是三段**（lane 0 进/出 + 一条斜线，下一行两车道继续）；**加载下一页后第 1 页的图形逐字节不变、第 2 页首个提交落在第 1 页为它开的 lane 1**；样式表断言条带 `align-self: stretch` / `flex: none`、SVG `position: absolute`（在流里会退回 300×150 固有高度、把每行撑到 ~150px）、按钮无上下内边距而文字列带 `4px 0 5px`（否则泳道按行断开） |

### 验收期新增：获取所有远程 fetch（2026-09-12，产品方提出）

不在文档的 FR 清单里（FR-5.1 只有拉取 / 推送 / 同步），是产品方要求补的第四个同步动作，见 D42。

| 落点 | 内容 |
|---|---|
| `core/ports.ts` | 服务端口与客户端端口各加一个 `fetch(sessionId, signal?)`（排在 `pull` 与 `sync` 之间）。它能改的只有 `refs/remotes`：工作区、索引、当前分支都不动 |
| `host/git-service.ts` | `fetchRemotes`：先 `git remote` 问一次（列表为空 → `bad-request`「this repository has no remote to fetch from」），再 `git fetch --all`（写操作，`optionalLocks = true`），审计记一行。**不传 `--prune`**（理由见 D42） |
| `host/adapter/routes.ts` | `fetch` 进 `WRITE_OPERATIONS`（GET 405、跨源 403、同源校验、loopback 全照旧），`dispatchOperation` 加一条 `case` |
| `client/adapter/git-client.ts` | `fetch` → `POST /git-panel/fetch`，与 push/pull/sync 同一形状 |
| `ui/icons.tsx` | `FetchGlyph`：**虚线 ↓**（箭杆与箭头各 `strokeDasharray="2.4 2.4"`），与实线下箭头的「拉取」在形状上分开——两者都是「有东西下来」，虚线那支下来的只是对远端的认识 |
| `ui/StatusPanel.tsx` | 分支行第四个传输按钮，紧挨「拉取」左边。**无前置条件，只随 `busy` 禁用**：游离 HEAD、未出生分支、没有上游都能获取，这正是它与 `pull` 的差别；`ActionOp` 加 `fetch`，成功通知带 `data-action-done="fetch"`，失败落在既有的错误层（无远程那句原样可见） |
| `locales.ts` | +2 键（中英）：`action.fetch` = 「获取所有远程」/「Fetch all remotes」 |
| 测试 | +6 项（462 总计）：服务层 3 项真仓库——fetch 让 `refs/remotes/origin/<branch>` 前进而 `HEAD` 与工作区不动、`behind` 由 0 变 1；**两个远程的跟踪 ref 一起被取到**（`--all` 的证明）；无远程是 `bad-request` 而非静默成功。路由 1 项（POST 走通并真的写出远程跟踪 ref + GET 405）。客户端 2 项（第四按钮的 `aria-label`、点击调用 `git.fetch`、成功通知；无远程的拒绝落在列表旁且变更列表原样）。既有的 `syncButtons()` 助手改成 `railActions()`（分支行前四个 `.tool` 按钮），三处按序解构与两处按下标取按钮的既有用例随之更新 |

**为什么远程分支仍不在选择器里**：`branches()` 只读 `refs/heads`（FR-4.1 原文就是「列出所有本地分支」），`refs/remotes` 目前只服务于刷新探测与 ↑↓/○●。所以按一次获取看得见的变化是这三处计数与标记，而不是列表里多出 `origin/xxx`；要让远程分支可选（并在选中时建跟踪分支）是另一项工作，登记在 §12。

### 验收期改动：操作反馈改成悬浮通知（2026-09-12，产品方提出）

产品方要求：「把通知作为悬浮的一层，过指定时间自动关闭」，并确认**成功与失败都浮起**（失败要手动关）。
原文的「就地显示」因此改为「浮在该操作所在区域的上方」，见 D40。

| 落点 | 内容 |
|---|---|
| `ui/notice.tsx`（新，通用件） | `Notice`：一层 —— 顶部贴状态栏、盖在列表上、`position: absolute` + `z-index: 4`；两种终身期由 `durationMs` 表达（`null` = 等到按 ×）；`role` 成功是 `status`（可错过）、失败是 `alert`（要打断）。定时器的依赖是**通知自己的文字**：换了一条通知就重新计时，同字重渲染不重置——因此调用方必须传**稳定**的 `onDismiss`（面板用 `useCallback`，注释写明了原因）。`op` 决定它挂 `data-action-done` 还是 `data-action-error`，测试与 QA 因此仍按「哪次操作」找它 |
| `ui/styles.ts` | 新增 `.dgp-notice` / `-head` / `-lines` / `-line` / `-body` / `-detail`；删掉列内的 `.dgp-action-box` / `-head` / `-notice`（`actionLabel` 留下，成为失败通知的 kicker「Pull · failed」）。卡片是 `flex-direction: column`，**头部（kicker + ×）不滚动、正文（git 多行 + 捷径按钮）自己滚**，所以长输出滚动时 × 仍在；顶部偏移用 `RAIL_HEIGHT + 8` 插值，与面板的高度预算同一份常量 |
| `ui/StatusPanel.tsx` | 两处列内反馈都换成 `<Notice>`：成功传 `NOTICE_DURATION_MS`（4s），失败传 `null` 并把「贮藏后切换到 X」作为 `children`。`dismissNotice` 与其它 hook 放在一起（首读返回早退，hook 数不能随渲染路径变）。**`dismissNotice` 必须是稳定引用**，否则每次重渲染都重置 4 秒——面板每次仓库变化都会重渲染 |
| 测试 | +2 项（445 总计）：成功通知是 `absolute` 的层、列表仍在底下、差 1ms 还在、到点消失；失败通知不随时间消失、`data-multiline` 的多行原文进了层、只有 × 能关掉它。两项都用 `mock.timers` 驱动通知自己的时钟（`click()` 尾部的 `flush()` 依赖真实 `setTimeout`，所以测试里改用一个不 flush 的按下助手） |

### 10.3 M5 之外登记在案、尚未排期

| 事项 | 说明 |
|---|---|
| **非仓库时的「初始化仓库」按钮**（§4.3 空态引导） | 现在只有一句 `noRepo.hint` 文案，文档要求一个执行 `git init` 的按钮 |
| **通知时长接进 DSH 设置**（D40 的尾巴） | 现在 `NOTICE_DURATION_MS = 4000` 是面板传给 `Notice` 的固定值。要「在设置里自定义」得先有插件的配置面：DSH 的 `settings.section` 槽（`@deepseek-ai/dsh-client-ui-settings`）注册一张卡，host 侧要有 settings 命名空间与一对读写路由（better-sidebar 的「Side card」是现成例子）。产品方 2026-09-12 决定：先不做，等真有功能需要设置时一起加；在此之前要改时长就改代码里的常量 |
| **上下方向键导航文件列表**（§4.3 键盘，P1） | `Ctrl+Enter` 与 `Esc` 已有，这条没有 |
| **diff 虚拟滚动**（§6 性能 P1） | 现靠 FR-2.6 的 >5000 行折叠门兜底；千文件仓库 `status < 500ms` 与 monorepo 也仍未压测 |
| **gpg 签名卡死的专门文案** | `commit.gpgsign=true` 的仓库里提交会卡到 15s deadline，`GIT_TERMINAL_PROMPT=0` 管不到 gpg（§11 新增行） |
| **凭据缺失的专门文案** | push/pull 目前只报 git 原文，没有分类（§11 新增行） |

### 10.4 不排期（等条件，不是代码工作量）

- **D21 冲突行「打开文件」**：本 profile 的 `dsh-better-sidebar` 对外只有
  `registerTab`/`registerFileViewer`/`registerFileIcon` 三个缝，没有「按路径打开文件」；
  等上游出现这个缝再做，本插件没有绕过去的正当办法。
- **浏览器目视验收**：M3/M4 的全部 UI 行为只有 jsdom 覆盖，**从未在真实浏览器里看过**
  （M3、M4 两个会话与本次会话的 `browser_*` 都返回 “no usable browser provider is
  registered”）。这是产品方的验收动作，不是本插件的待办。
- **https/ssh 的 push/pull、同步盘/网络盘上的 watcher、真实 provider 的 AI 提交信息**：
  各自需要独立环境才能验，§11 已逐条登记。

---

---

## 11. 风险与开放问题（对应文档 §8）

| §8 | 现状 |
|---|---|
| 1 client-plugin API 稳定性 | **已证实是真问题**：本 profile 里装着 `@dsh-plugin/dsh-loader`，它的存在理由之一就是 `httpServer` 被改名为 `webServer`。防腐层正在起作用——DSH 变更的改动面被收口在 `adapter/` |
| 2 watcher 可靠性 | **主路径已改为文件系统事件**（见 D25）：工作区递归 + git 目录各一个 `fs.watch`；D4 当初的顾虑（同步盘/网络盘上事件不可靠）仍成立，因此保留 `pollStrategy` 作为回退——它也是唯一会轮询的地方，并在自己的节奏上补报 `worktree`。**两条路径都未在真实的同步盘/网络盘上验过**；`fs.watch` 递归建立失败（inotify 上限/平台不支持）会自动降级 |
| 3 AI 提交信息成本 | **已按文档落成**：只有 ✨ 被点才生成，`MAX_PROMPT_DIFF_CHARS = 12 000` 截断、`maxTokens = 512`、60s 截止。**未用一个真实 provider 跑过**——测试用的是桩模型（提示词、清洗、失败分类都验了，真实模型的措辞质量与延迟没验） |
| 4 大仓库性能 | timeout 15s + `truncated` 标记已就位；**未在真实 monorepo 上压过** |
| 5 兼容层的代价 | 接受。代价是简单功能也要过一道 ports；收益是 `core` 能在裸 Node 里测试 |
| 新增 | **第三方 `webServer` 路由不在 DSH 鉴权范围内**（见 D6/§7）。凡是注册路由的插件都要自带网关 |
| 新增 | **`commit.gpgsign=true` 的仓库里，面板提交可能卡在 gpg 密码提示上**，直到 15s deadline。`GIT_TERMINAL_PROMPT=0` 管不到 gpg。M2 不传 `--no-gpg-sign`（那会静默产生未签名提交，比超时更糟）；待办是识别这个失败并给出「请检查签名配置」的具体文案 |
| 新增 | **凭据缺失的 push/pull 只报 git 原文**（`could not read Username … terminal prompts disabled`）。够用，但没有专门文案；等 M4 做远程同步完善时再分类 |
| 新增 | **`push`/`pull` 会走真实网络**，测试里只覆盖了 file transport 与裸仓库；https/ssh 未实机验证 |
| 新增 | **插件首次有运行时依赖**（`vscode-diff`，MIT、零依赖，见 D12）。host bundle 仍 `packages: 'external'`，运行时由 profile 的 node_modules 解析；client bundle 不引用它（构建的产物纯度检查会挡住意外引入）。换实现或升级只影响 `core/diff-engine/marks.ts` |
| 新增 | **`llm`/`agentDefaultModel` 故意不在 `inject` 里**：面板在没有模型的 composition 里照样挂载，只有 FR-3.5 那个按钮返回 `no-llm`。代价是这条路径的类型安全靠 `ctx.get()` 的松弛签名兜底，而不是靠 cordis 的依赖声明 |
| 新增 | **合并态靠 `stat MERGE_HEAD` 判断**（与 watcher 同一套 `gitDirOf` 假设）。如果某个 git 把合并态放在别处（rebase 用 `rebase-merge/`），当前的 `merging` 就只是「合并」这一种；rebase/cherry-pick 的状态栏不在 M4 |
| 新增 | **`--numstat` 的 rename 归并是启发式**：`a => b` 与 `src/{a => b}.ts` 两种写法都覆盖了（有真实字节 fixture），但文件名里本身就含 ` => ` 的极端情况会归错。代价可接受：它只影响详情列表显示的名字 |
| 新增 | **M4 的新写操作都经过与 M2 相同的网关**：POST + 同源 + 1 MiB body 上限 + loopback，破坏性的两个（删分支、中止合并）额外要两次点击。`generateCommitMessage` 也走 POST，因为它花的是模型预算 |
| 新增 | **分支名/基点/哈希的校验在 core**（`validateBranchName`/`validateBranchBase`/`validateHash`）。基点**只**接受本地分支名或 4–40 位小写 hex，因此 `HEAD~1`、`origin/main^{commit}` 这类表达式一律拒绝——面板不替 git 解释语法 |
| 新增 | **diff 没有虚拟滚动**（§6 性能 P1）：>5000 行默认折叠（FR-2.6），展开后整块渲染。千行量级在 jsdom 与手工构造的输入上没发现问题，**未在真实大文件上压过** |

---

## 12. 与同 profile 另一个 git 插件的分工

同一个 web profile 里装着 `@linxin666/dsh-client-ui-git-graph`（v0.3.20，成熟第三方
插件）。两边**都**在右侧栏出现、**都**用分支图标、名字都带「Git」，因此很容易被当成
同一个东西。它们其实是**两套几乎不相交的功能**，各自注册自己的路由前缀：

| | 本插件 `/git-panel/*` | 它 `/git/*` |
|---|---|---|
| 变更列表 | ✅ 三组 + 冲突组 | ✅ `/git/status` |
| **暂存 / 取消暂存（含分组批量）** | ✅ | ❌ 无对应路由 |
| **提交（范围显式化，含 `add -u` 分支）** | ✅ | ❌ |
| **推送 / 拉取 / 同步** | ✅ | ❌ |
| **获取所有远程（fetch，不带 prune）** | ✅ 验收期新增（D42） | ❌ 无对应路由 |
| 提交图谱 | ✅ M5b（FR-7.1，§10.2 顺序 7 已交付） | ✅ `/git/graph` |
| 切换 / 新建 / 删除分支 | ✅ M4（FR-4；含未合并分支的强制删除） | ✅ `/git/switch`、`/git/create-branch` |
| 放弃更改 | ✅ M5a（FR-6.1，顺序 2 已交付） | ❌ 无对应路由 |
| 贮藏 / 撤销提交 | ✅ M5a（FR-6.2 顺序 4、FR-3.8 顺序 3） | ❌ 无对应路由 |
| 工作树隔离、设置卡 | ⬜ 非目标 | ✅ `/git/worktree-*` |
| 输入框分支胶囊（空白会话） | ⬜ 非目标 | ✅ |
| diff 视图 | ✅ M3（FR-2，inline/左右 + 逐词高亮） | ❌（其 README 未声明） |
| 遥测 | **无**（不外发任何数据） | 每 UTC 日一次匿名安装心跳（其 README 声明） |

结论：不是「谁是谁的子集」，而是**文档 §1.2 指出的那个缺口仍然成立**——它给了
分支/图谱/工作树，但没有「常驻侧边栏 + 可写提交」这条闭环；本插件的 M2 正是补这条。
反过来它的图谱对应本插件的 M5b 顺序 7，**已交付**（本插件多给了一列：每行的状态字母与类型图标）；分支管理那半
已由 M4 补齐（见上表），而放弃更改 / 贮藏 / 撤销提交这一组两边都没有，是 M5a 的地盘——
三个都已在 M5a 里交付（顺序 2、4、3），也就是「两边都没有的那一半，本插件先有了」。

命名上如果要更清楚，可把本插件 tab 从「Git」改成更具体的名字（`type.label`），
但它出现在右侧栏、以「Git 变更」为引导条目名，与它那个输入框胶囊不在一处，
实际不易混。**不要**为了避开它而改 `kind`/`id`：`id` 是本体注册的 key
（`sidebar.right.pane.tab` 的 key），改名等于让已打开的标签失效。
