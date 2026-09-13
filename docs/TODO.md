# TODO · dsh-git-panel

> 未交付项清单，逐条核对到 2026-09-13（包版本仍为 `0.1.0`）。
> 来源是 `docs/plan.md` §10.2 顺序 10 / §10.3 / §10.4、散在 D 编号决策里的「已知未做」，
> 以及产品方直接提出的新增。`docs/requirements.md` 已于 2026-09-13 删除，下表「文档条目」
> 列里对它的引用（`§3.6` / `FR-x.y`）只作历史出处。
>
> 文档分工：`plan.md` 写**已经是什么、为什么**，本文件只负责「还差什么」，
> 并在已有做法/前置条件时指向 `docs/plan/<slug>.md`。已交付范围见
> `README.md` 的「What works today」与 `docs/plan.md` §1。
>
> **维护规则：条目一旦完成就从本文件删除**（不留 ✓、不留「已交付」小节），
> 它对应的 `docs/plan/<slug>.md` 一并删除；本文件因此永远只列未完成项。

## 状态速览

- 里程碑 M0–M5b 的功能**全部交付**，M5b 按 `docs/plan.md` §10.2 只剩顺序 10 发布收尾。
- 下面 A 组 14 条来自 `plan.md` §10.3 与产品方直接提出（未排期）；B 组 1 条是发布收尾；
  C 组 2 条是文档在 D 决策里点名的具体缺口（做法已写明）；D 组是有意不做/等条件的；
  E 组只差验证，不是代码工作量；**F 组 1 条是产品方 2026-09-13 报来的缺陷**
  （git 操作没有端到端超时，点 fetch 一直转圈）。
- **面向 agent 的那条线已单独立册**：统一写入口（原 A-17）、多 agent 协作、提交出处搬到了
  [TODO-agent-collaboration.md](TODO-agent-collaboration.md)——那是**唯一动全 harness 承重梁**
  的一批（注册自己的 `ctx.fs` provider、接管 `write` / `edit`）。本文件此后只管面板自身。
- A-10~A-12 是 2026-09-13 提出的 diff 视图操作四条里的
  后三条（前一条「操作分区」已交付，见 `docs/plan.md` 的「验收期改动：diff 视图的操作分区」）：
  单按钮与自动换行都是视图操作，落在它定下的头部视图操作区；行间展开落在它定下的 gap 行。
  三条都已写出初步计划，见各自的 `docs/plan/<slug>.md`；A-11 已定做法（折行只在上下对照生效、
  左右对照下按钮禁用）；A-12 的两处待定也都定了（行数用算式推导；内容走"逐处展开、开到底"，
  新增一条按 revision 读内容的路由）。
- A-13（展示 work tree）与 F-1（git 操作的端到端超时）同日提出，也各有一份计划文件
  （`docs/plan/worktree-list.md`、`docs/plan/operation-deadline.md`）；两者的做法都还有
  待产品方定的问题，见各自文档的「待定」节。
- A-14（侧边栏里的定义/引用跳转）也同日提出，方向已经选定：接缝用本插件已经在用的原生右侧栏
  resource 类型、行号走原生的 `params: { line }`，引擎本地编译器优先、`ctx.lsp` 只作可选一路
  （理由与代价见计划文件）。**但「范围」这一条没定**——它已经超出「git 面板」，是留在本插件
  还是另起一个插件，得产品方先答。
- **一处文档已过时**：`docs/plan.md` §10.3 列的「凭据缺失的专门文案」在 D44 已交付
  （`auth-required` 分类 + 失败通知内的凭据表单 + 重跑原操作），不再是待办。
  §3.6 那一格说的是另一件事（SSH / 代理 / 同主机多仓库不同凭据），见 A-8。
- **A-10~A-16 与 F-1 只落在 `plan.md` 与本文件**：原先给它们准备的登记处是
  `requirements.md` §3.6，而该文件已于 2026-09-13 删除——此后新需求由产品方直接提出，
  登记处就是 `plan.md` §10.3 与本文件，不再有「要什么」与「做了什么」两份文档要对齐的问题。

---

## A. 已登记、尚未排期的功能

| # | 待办 | 文档条目 | 为什么没做 / 现状 | 计划 |
|---|---|---|---|---|
| A-1 | **检出远程分支**（新建跟踪分支 / 快进 / Rebase onto origin / Drop local commits） | requirements §3.6 第 1 行；FR-4.5；plan §10.3 第 1 行、D43 | 只读列表已交付；检出可能改写历史（rebase onto origin / drop local commits），且**先要冲突处理**才能安全收尾——FR-9 与顺序 9 的在途操作条现已交付，前置已解锁 | [plan/checkout-remote-branch.md](plan/checkout-remote-branch.md) |
| A-3 | **通知时长接进 DSH 设置**（插件配置面） | requirements §3.6 第 3 行；plan §10.3 第 3 行、D40 末尾 | 现在是代码常量 `NOTICE_DURATION_MS = 4000`；产品方 2026-09-12 决定「等真有功能需要设置时一起加」 | [plan/notice-duration-setting.md](plan/notice-duration-setting.md) |
| A-4 | **非仓库时的「初始化仓库」按钮**（执行 `git init`） | requirements §3.6 第 2 行；§4.3 空态引导；plan §10.3 第 2 行 | 现在只有一句 `noRepo.hint` 文案，没有按钮 | 无（文档只给了目标，没给做法） |
| A-5 | **上下方向键导航变更列表** | requirements §3.6 第 4 行；§4.3 键盘；plan §10.3 第 4 行 | `Ctrl+Enter` / `Esc` / `Shift+F10` 已有，这一条没有 | 无 |
| A-6 | **diff 虚拟滚动** | requirements §3.6 第 5 行；§6 性能 P1；plan §10.3 第 5 行 | 现靠 FR-2.6 的「>5000 行默认折叠」兜底，展开后整块渲染 | 无 |
| A-7 | **gpg 签名卡死的专门文案** | requirements §3.6 第 6 行；plan §10.3 第 6 行、§11 | `commit.gpgsign=true` 的仓库里提交会卡到 15s deadline；`GIT_TERMINAL_PROMPT=0` 管不到 gpg。M2 不传 `--no-gpg-sign`（会静默产生未签名提交，更糟） | 无（待办只说了「识别并给出文案」） |
| A-8 | **凭据的其余角落**：SSH、代理、同主机多仓库不同凭据 | requirements §3.6 第 7 行；FR-11.4；plan §11 | 本期只覆盖 HTTPS 且按 origin 寻址（git 的提示串只到 origin，故同主机多仓库共用一份）；本地 provider 今天仍是明文 YAML | 无 |
| A-10 | **diff 视图改成单按钮切换**（同行 ⇄ 左右；图标随当前布局变，沿用现有两枚字形） | plan §10.3（产品方 2026-09-13 提出） | 现在是两枚段控按钮、用 `aria-pressed` 标出当前布局（`ui/DiffView.tsx:642`）；改成单按钮后这个属性没有位置，要换成「点下去会变成什么」的文案。落点已定：留在 A-9 交付的 `ViewOps` 组里，视图操作区不是托盘 | [plan/diff-layout-toggle.md](plan/diff-layout-toggle.md) |
| A-11 | **diff 视图增加「自动换行」开关** | plan §10.3（产品方 2026-09-13 提出） | 没有该开关；行文本不折行，长行靠左右两半各自的横向滚动条看全（`ui/DiffView.tsx:253`）。左右布局的两个滚动容器天然容不下折行（配对两格会错位），故**折行只在上下对照生效，左右对照下按钮禁用**（2026-09-13 定）。落点是 A-9 交付的头部视图操作区（`.dgp-diff-ops`） | [plan/diff-word-wrap.md](plan/diff-word-wrap.md) |
| A-12 | **diff 行间操作：展开两处 hunk 之间的行** | plan §10.3（产品方 2026-09-13 提出） | 缝隙的**行数**由 hunk 的起止行相减即得（2026-09-13 定，不需要新数据）；hunk 之间**一行内容都没有**（`FileDiff.hunks[].lines` 只含 hunk 内，`core/types.ts:495`），故走"逐处展开、开到底"（2026-09-13 定）：新增一条 `GET /git-panel/fileLines` 读 old 侧 blob 的指定行区间——缝隙两侧逐字相同，只读一侧即可，且不必读文件系统。落点是 A-9 登记的 `.dgp-diff-gap` 行（行间操作的载体） | [plan/diff-expand-gap.md](plan/diff-expand-gap.md) |
| A-13 | **展示 work tree**（列出当前仓库的全部工作树：路径、分支或游离 HEAD、`bare`/`locked`/`prunable` 标记） | plan §10.3（产品方 2026-09-13 提出） | 本插件完全没有 worktree 概念（§12 把「工作树隔离」记成非目标；同 profile 的 `dsh-client-ui-git-graph` 有 `/git/worktree-*`）。数据源是 `git worktree list --porcelain`，纯只读。基础已具备：`host/git-dir.ts:30` 的 `gitDirOf` 会读 linked worktree 的 `.git` **文件**，面板在非主工作树里本来就能跑。要产品方定四件事（入口、是否允许切到别的工作树、单条 record 时是否隐藏、主工作树是否标记），见计划文件 | [plan/worktree-list.md](plan/worktree-list.md) |
| A-14 | **侧边栏里的定义/引用跳转（代码导航）**：从符号跳到定义（跨文件也要落到行）、列出引用并跳过去 | plan §10.3（产品方 2026-09-13 提出） | 侧边栏现在没有任何代码导航，本插件两个 tab 都是只读视图。接缝已经具备、**不必新增依赖**：本插件已经在用原生右侧栏的 resource 类型（`client/adapter/sidebar-tab.tsx:159` 的 diff 先例），行号走原生的 `openResource(…, { params: { line } })`（`sidebar-right/lib/types/client/contract/params.d.ts:6`）——所以**不存在**「better-sidebar 的 `openFile` 没有行号」那个缺口。引擎路线 2026-09-13 定方向：不把 `ctx.lsp` 当唯一路径（只有 4 个只读操作、没有 documentSymbol、provider 要用户自装），改为 host 半 CodeIntel + 多条 adapter（`ts-service` 先做、`ctags` 兜其它语言、`ctx.lsp` 可选第三路）。**范围本身还要产品方定**（已超出「git 面板」），见计划文件的「待定」五条 | [plan/code-navigation.md](plan/code-navigation.md) |
| A-15 | **冲突的「合并」动作**（把两侧合成一个版本） | plan.md「验收期新增：冲突行的三个按钮（FR-9.2）」 | 冲突行里已经画出按钮但**置灰**，悬浮说明写「待后续迭代，建议先由大模型处理」（产品方 2026-09-13 定）。缺的不止一处：没有读三方 blob（`:1:` / `:2:` / `:3:`）的任何能力，也没有把内容写回工作区的正当通道——今天所有内容变更都交给 git 子命令，而 `git restore --ours/--theirs` 只能整取一侧；模型接缝只有提交信息用的 `generateText`（`core/ports.ts:277`，512 token 上限、不接受参数） | 无（做法待定：自己做三方合并，或按产品方建议交给大模型） |
| A-16 | **分支之间的合并与变基**：把另一个本地分支合并进当前分支（`git merge <branch>`）、把当前分支变基到另一个本地分支（`git rebase <branch>`） | plan §10.3（产品方 2026-09-13 提出；`requirements.md` 已删除，无 FR 编号） | 面板没有发起分支间合并 / 变基的入口。**合并**只在 pull 里被动产生（`pull --no-rebase --no-edit`，D8），事后能由在途操作条继续 / 中止（D50），但没有「把 X 合并进来」这一击；**变基**只出现在两处——A-1 的 Rebase onto origin 与顺序 9 的提交改写（`rebase --onto` / `-i`，D49），都不能把当前分支变基到任意本地分支。要产品方定：merge 是否总是产生合并提交（`--no-ff` 还是允许快进）、合并信息怎么来（`--no-edit`）、rebase 是否只做非交互的 `git rebase <branch>`（手工编辑 todo 一直是非目标）、以及变基范围内含合并提交时是否照 D49 拒绝 | 无（做法待定） |
## B. 发布收尾

| # | 待办 | 文档条目 | 现状 | 计划 |
|---|---|---|---|---|
| B-1 | **v1.0 发布收尾**：版本号 `0.1.0` → `1.0.0`、README / `plan.md` 已交付范围与测试计数对齐、安装路径核对 | plan §10.2 顺序 10 | 版本号实测仍是 `0.1.0`；安装只验过 `link:` 装法；测试计数只以 `npm run check` 的实际输出为准（原先不一致的 `requirements.md` 已于 2026-09-13 删除） | [plan/release-v1.md](plan/release-v1.md) |

## C. 文档已登记的具体缺口（做法已写明）

| # | 待办 | 文档条目 | 现状 | 计划 |
|---|---|---|---|---|
| C-1 | **分离 HEAD 时该提交没有 ref 胶囊**（补一种 `head` 类型） | plan D47 末尾「已知未做」 | 胶囊只认 `refs/heads` / `refs/remotes` / `refs/tags`；游离 HEAD 的提交一条胶囊都没有（同 profile 的 better-sidebar 会显一个 `HEAD`） | [plan/head-ref-capsule.md](plan/head-ref-capsule.md) |
| C-2 | **上游被远端删除时要能提前报告**（`--prune` 或 `remote prune --dry-run` 的只读报告） | plan D42 末段 ⚠、D45 | 获取不带 `--prune`（有意），过期的 `origin/<x>` 让 `upstreamGone` 保持为假，`pull` 要按下去才报错 | [plan/upstream-gone-prune.md](plan/upstream-gone-prune.md) |

## D. 有意不做 / 等条件（不排期）

- **冲突行「打开文件」**（FR-9.2；plan §10.4、D21）：**2026-09-13 复查推翻了阻塞理由**
  ——`dsh-better-sidebar` 并没有那三个缝（`registerFileIcon` 全包不存在），它的公开面
  `ctx.betterSidebar` 里有 `openFile(scope, path, title?)`（该插件 `client/service.ts:487`），
  做法见 [plan/conflict-open-file.md](plan/conflict-open-file.md)。**是否解禁（把它移出本组）
  仍由产品方定**，`plan.md` §10.4 与 D21 的原文尚未改。
- **提交改写的 reword（改提交信息）**（plan D48）：没有 reword，squash 也刻意不合并
  两条提交信息；想留说明只能先在提交框改写父提交信息，或到终端做交互式 rebase。
- **连续捡取多个提交**（plan §11）：面板只捡取单个提交，多提交序列器不在内。
- **`am`、手工 `--edit-todo` 等其它在途状态**（plan §11）：`RepoStatus.operation` 只覆盖
  merge / revert / cherry-pick / rebase 四种。

## E. 只差验证（不是代码工作量）

- **千文件仓库 / monorepo 压测**：`status < 500ms`、diff 千行、改写几百提交的分支
  （requirements §6 性能；plan §11）。
- **同步盘 / 网络盘上的 watcher**：`fs.watch` 主路径与轮询回退两条路都未在真实同步盘上验过
  （plan §11 第 2 条）。
- **真实 provider 的 AI 提交信息**：目前只用桩模型验过提示词、清洗与失败分类
  （plan §11 第 3 条）。
- **https / ssh 的真实 push/pull**：测试只覆盖 file transport 与裸仓库（plan §11）。
- **Windows 上用户名含空格的 sequence editor 路径**：只有推断没有证据（plan §11）。
- **浏览器目视验收**：M3 之后的 UI 行为只有 jsdom 覆盖，产品方尚未在真实浏览器里看过
  （plan §10.4）。

## F. 缺陷（产品方 2026-09-13 报来）

| # | 缺陷 | 现象 | 根因 / 现状 | 计划 |
|---|---|---|---|---|
| F-1 | **git 操作没有端到端超时**（点 fetch 一直转圈、永不返回） | 点「获取所有远程」后 rail 的 spinner 一直转，既不成功也不失败，只能关标签页或刷新页面 | 两层都不保险。host 的 15s 只是 `execFile` 的 `timeout`（`host/git-exec.ts:39`）：到点**只发 SIGTERM、不升级 SIGKILL**，回调又挂在进程 `close` 上（要等子进程退出且 stdio 管道关闭）——子进程不理会 SIGTERM 时 promise 永不 settle，**本机实测 deadline 15s 而 31s 后仍未 settle**（`git-remote-*`/`ssh` helper 活过父进程占着管道，或进程处于 D 状态）。同一层第二处缺口：`DirectoryQueues`（`git-exec.ts:120`）对排队等待不设 deadline。client（`client/adapter/git-client.ts`）**完全**没有 deadline，只带标签页的 `AbortSignal`（`ui/StatusPanel.tsx:133`，标签页关闭才 abort），也没有取消按钮。**已排除**：黑洞 http/https/ssh 远端都会在 ~15s 以 `timedOut: true` 返回，普通网络挂起是有救的。另有配置洞：`Config.gitTimeoutMs` 写 0 在 Node 里等于不限时（`host/index.ts:39`），会静默关掉安全网 | [plan/operation-deadline.md](plan/operation-deadline.md) |
