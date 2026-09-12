# 执行计划 · dsh-git-panel

本文件跟踪 `docs/requirements.md` 的实现进度。

`docs/requirements.md` 是需求文档 v0.2 的**逐字节副本**（20 778 字节，sha256
`f42d4277a71c1951ce1df9d2b9a8277428b0e5c6de2ff92109d036171e229d09`，与原始
附件一致）。它是规格，**只读、不要就地编辑**：要改就先出 v0.3 版本再整体替换，
否则「规格」和「实现」会一起漂移，这份计划也就失去了参照物。

需求文档是**唯一规格来源**。本文件只记录「做到哪、怎么做的、和文档哪里不一样、
下一步做什么」；两者冲突时以需求文档为准，并把差异登记到下面的
「与需求文档的偏差」。

- 代码：`src/`（42 个源文件）、`test/`（14 个测试文件）
- 校验：`npm run check` → `tsc --noEmit` + 282 项测试 + 两个打包产物

---

## 1. 状态总览

| 里程碑 | 内容 | 验收标准（文档 §7） | 状态 |
|---|---|---|---|
| **M0** | core 骨架（types/ports/git-parse）+ host/client adapter + 依赖方向规则 | 解析器测试全绿；adapter 目录是唯一碰 DSH API 的地方 | ✅ 完成 |
| **M1** | host service + status/log/branches 只读 + sidebar tab 渲染变更列表 | 面板能看到当前仓库变更分组与分支 | ✅ 完成并在 GUI 中确认 |
| **M2** | stage/unstage/commit/push/pull/sync + 提交框 + 历史 | 不碰终端完成 改→暂存→提交→推送 全流程 | ✅ 完成（`npm run check` 全绿；重启 `dsh web` 后确认加载的是 M2 构建：`POST /git-panel/stage` 被接受，两个产物含 M2 文案且构建时间早于进程启动时间。界面控件未由我目视确认——本会话的 `browser_*` 工具一律返回 “no usable browser provider is registered”） |
| **M3** | diff 视图 + 逐词高亮 + 布局切换 | 点文件可见 VS Code 级 diff | ✅ 完成（`npm run check` 全绿：192 项测试——15 项 diff 解析/逐词、8 项 host diff 服务 + 路由、15 项 DiffView/BottomPane/分组操作交互；两个产物重建。**重启后的运行实例已端到端核对**：用真实 session 打 `/git-panel/diff`，worktree / index / 未跟踪 / 二进制逐条验过，证据见 §8 末。**浏览器里的观感仍待人工看一眼**——本会话的 `browser_*` 工具一律返回 “no usable browser provider is registered”，交互行为由 jsdom 测试覆盖） |
| **M4** | 分支新建/删除/切换、冲突态 UI、AI 提交信息（+ 提交详情初步） | 分支管理与同步全在面板内闭环 | ✅ 完成（`npm run check` 全绿：268 项测试；三项收窄 D20–D22。分支/合并/详情在**真实仓库**上跑通，AI 生成用**桩模型**验证了提示词与清洗，唯一没验的是浏览器里的观感——本会话 `browser_*` 工具仍返回 “no usable browser provider is registered”） |
| **M5a** | 行级菜单机制、discard、撤销最近提交、stash（贮藏） | 破坏性写操作全部经「点击武装」确认 + 审计（文档 §7 的 M5 按 D24 拆分） | ⬜ 未开始（**下一步**） |
| **M5b** | 提交图、提交详情下钻单文件 diff、多仓库、提交改写 | 发布 v1.0（文档 §7 原文） | ⬜ 未开始 |

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
| **D4** | FR-1.4「mtime 监听 + 面板可见时 10s 轮询，不可见时停止」 | 订阅期间按 1s 轮询 `.git/index`/`HEAD`/`packed-refs` 等；「可见」表达为「存在 SSE 订阅者」 | 文档 §8.2 自己指出 mtime 监听在同步盘/网络盘不可靠，故只做轮询不做 `fs.watch`。「停止」由浏览器断开 SSE 实现——没人看时不花任何代价。轮询 1s 而非 10s，以满足 §4.4「1s 内自动反映」 |
| **D5** | FR-3.7 历史分页显示总数，上限 500 | 多取 1 条判断 hasMore；`total` 故意为 `null` | 算总数需要 `git rev-list --count HEAD`，在大 monorepo 上要遍历全部历史（秒级），只为显示一个「加载更多」不需要的数字。上限 500 已实现 |
| **D6** | §5.5 安全需求（假定路由在 DSH 鉴权之后） | **额外**加了 loopback-only 网关 | 实测：`/` 无凭据返回 401，而插件注册的 `/git-panel/*` 返回 200——DSH 前端鉴权不覆盖第三方 `webServer` 路由。详见 §6 |
| **D7** | FR-1.2 路径过长截断目录（隐含字符预算实现） | 用 CSS flex：文件名不收缩、目录可裁切 | 侧栏宽度可变，字符预算需要测量容器；CSS 在任意宽度下都正确。因此删掉了已写好的 `shortenPath()` 纯函数，不留无人调用的代码 |
| **D8** | FR-5.1「同步 = pull --rebase=false + push」 | 实现为 `git pull --no-rebase --no-edit` | 两条 flag 都是「不要等一个不存在的终端」：`--no-rebase` 让分叉的 pull 产生合并提交（文档自己的措辞），而**分叉时必须合并**意味着 git 会要一个提交信息——没有 `--no-edit` 它会等到 15s deadline 被杀掉（已实测）。**代价**：忽略用户 `pull.rebase=true` 的偏好；分叉时留下一个合并提交 |
| **D9** | §5.5 假定路由在 DSH 鉴权之后 | **写入路由额外**加同源（`Origin` ↔ `Host`）校验 | loopback 只挡别的机器，不挡别的页面：本机任何网页都能向 `POST /git-panel/*` 发请求。写在 200/400 之前，跨源一律 403。无 `Origin` 的请求（curl、测试、自带工具）放行，由 loopback 兜底 |
| **D10** | §5.4 服务契约未规定传输细节 | 读用 `GET`（session 在 query），写用 `POST`（session + 参数在 JSON body）；**body 形状错也算操作失败**，与业务失败一样走 200 + 信封 | 前端只有一条错误路径（信封），这是本文件一以贯之的选择（见 `routes.ts` 头注释）。只有「body 根本不是 JSON」「没有 session」「方法不对」「跨源」才用非 200 |
| **D11** | §5.5 要求「所有 git 参数校验形状」 | M2 只实现**真的有调用方**的两个校验：路径、提交信息；hash/分支名校验留到 M4/M5a 使用它们的操作一起写（M4 已带来分支名、基点与 `showCommit` 的 hash；`undoCommit` 的 hash 校验到 M5a 才有第一个调用方，见 §10.1） | 遵循 D7 的同一条理由（不留无人调用的代码）。`.git` 路径是**额外**加的：`git status` 永远不报告它，所以只可能是手写请求——正是要挡的那种 |
| **D12** | §5.3「移植 VS Code `DefaultLinesDiffComputer` 入 core」 | 改为**依赖** `vscode-diff@^3.0.1`（MIT、零运行时依赖，就是那个引擎的抽取版），并给 `core` 的「零外部 import」守卫开一个**具名白名单**（`test/dependency-direction.test.ts` 的 `CORE_ALLOWED_PACKAGES`） | 手写同构算法只能复刻 Myers 搜索，复刻不了它上面那层启发式（丢短匹配、extend-to-word、把变更块细化到字符区间），而那层才是「VS Code 级」的实际含义。该包零依赖、纯 TS，`node --test` 仍能直接跑 core，所以守卫要保护的性质没变。**代价**：插件首次有运行时依赖（host bundle 仍 `packages: 'external'`，由 profile 的 node_modules 解析；client bundle 不引用引擎，浏览器打包规则不变） |
| **D13** | §8「`core/diff-engine/`：输入两段文本，输出行级 hunks + 逐词区间」 | 行级 hunks 由 **git** 产出、`core/diff-parse.ts` 解析；引擎只负责**一个变更块内部**的逐词区间与行对齐（`diff-engine/marks.ts`） | git 的行级 diff 尊重 `.gitattributes` 过滤器、rename 检测、二进制嗅探，且不需要把整文件读进内存；引擎做 git 不报告的那部分。VS Code 自己也是「diff computer / renderer」这样分工 |
| **D14** | FR-2.6「单文件 diff 超过 5000 行时默认折叠，点击加载」 | 响应里是两个**不同**的字段：`large`（行数 > `MAX_DIFF_LINES = 5000`，内容完整，客户端默认折叠、点「加载」展开）与 `truncated`（撞 host 字节上限，尾部确实没读到，只能提示） | 把两者合成一个布尔，会让「加载」按钮承诺一段根本没读到的内容。文档说的「在响应里标记而不是在 host 里折叠」照做：host 只计数，折叠是渲染决定 |
| **D15** | FR-2.2「未跟踪文件按全新增渲染」 | worktree 侧 `git diff` 空输出时，先探 `git ls-files --error-unmatch -- <path>`：tracked 才算「无改动」；否则用 `git diff --no-index -- /dev/null <path>` 重取一次，得到全新增的 diff（它退出 1 是「有差异」的正常答案） | `git diff` 不区分「未跟踪」与「无改动」，只有前者该渲染成全新增。**代价**：未跟踪文件走 `--no-index`，不经过 `.gitattributes` 过滤器（未跟踪文件本来也没有索引态可归一） |
| **D16** | FR-2.2 未区分冲突文件的 diff | `diff --cc`（`@@@` 两列前缀）被识别为 `combined` 并整段跳过，客户端显示「合并差异暂不支持」 | 那是另一套语法，按 unified diff 硬读会凭空造行。冲突渲染本身是 FR-9，排在 M4 |
| **D17** | §5.4 未规定 `diff` 的命令形状 | 固定 `--no-color --no-ext-diff --no-textconv --unified=N`，context 夹在 0–50 | 用户自己的 diff 配置会毁掉解析：外部 driver 输出解析器读不懂的语法，textconv 会把二进制文件转成文本——正好违反 FR-2.5 |
| **D18** | §4.2 布局：分支行 → 提交框 → 变更分组 → 历史 | 基准是 VS Code 源代码管理视图，最终为：分支行 → **已暂存的更改（抽屉，常驻）** → **提交框** → **工作区列表**（冲突/更改/未跟踪）→ **底部 tab 区**（最近提交 / 所选文件的 diff）。中间经历过几版被推翻的顺序，以本行为准 | 产品方在 M3 验收后逐条调布局，最后定调「参考 VS Code」——那里没有需要发明的顺序：源代码管理视图就是 输入框 → 变更分组 → 图/历史。**唯一跟不了的一处**：VS Code 把 diff 开在编辑器区，而本插件只注册了右侧栏 tab（`sidebarRightTabs`，本 profile 的客户端包里没有主区 tab 的注册缝），所以 diff 停靠在最下、默认半屏——这也符合「点文件在提交框下方看 diff」的要求。**代价**：diff 是固定占位而不是占满 body，列表可用高度变小（`body` 留 56px 下限、dock 拖动上限留 200px 给上面） |
| **D19** | FR-3.2 只说「分组标题行提供组级批量操作」，没规定显隐 | M2 做成了 hover 才显形（`opacity: 0` → 1）；M3 验收后改为**常显**，并把分组名改成可省略号收缩、标题行 `min-width: 0` | 产品方在界面上**找不到**「全部暂存」——hover-only 的控件在窄侧栏里等于不存在，而同一份文档的 §4.2 示意图本来就把这两个操作画成可见控件。行内 `+`/`−` 保持 hover 显形不动：FR-3.1 明文要求「hover 显现」，那是需求本身的决定 |
| **D20** | FR-4.4 要求切换分支受阻时提供「**贮藏后切换**」快捷项 | M4 **只做降级**：原样展示 git 的多行输出并说明工作区不干净，不提供一键贮藏。stash 本身是 FR-6.2，排在 M5a（§10.1 顺序 4） | 一键贮藏会写 `git stash`（动 `refs/stash` + 工作区），是 M5a 才交付的能力；在 M4 里半做它，等于把这个里程碑唯一的破坏性写操作藏在「切换失败」的补救路径里。产品方确认：先降级 |
| **D21** | FR-9.2 每个冲突文件提供「**打开文件**（调 DSH 文件编辑器）」与「标记已解决」 | M4 **不做打开文件**；冲突行只提供「标记已解决」（即 `+`，与 git 同一命令），路径仍可从行 tooltip 读出 | 本 profile 的文件区是 `dsh-better-sidebar`，它对外的缝只有 `registerTab`/`registerFileViewer`/`registerFileIcon`，没有「按路径打开编辑器」；`dsh-client-ui-open-in-app` 打开的是工作区目录给本地应用，也不对口。产品方确认：往后排 |
| **D22** | FR-3.6 提交详情「完整信息、文件清单、每文件增删行、**可下钻看该提交的 diff**」 | M4 做前三项（行内展开），**下钻 diff 与提交改写（drop/squash/reset、FR-3.8 的撤销）不在 M4** | 下钻需要一个「按提交取 diff」的第三种 `DiffArea`（客户端与路由都要扩），而提交改写是另一类操作（重写历史）。产品方确认：提交详情具备初步功能即可，提交管理往后排 |
| **D23** | §5.2 的意图是「DSH 名字只在 adapter 里，且最好是类型」 | `host/adapter/llm.ts` 引入了 `@deepseek-ai/dsh-llm` 的**运行时值**（`BlockAssembler`、`createUserMessage`），并把它声明为 peerDependency | 手写一份流式装配会复刻 harness 的块合并规则（工具调用截断、未知块、delta-only 协议都已在那层处理过），手写 message 形状则要跟住它的不可变创建契约。用宿主自己的装配器是唯一不会随宿主漂移的选择。**代价**：host bundle 首次带一个 `@deepseek-ai/*` 的运行时 import（此前只有 Node 内建 + `vscode-diff`），安装时必须能解析到宿主提供的 `dsh-llm`——`link:` 安装由本仓 devDependencies 提供，npm 安装由 peer 自动补齐 |
| **D24** | §7 的 M5 是**一个**里程碑：discard、stash、提交图、撤销、多仓库 → 发布 v1.0 | 拆成 **M5a**（行级菜单机制 + FR-6.1 discard + FR-3.8 撤销 + FR-6.2 stash）与 **M5b**（FR-7.1 提交图 + FR-7.2 下钻 diff + FR-8 多仓库 + 提交改写 drop/squash/reset），M5b 收尾即文档 §7 的 v1.0 | M5 的实际体量大于 M4：文档 §3.1 的 5 个功能跨 P1/P2，另加 M4 明确留下的两件（下钻 diff、提交改写）。拆点选在「破坏性写操作」这一侧——**discard 与 undoCommit 正是 §7 的 M5 待办点名的两个**，它们与已交付的 deleteBranch 共用同一套武装确认（`ui/armed.ts`）与审计通道，一起做才不重复实现；提交图与多仓库是纯新增表面，不改变任何写操作的安全性。产品方 2026-09-12 确认按此拆分并先开工 M5a，工作包与排序见 §10 |

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
- **M5a 待办**：discard / deleteBranch / undoCommit 这三个**破坏性**操作落地时，
  需要各自的「点击武装→3s 内再点」确认（§4.3）与更明确的审计（删了哪个分支、
  丢弃了哪些路径）。deleteBranch 已在 M4 交付（`not-merged` → 同一行武装成强制删除），
  剩 **discard 与 undoCommit** 排在 M5a（见 D24 与 §10）。若将来要支持 LAN 访问，
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
| **分区高度可拖**：抽出通用 `PaneResizer`（`role="separator"` + 顶部 7px 拖动条），底部区域（tab 条 + 内容）整体可拖，变更列表作为剩余空间随之伸缩；默认高度按 tab 分：diff 固定 `50vh`，提交列表按内容高、上限 `40vh`（五条提交不该占半屏）；提交框 textarea 的可拖上限从 160px 提到 260px | `ui/pane-resizer.tsx` + `.dgp-bottom` |
| **「更改」「未跟踪」与「已暂存」同构**：抽出一个可复用的 `ChangeGroupPane`（`PaneResizer` + 自有滚动体 + `Group`），三个常驻分组各挂一个，各自拖动、各自滚动、默认高度都是自己内容的 40% 上限——「每个分区的高度要能自己拖」此前只有已暂存区满足；「已暂存」仍是唯一常驻（空态 + 计数 0）的抽屉，工作区两个分组没内容就不占位。冲突分组保持普通分组：它随合并来去，不值得为它长期让出高度（VS Code 也把冲突放在变更列表最上）。行/分组组件从 `StatusPanel` 移到 `ui/ChangeGroup.tsx`，面板从 884 行降到 662 行 | `ui/ChangeGroupPane.tsx` + `ui/ChangeGroup.tsx` + `.dgp-change-drawer`（原 `.dgp-staged-drawer`）；文案 `unstaged.resize` / `untracked.resize` |
| 顺手补测试：拖动条此前只测「按下并移动」，从不派发 `pointerup`——而抓手监听的是 `window`（指针移出 7px 条带也要继续拖），于是**没释放的抓手会继续改后面所有拖动的高度**。现在测试用 `dragGrip()`（按下 → 移动 → 抬起），并断言「抬起后再移指针不再改高度」「拖一个分区不动另一个」 | `test/client-panel.test.ts` 的 `dragGrip()` |
| **修：空索引上点「全部取消暂存」报错**（用户实测报来）。已暂存抽屉是唯一常驻的分组，计数 0 时批量按钮照样在，点了就发 `paths: []`——host 按契约拒掉（`validatePaths`：至少一个路径），面板把这条渲染成「请求不完整，请重新打开这个面板」，可面板本身没毛病，这句提示帮不上任何忙。三层修：① 分组批量按钮在**没有行时禁用**（仍常显、不回到 hover-only，`title` 用该分组自己的空态文案补完一句话，如「全部取消暂存 · 无暂存更改」）；② 客户端的 `stage`/`unstage` 对空数组直接 no-op，不发请求（host 侧契约不动：空列表就该被拒）；③ `perform` 把「git 客户端抛异常」也变成一次普通失败——此前 `await operation()` 抛出会让操作永远停在 `running`（转圈 + 按钮永久禁用，且不报错） | `ChangeGroup` 的批量按钮 + `StatusPanel` 的 `stage`/`unstage` 与 `perform`；样式 `.dgp-ghost:disabled` |
| 边界测试补齐：客户端「空分组不发请求 / 禁用按钮带解释 / 同组有行时照常工作」；`perform` 对抛异常客户端的失败呈现（原因保留、不误报成功）；host 侧 wire 级「`paths: []` 返回 `bad-request`、`paths` 不是字符串数组同样被拒、且仓库状态未被 no-op 改动」，并据此钉住本适配器的**状态码约定**：*操作*失败走 200 + `ok:false` 信封，只有「请求根本没成为一次操作」（缺 session、body 读不出、body 不是对象）才 4xx | `test/client-panel.test.ts` + `test/host-mount.test.ts` |
| **修：行内 `+`/`−` 太靠边、被挡**（用户实测报来）。原因是几何而非配色：`.dgp-row` 同时有 `width: 100%` 和左右内边距（12px + 8px），而全表没有全局 `box-sizing: border-box`（只有 `.dgp-head` 与提交框 textarea 各自声明过），于是行的边框盒比裁剪它的抽屉还宽 20px，贴在行右内边距上的 30px 按钮正好落进被裁掉的那条。改：行声明 `box-sizing: border-box`；行与分组表头的右内边距统一到 12px（两者本来就该是同一列控件，且行右缘就是按钮，行的内边距决定它看着是否贴墙）；再把「按钮离边缘的余量」放到真正拥有行的滚动容器上——`.dgp-change-body` 加 10px 右内边距（`.dgp-body` 那份原样保留，它是为 body 自己的兜底滚动条留的）。现在按钮右边到抽屉边缘：行内 12px + 滚动容器 10px = 22px（滚动条出现时，它自己那一列再占 10px） | `.dgp-row` 的 `box-sizing`/右内边距 + `.dgp-group-head` 的右内边距 + `.dgp-change-body` 的 `padding-right`；回归测试读 `getComputedStyle` 断言这几项 |

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
| **底部 dock 默认展开**（产品方实测报来：「最近提交这个 tab 页默认打开，现在每次刷新都要手动打开」）。默认从「折成 tab 条」改成**展开在「最近提交」**，并且把「展开/折叠」与拖动后的高度一起记进 `localStorage`（`dsh-git-panel/bottom-pane`）——折叠是用户自己的选择，刷新不该替他改回来 | 新模块 `ui/bottom-view.ts`（`readBottomPane`/`writeBottomPane`，读取做了校验：`expanded` 必须是布尔、`height` 必须是正有限数，否则回落默认）；`BottomPane` 的 `expanded`/`height` 初值来自它，变更时写回。**连带影响**：`HistoryPanel` 的 `active` 在挂载时即为真，所以面板一打开就会读第一页提交（列表本身仍是「只在可见时读」——折叠状态下不花 git 调用，有测试钉住） |
| **文件树与分组表头对齐**（产品方实测报来：「根目录的那个 `>` 应该跟上方的 `>` 更改 对齐，暂存区也是一样」）。原来目录按钮的左内边距是 0、分组的表头是 12px，根目录的 caret 因此比分组 caret 左移 12px | 目录按钮改成 `padding: 3px 12px`（与分组表头、与文件行同一份 12px 前导内边距），缩进步长从 14px 改成 **18px = caret 12 + 间距 6**：于是深度 0 的 caret 与分组 caret 同列、目录**名字**与分组名字同列、深度 1 的行与父目录名字同列。测试断言目录按钮与分组表头的 computed `padding-left` 相等，并钉住深度 1 的 `padding-left: 18px` |
| **提交信息改成在这个 box 内左右分栏**（产品方要求）：点击一条提交，**左侧保留提交列表、右侧打开这条提交的信息**，各占一半——原来是「行内展开详情」，那样列表会跳（点的那一行被详情的高度顶下去）、详情还会把后面的历史挤出可视区。现在：`historySplit` 一行两列，`historyList` 是左列、`CommitDetailPane` 是右列（**顺序即语义**：左 entry、右信息）；未选中时只有左列、列表占满整宽；右列自己带表头（短哈希 + 主题 + 收起按钮），因为被点的那一行在另一列、可能已滚出视野 | `ui/History.tsx` 拆成 `CommitRow`（只管行）与 `CommitDetailPane`（只管信息列），行不再接收 detail；`styles.ts` 新增 `historySplit`/`historyList`/`historyDetail`/`historyDetailHead` 并删掉行内的 `commitDetail`；`.dgp-bottom-scroll` 从「滚动体」变成「框」（`overflow: hidden` + flex），滚动交给两列各自承担——这是两列能独立滚动的前提。详情仍按需读、按 oid 缓存（重复点开不多发 `git show`）。测试断言：关闭时 `data-split='false'` 且只有一列、打开后两列且**左列含被点的行**、右列表头写着这条提交、右上角收起按钮能关、再点选中行也能关、点另一条只换右列内容（`[data-commit-detail]` 始终只有一个） |
| **删掉提交行左侧的展开箭头**（`›`）。整行已经是按钮、hover/选中底色也在说「这里可以点」，箭头那套「可展开」的暗示就是多余的第二个信号（产品方要求）。顺带把行左内边距从 22px 收回到 12px——那 22px 原本是给箭头留的槽；详情块的左缩进随之从 40px 收到 24px，仍比行文字深一格 | `ui/History.tsx` 去掉 `CaretGlyph`，`styles.ts` 删掉 `.dgp-history-caret` 及其 `[aria-expanded='true']` 旋转规则（`historyCaret` 这个类名一并从 `cls` 移除，避免留下无人使用的键），行/详情的内边距按上面收；`aria-expanded` 保留在按钮上（屏幕阅读器仍需要知道展开状态）。测试断言标题行里没有 `svg`、且第一个子元素就是哈希 |
| **FR-1.3 落地：变更文件按文件树展示**，并保留平铺列表与一个常显的切换按钮（文档要求「支持列表/树形两种展示模式切换（树形按目录折叠）」，所以两种都在）。**默认是树形**——产品方最新口径（文档没有规定默认值）；选择与目录折叠都写进 `localStorage`（`dsh-git-panel/view-mode`、`dsh-git-panel/collapsed-dirs`），像 diff 布局与分组折叠一样是偏好 | 纯函数 `core/change-tree.ts`（按 `/` 嵌套、**目录优先**、按 git 的字节序而非本机 locale 排序、把「只有一个子目录且自己没有文件」的链压成一行如 `deep/nested/dir`、目录带整棵子树的文件计数）→ `ui/ChangeGroup.tsx` 的 `Group`/`TreeNodeView`（**两种形状都在 Group 里**，因为两个容器都要用；缩进是外层 `treeNode` 的 `padding-left`，行自己的内边距仍归样式表，深度步长 14px）→ `ui/change-view.ts`（模式 + 折叠目录的读写与 `dirKey(area, path)`：每组各建自己的树，所以在「已暂存」里折叠 `src` 不会折叠「更改」里的）→ 状态栏末端一个 `aria-pressed` 的切换按钮（VS Code 把视图动作放在视图标题栏，本插件没有标题栏，就放在状态栏；字形画的是**将要切到**的那一侧） |
| 树的折叠状态是在嵌套里逐层渲染的（`TreeNodeView` 递归），行内动作与点行开 diff 都沿用 `ChangeRow`——树只改变路径**怎么画**，从不改变动作带着**哪个路径**走；因此树里的文件行不再重复目录前缀（`showDirectory={false}`），tooltip 仍是完整路径（FR-1.2） | `ui/ChangeGroup.tsx` + 测试断言树内 `+` 暂存的是完整仓库相对路径、点行读的也是同一个 path |

### 已登记、本次不做的后续工作

以下三项都是产品方在提出「提交 entry 要像 better-sidebar 那样」时确认要**记录**的工作（本文档对
`dsh-better-sidebar@0.19.0-alpha.1`「文件变动 → Git」lens 的走查结论，源文件在同一 profile 的
`node_modules/dsh-better-sidebar/src/client/changes/GitLens.tsx`）。

| 事项 | 内容与需要补的东西 |
|---|---|
| **① 点击提交行在底部 pane 预览该提交的差异** | 这正是 FR-3.6 的「可下钻看该提交的 diff」/ FR-7.2，也是它替代行内展开的做法（`onPreview(commitRefOf(entry))` → 共享底部 `DiffPane`）。需要：`DiffArea` 增加「按提交取 diff」的形态（如 `{kind:'commit', hash}`）、host 侧 `git show --no-color --no-ext-diff --no-textconv --unified=N <hash>`（**合并提交仍用 `-m --first-parent`**，与 `showCommit` 同口径）、以及多文件 patch 的渲染（它的 `git.commit-diff` 直接回整条 patch；我们要么让 `core/diff-parse.ts` 把一条 patch 切成多个文件段、要么按文件下钻 `git show <hash> -- <path>`）。做完这一项，行内的详情块可以退化成「文件清单 + 点击文件下钻」 |
| **② 提交行的右键操作菜单** | 它的条目：查看提交差异 / 复制短哈希 / 复制完整哈希 / 复制提交信息 / 分隔线 / **还原此提交**（danger + 确认：「将在当前分支创建一个反转「{subject}」的新提交。」）/ **捡取此提交**（danger + 确认：「将「{subject}」的更改应用到当前分支。」）。复制类三项是纯客户端 clipboard，随时可做；还原/捡取属**改写历史**，与 FR-3.8 的撤销（M5a）、drop/squash/reset（M5b）同一批，需要 host 新路由 + §4.3 的确认（本插件的确认机制是 `ui/armed.ts`，不是原生 `confirm`） |
| **③ 更改文件行的右键操作菜单** | 它的文件行菜单：在编辑器中打开 / 暂存·取消暂存（按该行所在的一侧）/ **放弃更改**（danger + 确认；未跟踪文件不提供）/ 复制相对路径 / 复制绝对路径。落到本插件的三处约束：**「打开编辑器」受 D21 限制**（本 profile 没有「按路径打开文件」的缝，本插件也没有 `--no-index` 之外的编辑器能力）；「放弃更改」是 FR-6.1，与 M5a 的 discard 一起做（§10.1 顺序 2）；「复制绝对路径」需要 host 给出仓库根前缀（`RepoStatus.root` 已有，但客户端不该自己拼绝对路径）。另外**菜单本身的实现方式要先定**：primitives 的 `Menu`/`Modal` 不能出现在 `src/client/ui/**`（依赖方向第 3 条），要么在 `client/adapter/` 里包一层中性接口，要么像 `BranchPicker`/`PaneResizer` 那样手搓一个轻量弹层（含定位、Esc、点击外部关闭、键盘导航） |

**这三项在 §10 里的排期**：① = M5b 顺序 5（它的复制类条目 = 顺序 6）；②③ 的**菜单载体**
就是 M5a 顺序 1——顺序 1 不落地，这两张菜单各自都无从写起；其中「放弃更改」= M5a 顺序 2、
「还原/捡取」= M5b 顺序 9、「打开编辑器」受 D21 阻塞（§10.4）。

**M5 概要**（文档 §7 的原文范围）：discard（二次确认「不可恢复」）、stash、提交图 SVG 泳道、撤销最近提交
（未推送 `reset --mixed`／已推送 `revert`，执行前后端重新核实 —— FR-3.8）、多仓库扫描（FR-8），
以及 M4 明确留下的两件：提交详情里下钻单个文件的 diff（FR-7.2）、提交改写（drop/squash/reset）。
**这一范围已按 D24 拆成 M5a / M5b，工作包、依赖与开工顺序见下一节。**

---

## 10. 后续工作优先级（M5a / M5b）

范围按 D24 拆成两段：**M5a 是破坏性 / 高频写操作**（共享 `ui/armed.ts` 的武装确认与
§7 的审计通道），**M5b 是历史增强与发布收尾**。下面三张表合起来是全部待办，
**顺序即开工顺序**，每项都写明它对应文档哪一条、落在哪、以及为什么排在那里。

### 10.1 M5a（下一步）

| 顺序 | 事项 | 文档条目 | 落点与依赖 | 粗估 |
|---|---|---|---|---|
| 1 | **行级菜单机制**：手搓轻量弹层 | —（前置，无文档条目） | 菜单的载体必须先定（§9 已登记②③正是卡在这里）：primitives 的 `Menu`/`Modal` 不能出现在 `src/client/ui/**`（依赖方向第 3 条），所以在 `ui/` 里做一个中性 popover（定位、Esc、点外部关闭、键盘导航），像 `BranchPicker`/`PaneResizer` 那样自成一体。顺序 3 与 §9 的②③都复用它 | S–M |
| 2 | **放弃更改 discard** | FR-6.1 | host 新路由 `discard`：已跟踪走 `git restore --`（**未出生分支的陷阱与 `unstage` 同源**，见 §6 第 3 条）、未跟踪才真删文件；复用 `core/validate.ts` 的 `validatePaths`。FR-6.1 的原话是「**文件行**提供放弃更改按钮」，所以行内 `+`/`−` 旁多一个 danger 按钮（hover 显形，§4.3），同一个动作也进 §9③ 的菜单；武装用 `useArmedKey`，文案必须出现「不可恢复」（§4.3 禁止原生 `confirm`）；审计记「丢弃了哪些路径」（§7 的 M5a 待办）。第三个行内按钮在窄侧栏里的几何按 M3 的教训处理（`.dgp-row` 的 `box-sizing` 与右内边距，见 §8） | M |
| 3 | **撤销最近提交** | FR-3.8 | host `undoCommit`：**执行前由后端重新核实推送状态**（不信客户端传来的任何东西），未推送 `reset --mixed HEAD~1`、已推送 `revert --no-edit`；入口挂在历史行上（用顺序 1 的弹层）；`core/validate.ts` 里的 `validateHash` 正好得到第一个调用方——这正是 D11 那条原则的兑现 | S–M |
| 4 | **贮藏 stash** | FR-6.2 + D20 | 存（可带消息）/ 列表 / 应用（pop · apply）/ 删除；做完才能把 D20 的「贮藏后切换」补回 FR-4.4 的受阻路径——那正是 M4 有意留下的降级口 | M |

### 10.2 M5b（M5a 验收之后）

| 顺序 | 事项 | 文档条目 | 落点与依赖 | 粗估 |
|---|---|---|---|---|
| 5 | **提交详情下钻单文件 diff** | FR-7.2 = §9 已登记① | `DiffArea` 增加「按提交取 diff」的形态 + host `git show <hash> -- <path>`（合并提交仍 `-m --first-parent`，与 `showCommit` 同口径）；渲染直接复用 `DiffView`，不需要新的解析器 | M |
| 6 | **复制类条目** | §9 已登记②③的一部分 | 短 hash / 完整 hash / 提交信息 / 相对路径 / 绝对路径——纯客户端 clipboard，成本最小、感知最直接，可穿插在 5 与 7 之间（「复制绝对路径」要 host 给出仓库根前缀，`RepoStatus.root` 已有） | S |
| 7 | **提交图 SVG 泳道** | FR-7.1 | 分叉开道、合并收道、分页不断线。刻意排在 M5b 内靠后：同 profile 的 `dsh-client-ui-git-graph` 已提供 `/git/graph`（见 §12），它是本批次里**唯一「别处已经能用」的能力**——不是不做，而是边际价值最低 | L |
| 8 | **多仓库** | FR-8.1 / 8.2（文档自己标 P2） | 工作区根非仓库时扫一层子目录（跳过 node_modules/dist/build/点开头）、仓库下拉、默认取 `.git` 最近活动的仓库、选择按工作区记忆；改动面在 `host/adapter/workspace.ts` 的 `resolveRepo` 与客户端的分支行 | M |
| 9 | **提交改写与还原 / 捡取** | §9 已登记② + D22 | drop/squash/reset，以及提交行的「还原此提交 / 捡取此提交」，全属**改写历史**，需新路由 + 武装确认（§4.3）；M4 时已由产品方确认往后排 | M–L |
| 10 | **v1.0 发布收尾** | §7 的验收标准 | 版本号 0.1.0 → 1.0.0、README 与本文件的已交付范围对齐（顺带修口径：本文件此前写 280 项测试、README 写 282，实际是 282）、安装路径核对（目前只验过 `link:` 装法） | S |

### 10.3 M5 之外登记在案、尚未排期

| 事项 | 说明 |
|---|---|
| **非仓库时的「初始化仓库」按钮**（§4.3 空态引导） | 现在只有一句 `noRepo.hint` 文案，文档要求一个执行 `git init` 的按钮 |
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
| 2 watcher 可靠性 | 已用轮询（非 `fs.watch`）规避；但**同步盘/网络盘仍未实机验证** |
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
| 提交图谱 | ⬜ M5b（FR-7.1，§10.2 顺序 7） | ✅ `/git/graph` |
| 切换 / 新建 / 删除分支 | ✅ M4（FR-4；含未合并分支的强制删除） | ✅ `/git/switch`、`/git/create-branch` |
| 放弃更改 / 贮藏 / 撤销提交 | ⬜ M5a（FR-6.1、FR-6.2、FR-3.8） | ❌ 无对应路由 |
| 工作树隔离、设置卡 | ⬜ 非目标 | ✅ `/git/worktree-*` |
| 输入框分支胶囊（空白会话） | ⬜ 非目标 | ✅ |
| diff 视图 | ✅ M3（FR-2，inline/左右 + 逐词高亮） | ❌（其 README 未声明） |
| 遥测 | **无**（不外发任何数据） | 每 UTC 日一次匿名安装心跳（其 README 声明） |

结论：不是「谁是谁的子集」，而是**文档 §1.2 指出的那个缺口仍然成立**——它给了
分支/图谱/工作树，但没有「常驻侧边栏 + 可写提交」这条闭环；本插件的 M2 正是补这条。
反过来它的图谱对应本插件的 M5b，属于**尚未做的里程碑**，不是设计放弃；分支管理那半
已由 M4 补齐（见上表），而放弃更改 / 贮藏 / 撤销提交这一组两边都没有，是 M5a 的地盘。

命名上如果要更清楚，可把本插件 tab 从「Git」改成更具体的名字（`type.label`），
但它出现在右侧栏、以「Git 变更」为引导条目名，与它那个输入框胶囊不在一处，
实际不易混。**不要**为了避开它而改 `kind`/`id`：`id` 是本体注册的 key
（`sidebar.right.pane.tab` 的 key），改名等于让已打开的标签失效。
