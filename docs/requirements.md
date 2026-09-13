# DSH Git 插件需求文档

> 项目代号：**dsh-git-panel**
> 版本：**v1.0**（2026-09-13，据实现回填；v0.2 草案之后的每处取舍与理由记在 `plan.md` §5 的 D1–D54）
> 日期：2026-09-13
> 定位：DeepSeek Harness（DSH）Web GUI 的可视化 Git 管理插件，对标 VS Code 源代码管理面板 + IDEA Git 工具窗口的核心体验

> 本文档写**要什么**（应然）；`plan.md` 写**已经是什么、为什么**（实然 + 决定）。两份不一致时：改代码以本文档为准，理解现状以 `plan.md` 为准。

---

## 1. 背景与动机

### 1.1 现状

DSH 作为 agent 运行时，会话内产生的代码变更只能依靠终端命令或外部 IDE 管理。社区已有相关插件，但均存在明显缺口：

| 插件 | 模式 | 主要缺口 |
|---|---|---|
| EasyTZ/dsh-git | 模态浮层面板 | 无 diff 视图、无新建分支、无 pull、无 discard、无自动刷新；浮层盖住整个界面，看变更与干活不能并行 |
| CnsMaple/dsh-plugin-git | 侧边栏标签页 | **只读**：不能暂存/提交/推送，只有查看能力 |
| Shyboy0499/dsh-git-tools | agent 工具（无 UI） | 面向模型调用，用户无可视化界面 |
| sakthiveltofficial/dsh-git-plugins | agent 工具套件 | 同上，无 GUI |

**本插件已补上这个缺口**：M2 起可写（暂存 / 提交 / 推送 / 拉取），M5a 补齐 discard / 撤销 / 贮藏，M5b 补齐提交图、下钻 diff、多仓库与历史改写，`npm run check` 全绿（566 项测试）。与同 profile 另一个 git 插件（`dsh-client-ui-git-graph`）的功能分工见 `plan.md` §12。

### 1.2 机会点

**常驻侧边栏（非模态）+ 可写操作（暂存 / 提交 / 推送）+ diff 查看**这三件事已同时成立；DSH 原生的 LLM 能力则用来做 VS Code 需要 Copilot 才有的 **AI 生成提交信息**，形成差异化。

### 1.3 竞品教训（EasyTZ/dsh-git 源码走查结论）

以下为其实现中被用户反馈打脸或设计上不直觉的点，本产品须规避：

1. 模态浮层 + 全屏遮罩，打开时窗口按钮都点不到 → **必须做常驻 sidebar tab**
2. 提交/推送按钮曾共用一个位置，被 issue #1 吐槽"本末倒置" → 高频动作各自常驻
3. 分支下拉做得太隐蔽，"看不出能点" → 控件可发现性优先
4. 未跟踪文件必须逐个点 +，首次提交几十文件是灾难 → 提供"全部暂存"
5. 点提交按钮时悄悄 `git add -u`，列表状态与实际提交内容不一致 → 提交范围必须显式可见
6. 无自动刷新，agent 改了文件面板还是旧快照 → 文件监听自动刷新

---

## 2. 产品目标

### 2.1 目标用户

使用 DSH Web GUI 进行开发的工程师，会话工作区即 git 仓库。

### 2.2 核心价值主张

> 不离开 DSH，完成日常 90% 的 Git 操作：看改动、审 diff、暂存、提交、同步、切分支。

### 2.3 非目标（Out of Scope）

- 不做完整的 Git GUI（不替代 GitKraken/Fork）：**交互式** rebase（手工编辑 todo）、blame 视图、submodule 管理不做。历史改写只以固定动作提供（见 FR-10），不开放 todo 编辑；需要逐条改写的场合交回终端
- 不做托管平台集成（PR/Issue/CI 属于 sakthiveltofficial 套件的地盘，不重复造）
- 不做 agent 工具（模型调用的 git 工具与本插件解耦，可后续复用同一 host service 另做）
- 不做多窗口/多会话的仓库写锁：同一个仓库被两个面板同时写时，由 git 自己的 `index.lock` 拒绝，面板只如实转述

---

## 3. 功能需求

### 3.1 功能总览（按优先级）

| 优先级 | 功能域 | 说明 | 条目 |
|---|---|---|---|
| **P0** | 状态管理 | 变更分组列表、文件状态徽标、列表/树形两种模式、自动刷新（文件系统事件 + 轮询兜底） | FR-1 |
| **P0** | Diff 查看 | 点文件看 diff、逐词高亮、上下/左右布局切换；开在面板底部的 dock 里，一个文件一条标签 | FR-2 |
| **P0** | 提交管理 | 暂存/取消暂存（含整组与多选批量）、提交范围显式化、提交历史、AI 提交信息 | FR-3 |
| **P0** | 分支管理 | 当前分支展示、切换、新建、删除、ahead/behind | FR-4 |
| **P0** | 远程同步 | 推送、拉取、同步（pull+push）、获取所有远程、远程分支只读列表 | FR-5 |
| **P1** | 更改操作 | 放弃更改（discard）、贮藏（stash）存取 | FR-6 |
| **P1** | 历史增强 | 提交图（多泳道）、提交详情含 diff、提交引用徽标（本地/远程分支、标签） | FR-7 |
| **P1** | 撤销 | 撤销最近提交（reset --mixed / revert 自动选择） | FR-3.8 |
| **P1** | 历史改写 | 还原 / 捡取 / 压缩 / 丢弃 / 重置三档（**交付期新增**） | FR-10 |
| **P1** | 凭据 | HTTPS 远端缺凭据时就地询问，存进 DSH 自己的凭据缝（**交付期新增**） | FR-11 |
| **P2** | 冲突处理 | 冲突文件标记、解决引导；「打开文件」受本 profile 没有这个缝所限（见 3.4） | FR-9 |
| **P2** | 多仓库 | 工作区内多子仓库切换 | FR-8 |

> 术语约定：本文档中**"暂存"专指 stage（git add，代码不动）**；stash 一律称"**贮藏**"，UI 文案同样遵守此约定，避免 Visual Studio 中文版把 stash 也译作"暂存"造成的混淆。

### 3.2 P0 详细需求

#### FR-1 状态管理

- FR-1.1 变更列表分组：**已暂存的更改**（抽屉，可收起）/ **更改** / **未跟踪的文件**，出现冲突时另有**合并冲突**组，与 VS Code 分组语义一致。**空分组不隐藏**：干净时"更改"与"未跟踪的文件"仍在，用表头 + 计数 0 表达干净，而不是一段"没有未提交的更改"的文字；提交框另有自己的提示句
- FR-1.2 每个文件显示**状态徽标**（`M` 修改 / `T` 类型变 / `A` 新增 / `D` 删除 / `R` 重命名 / `C` 复制 / `U` 未跟踪 / `!` 冲突）+ **文件类型图标** + 相对路径；路径过长时**保留文件名、截断目录部分**（VS Code 风格），tooltip 显示完整路径。一行的列自左至右固定为：勾选框 / 类型图标 / 路径 / 操作（hover 显形）/ **状态徽标**——徽标在行的最右端，字母沿列表纵向对齐，且自带 tooltip 说明这是什么状态
- FR-1.3 支持列表/树形两种展示模式切换（树形按目录折叠）
- FR-1.4 **自动刷新**：监听工作区与 git 目录的**文件系统事件**（`fs.watch`；递归建立失败时自动降级为轮询）+ 定时兜底轮询（面板可见时 10s，不可见时停止）。事件按 burst 窗口合并，重读结果与上次指纹相同则不重渲染；同时保留手动刷新按钮
- FR-1.5 分支行显示：当前分支名、相对上游的 ↑n/↓n（ahead/behind）、detached HEAD / 空仓库（无提交）特殊态
- FR-1.6 **记住视图选择**（按容器记忆）：列表/树形、折叠的目录与分组、底部 dock 的高度与上次看的标签、所选仓库。刷新与会话切换不得把这些悄悄改回去
- FR-1.7 **文件类型图标可配**：部署可在配置文件里一行一个「扩展名: SVG 路径」覆盖内置图标（默认 `$DSH_HOME/git-panel-icons.yml`，路径本身也可配）。文件改过之后按需重读，坏行只记一句日志，不拦面板

#### FR-2 Diff 查看

- FR-2.1 点击变更列表中的文件，在**侧边栏内嵌 diff 视图**或主区 tab 中打开 diff（不弹模态框）
- FR-2.2 未暂存改动对比 HEAD↔工作区；已暂存改动对比 HEAD↔索引；未跟踪文件按全新增渲染
- FR-2.3 逐词（word-level）高亮：移植 VS Code `DefaultLinesDiffComputer` 的标记逻辑（CnsMaple/dsh-plugin-git 已验证可行，MIT 可参考）
- FR-2.4 支持上下（inline）/ 左右（side-by-side）布局切换，记住用户选择
- FR-2.5 二进制文件显示"二进制文件不显示差异"
- FR-2.6 大文件保护：单文件 diff 超过 5000 行时默认折叠，点击加载
- FR-2.7 冲突文件的 diff（`diff --cc`，三列前缀那种）本期**整段跳过**并说明"合并差异暂不支持"，而不是把三列前缀当普通 diff 渲染出乱码

#### FR-3 提交管理

- FR-3.1 文件行操作按钮（hover 显现）：`+` 暂存 / `−` 取消暂存
- FR-3.2 分组标题行提供**组级批量操作**：全部暂存、全部取消暂存。该组没有可操作的行时不显示（不留一个空按钮）；有选中时改文案为"暂存选中（N）"并只作用于选中
- FR-3.3 提交框常驻于面板顶部（分支行下方），支持多行；`Ctrl+Enter` 提交
- FR-3.4 **提交范围显式化**：有已暂存内容时只提交暂存区；无任何暂存时按钮文案变为"提交全部已跟踪更改"并明示将执行 `add -u`；只有未跟踪文件时按钮禁用并提示先暂存
- FR-3.5 **AI 生成提交信息**：提交框旁 ✨ 按钮，基于暂存区 diff（截断保护）调 LLM 生成 conventional commits 风格信息，一键填入可编辑
- FR-3.6 提交历史列表：短 hash、subject、作者、相对时间、○未推送/●已推送 标记、**引用徽标**（本地分支 / 远程分支 / 标签，最多三条，其余折成 `+N`）；点击展开详情（完整信息、文件清单、每文件增删行、可下钻看该提交的 diff）
- FR-3.7 历史分页：默认 30 条，"加载更多"按钮，上限 500 条
- FR-3.8 撤销最近提交（仅最新一条）：二次确认；未推送走 `reset --mixed`（改动退回工作区），已推送走 `revert`（新建反转提交，不改写已发布历史）；执行前由后端重新核实推送状态与 HEAD，过期的一行会被拒绝而不是默默撤销别的提交
- FR-3.9 **复制提交信息**：提交行的工具条提供复制短哈希 / 完整哈希 / 提交信息（subject 首行）。复制走浏览器剪贴板，写失败也落在同一条错误通道里说一句，而不是静默

#### FR-4 分支管理

- FR-4.1 分支下拉：列出所有本地分支，当前分支高亮带勾选，点击切换
- FR-4.2 **新建分支**：下拉底部"新建分支…"入口，输入名称后 `checkout -b`；支持"基于当前分支/基于指定提交"
- FR-4.3 **删除分支**：分支项 hover 显示删除按钮，二次确认；当前分支与未合并分支给出保护提示（未合并需强制确认）
- FR-4.4 切换分支遇阻（工作区脏文件冲突）时，完整展示 git 的多行错误输出，并提供"贮藏后切换"快捷选项：**一击**做"贮藏（含未跟踪文件）→ 重试同一次切换"（被 git 挡住的常见原因正是那些未跟踪文件），失败则照旧报第二次拒绝
- FR-4.5 下拉里带一段**远程分支只读列表**（`origin/xxx`），便于对照。检出远程分支（快进 / rebase onto origin / drop local commits）**不在本期范围**，登记在 `plan.md` §10.3

#### FR-5 远程同步

- FR-5.1 三个常驻动作：**拉取 ↓**、**推送 ↑n**、**同步 ⇅**（pull --rebase=false + push），按 ahead/behind 状态启用
- FR-5.2 首次推送无上游分支时自动 `push --set-upstream origin <branch>`
- FR-5.3 pull 产生冲突时进入冲突态 UI（见 FR-9）
- FR-5.4 推送被拒绝（non-fast-forward）时提示"远端有新提交"，建议改为"同步"按钮高亮引导，而不是甩给用户一句去终端
- FR-5.5 **获取所有远程**（`git fetch --all`，不带 prune）：一个常驻按钮，读回各远程分支的新位置
- FR-5.6 上游被删除时点名说"上游分支已不存在"，而不是转发 git 的谜语
- FR-5.7 远端要求凭据（HTTPS）时就地询问用户名/口令，并在成功后**自动重跑**被挡下的那次操作（见 FR-11）

### 3.3 P1 详细需求

#### FR-6 更改操作

- FR-6.1 文件行提供**放弃更改**（discard）按钮：已跟踪文件 `restore`（用索引里的版本盖回工作区，**不取 HEAD**，因此未出生分支上也成立），索引不认识的路径才真删文件；必须二次确认且文案明确"不可恢复"。**只在工作区侧的行提供**（"更改"与"未跟踪"）：已暂存行展示的是索引里那份改动，在那里丢弃会连带丢掉该行没在展示的工作区改动
- FR-6.2 贮藏（stash）：存（可带消息、可选是否含未跟踪文件，默认不含）、列表、应用（pop/apply）、删除；条目按 commit id 寻址，过期条目由后端拒绝，不按栈内位移猜
- FR-6.3 多选与批量：文件行带勾选框（目录节点三态），有选中时分组头部的批量动作只作用于选中子集（"暂存选中（N）"）；同一路径在两个分组里各勾一次是两件事，勾选随快照修剪、切会话清空，不落盘
- FR-6.4 **复制路径**：文件行的工具条提供复制相对路径 / 绝对路径。绝对路径由仓库根前缀拼出，客户端不碰文件系统

#### FR-7 历史增强

- FR-7.1 提交图：历史列表旁内嵌 SVG 泳道图（分叉开新道、合并收道），分页不断线
- FR-7.2 提交详情内可直接查看任一文件的完整 diff（复用 FR-2 渲染器，开在同一个 dock 里）
- FR-7.3 改动与提交的详情列各自可折叠；底部 dock 的高度可拖，且这个高度按容器记忆

### 3.4 P2 详细需求

#### FR-8 多仓库

- FR-8.1 工作区根非仓库时扫描一层子目录（跳过 node_modules/dist/build/点开头目录），提供仓库下拉
- FR-8.2 默认选中 `.git` 最近活动的仓库，选择按容器记忆

#### FR-9 冲突处理

- FR-9.1 冲突文件独立成组（状态徽标 `!`），并在列表上方的**在途操作条**里说清现在处于哪种操作
- FR-9.2 每个冲突文件提供"标记已解决"（`git add`）。**"打开文件"本期不提供**：本 profile 没有"按路径打开文件"的缝，登记在 `plan.md` §10.4
- FR-9.3 在途操作条按操作种类说话：继续（merge / revert / cherry-pick / rebase 各自的 `--continue`）、中止（各自的 `--abort`，两次点击）、以及**只对 rebase 出现**的跳过。继续与跳过在有未解决冲突时禁用；状态从 git 目录的状态文件 `stat` 得来，与冲突分组无关（冲突全部暂存后分组就空了，而操作还在）
- FR-9.4 状态条上的一切都在**执行时重新核实**：host 现读在途状态并要求与请求里的种类相符，过期的浏览器读数不能决定跑哪条 `--abort`

### 3.5 交付期新增的 P1 需求

下面两条不在 v0.2 草案里，是交付过程中由产品方逐条加进来的，按同一套规范（§4 交互、§5.5 安全）实现。已交付。

#### FR-10 历史改写

- FR-10.1 **还原此提交**（revert）：在当前分支新建一个反转该提交的新提交；已发布的历史不改写
- FR-10.2 **捡取此提交**（cherry-pick）：把该提交的改动应用到当前分支（新提交）；改动本来就在时，由后端清掉留下的空操作现场并如实拒绝，而不是留一个无事可做的在途状态
- FR-10.3 **压缩到上一个提交**（squash）：把该提交并入其父提交，**保留父提交的信息**（等价 git 的 `fixup`）
- FR-10.4 **丢弃此提交**（drop）：删除该提交，并重放其后的提交
- FR-10.5 **重置到此提交…**：展开软 / 混合 / 硬三档，各自确认；硬重置的确认文案必须点名"未提交的改动会被丢弃（不可恢复）"
- FR-10.6 上述每一条都**两次点击**（§4.3），且**第一次点击后条目自己说出第二击会做什么**；确认文案里的判断（是否已推送、有没有父提交）由后端在执行时重核，前后两处不许各说各话
- FR-10.7 **拒绝而非猜**：目标是合并提交、目标不是当前分支的祖先、目标之后有合并提交、游离 HEAD、已有操作在途——一律拒绝并说明，不替用户把分支线性化
- FR-10.8 改写**交给 git 自己的 rebase**（`--onto` / `-i` + 临时 sequence editor），不自己重造历史；中断（冲突、空 pick）进入 FR-9 的在途操作条，且不会改写超出请求范围的东西

#### FR-11 凭据（HTTPS）

- FR-11.1 push / pull / fetch 因缺少凭据失败时，在失败通知里**就地**给出用户名/口令表单，不弹模态、不清空列表
- FR-11.2 保存的凭据写进 **DSH 自己的凭据缝**（`ctx.credentials`），插件不自己落盘
- FR-11.3 保存成功后**自动重跑**被挡下的那次操作，并如实报告结果
- FR-11.4 本期只覆盖 HTTPS。SSH、代理、同主机多仓库不同凭据不在本期（`plan.md` §11 已逐条登记）

### 3.6 已登记、尚未排期的需求

下面这些**要求成立但本期没做**，逐条带原因与前置条件记在 `plan.md` §10.3。列在这里是为了让"要什么"完整，不代表已交付。

| 需求 | 现状 |
|---|---|
| 检出远程分支（快进 / rebase onto origin / drop local commits） | 只读列表已交付（FR-4.5）；把它变成动作要先定"本地有未提交改动怎么办"与重名规则，后两条路都是破坏性的 |
| 非仓库时的「初始化仓库」按钮 | 现在只有一句文案（§4.3 的空态引导） |
| 通知时长接进 DSH 设置 | 现在是代码里的常量；要可配得先有插件的配置面（`settings.section` 槽 + host 侧的设置读写） |
| 上下方向键导航变更列表 | `Ctrl+Enter` / `Esc` / `Shift+F10` 已有，这一条没有 |
| diff 虚拟滚动 + 千文件仓库 / monorepo 压测 | 现靠 FR-2.6 的折叠门兜底；`status < 500ms` 未在真实大仓库上验过 |
| gpg 签名卡死的专门文案 | `commit.gpgsign=true` 时提交会卡到 15s 截止，`GIT_TERMINAL_PROMPT=0` 管不到 gpg |
| 凭据的其余角落（SSH / 代理 / 同主机多仓库不同凭据） | 见 FR-11.4 |
| 在**右侧栏自己的标签页**里打开 diff | 产品方 2026-09-13 提出；现在开在面板底部的 dock 里。路已通，排期前要先定三件事（一条文件一条标签还是共用一条、标签条归谁、dock 留不留） |

---

## 4. 交互与 UI 需求

### 4.1 形态

- **注册为 Sidebar tab 页**（与内置 Files 标签并列，通过 ＋ 打开），**禁止模态浮层**——这是与 EasyTZ 方案的核心差异，保证"看变更与干活并行"
- 面板宽度跟随侧边栏，不做固定宽度弹窗

### 4.2 布局（自上而下）

```
┌──────────────────────────────────┐
│ 🌿 main ↑2 ↓0  ⇅ ↓ ↑f ⟳  ⌂ 🌱 ☰ │ ← 分支行：分支 / 同步三件 /
├──────────────────────────────────┤   获取所有远程 / 刷新 / 仓库 /
│ ▼ 已暂存的更改            3  ±×  │   贮藏 / 列表·树形
│   M  src/foo.ts              −   │ ← 已暂存的更改（抽屉，可收起）
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 提交信息…                 ✨ │ │ ← 提交框（Ctrl+Enter）
│ └──────────────────────────────┘ │
│                  [ 提交 (3) ]    │ ← 按钮带暂存数量
├──────────────────────────────────┤
│ ▼ 更改                    2  +×  │
│   ☐ M  src/bar.ts    +  🗑  M    │ ← 行：勾选 / 类型图标 / 路径 /
│ ▼ 未跟踪的文件            1  +   │   操作（hover 显形）/ 状态徽标
├──────────────────────────────────┤
│ [文件 1] [历史]                  │ ← 底部 dock：diff 与历史，
│   …diff 或提交详情…              │   高度可拖、按容器记忆
└──────────────────────────────────┘
```

有两层东西**浮在列上、不占列内空间**：通知（见 4.3）与右键工具条。

### 4.3 交互细则

- **可发现性**：所有可操作控件必须有 hover 态 + tooltip；分支名一眼可辨为可点控件（EasyTZ 教训）。**行的操作按钮 hover 显形**（键盘焦点下同样显形），行的其余部分保持安静。**可点的纯文字必须是"动作"墨色**（`--dsw-alias-link` + 同一套 hover 淡底），三级墨色只留给脚注（"取消"、"折叠"这类）——"看不出这两个能点"是本项目反复踩到的坑
- **二次确认**：用于不可逆操作（discard、删除分支、撤销提交、还原/捡取/压缩/丢弃/重置、中止在途操作）；采用"点击武装→3s 内再点执行"模式，不用原生 confirm。武装期间**界面上的按钮本身变了**（文字说出第二击会做什么），而不是同一个图标换个颜色
- **右键工具条**：行级动作用右键（或 Shift+F10 / 菜单键）打开，**是它自己的一层**，不是分支下拉/贮藏那种整栏宽的浮层——开在指针处、宽度由自己的文字决定、贴右边缘收回、太靠下时翻到光标上方；条目**"对仓库做什么"在上、"取走什么"（复制）在下**，中间一条分隔线；`git` 的动作**不用红色标注**——警告由确认句与第二击承担，颜色不担这个职责
- **同时只开一层**：分支下拉、贮藏层、右键工具条互斥；点外部或 Esc 关闭，打开另一层时其余收起
- **反馈呈现**：成功与失败都**浮在面板上**，不占列内的行、不把用户正要点的东西顶开。成功 4s 自动消失；失败一直留到按 ×，因为那是"这一击为什么没生效"的解释，要保留 git 的多行原文与出路（如"贮藏后切换到 X"）
- **空态引导**：无变更显示干净状态图标；无提交显示"提交后这里会显示历史"。"初始化仓库"按钮**本期未提供**，登记在 `plan.md` §10.3
- **主题**：全部颜色走 DSH 设计 token（`--dsw-alias-*`），禁写死色值，深浅主题自适应；并且**引用的 token 必须真的存在**——引用不存在的变量会让该条声明在计算值阶段失效（按 `unset` 处理，`background` 即变透明）且**不报错**
- **键盘**：`Ctrl+Enter` 提交、`Esc` 关闭下拉/详情/工具条、`Shift+F10`（或菜单键）打开行工具条、工具条内 ↑/↓ 与 Home/End 导航且 Enter 先关后执行；上下方向键导航文件列表**尚未提供**（`plan.md` §10.3）

### 4.4 状态联动

- 工作区跟随当前活跃会话自动切换（参考 EasyTZ 的 sessions 联动），用户手动选择不被联动拽回
- agent 在会话中执行 git 操作后（文件监听触发），面板 1s 内自动反映

---

## 5. 技术架构需求

### 5.1 总体结构（含兼容层）

```
dsh-git-panel/
├── cordis.patch.yml            # bundle 层，安装即激活
├── package.json                # dsh.bundle 清单
├── src/
│   ├── core/                   # ★ 核心层：零 DSH 依赖，纯 TS，能在裸 Node 里跑
│   │   ├── ports.ts            #   全部对外接口（HostPorts / ClientPorts）
│   │   ├── types.ts            #   领域模型（FileChange/BranchInfo/CommitInfo/DiffHunk…）
│   │   ├── git-parse.ts        #   porcelain v2 / numstat / log / stash 解析（纯函数）
│   │   ├── validate.ts         #   hash / 分支名 / 路径 / 词表（重置模式、改写动作…）校验
│   │   ├── change-tree.ts      #   列表 → 树、目录选中集
│   │   ├── commit-graph.ts     #   提交图的泳道分配（纯函数）
│   │   ├── diff-parse.ts + diff-target.ts
│   │   ├── format.ts / file-kind.ts / icon-config.ts / commit-*.ts …
│   │   └── diff-engine/marks.ts #  移植 VS Code DefaultLinesDiffComputer 的逐词标记
│   ├── host/                   # Host 半（Node，跑在 DSH 进程内）
│   │   ├── index.ts            #   插件入口 apply(ctx)：只负责装配
│   │   ├── adapter/            #   ★ DSH 适配器（唯一允许 import cordis/dsh 的目录）
│   │   │   ├── routes.ts       #     HTTP 路由注册（含 loopback 网关与读/写名单）
│   │   │   ├── workspace.ts    #     ctx.workspaceRegistry → HostPorts.resolveRepo
│   │   │   ├── credentials.ts  #     ctx.credentials → HostPorts 的凭据读写
│   │   │   ├── llm.ts          #     ctx.llm → HostPorts.generateText
│   │   │   └── logger.ts       #     ctx 日志 + 审计 → HostPorts.log/audit
│   │   ├── git-exec.ts         #   execFile 封装：队列锁 / 超时 / 环境策略（不挂死）
│   │   ├── git-service.ts      #   实现 core 的 GitService 契约（编排 git-exec + parse）
│   │   ├── git-probe.ts        #   fs.watch 探测（工作区 + git 目录）→ 变更事件
│   │   ├── git-dir.ts          #   git 目录定位、在途操作的状态文件 stat
│   │   ├── askpass.ts / sequence-editor.ts   # 两个静态 helper（凭据、改写 todo）
│   │   ├── repo-discovery.ts / file-icons.ts # 多仓库扫描、图标配置读取
│   │   └── index.ts
│   └── client/                 # 浏览器半（React）
│       ├── index.tsx           #   入口：只负责装配
│       ├── locales.ts          #   zh/en 两本字典
│       ├── adapter/            #   ★ DSH 适配器（唯一允许碰 slots/locale/store 的目录）
│       │   ├── sidebar-tab.tsx #     sidebar tab 注册（含 pane/tab body）
│       │   ├── git-client.ts   #     HTTP 客户端 + SSE 订阅（对应 5.4 的契约）
│       │   ├── tab-body.tsx / locale.ts
│       └── ui/                 #   ★ 纯 React 组件，只依赖 core/* 与自己的通用件
│           ├── StatusPanel.tsx #     面板装配：分区、层、通知、操作
│           ├── DiffView.tsx / History.tsx / CommitBox.tsx / BottomPane.tsx
│           ├── ChangeGroup.tsx / BranchPicker.tsx / StashPicker.tsx
│           ├── popover.tsx     #   rail 的两层（分支、贮藏）共用的浮层
│           ├── toolbar.tsx     #   右键工具条自己的层（D54）
│           ├── notice.tsx / armed.ts / panel-layout.ts / styles.ts / icons.tsx
└── test/                       # node --test：core 纯函数 + 真仓库集成 + jsdom 客户端
```

### 5.2 兼容层设计（DSH SDK 防腐层）

**动机**：DSH 处于 rc 阶段，client-plugin 的 slots / Remote / locale 等 API 在版本间可能变动。插件本体（git 业务逻辑 + UI 组件）不能直接依赖这些不稳定 API，否则每次 DSH 升级都要全仓改代码。

**规则（依赖方向钉死，用 eslint `no-restricted-imports` 强制）**：

1. **`src/core/` 禁止 import 任何 DSH/cordis 包**——它是纯 TypeScript，能在普通 Node 测试进程里直接跑
2. **`src/host/adapter/` 与 `src/client/adapter/` 是唯一允许 import DSH API 的地方**——每个 DSH 能力对应一个小适配器文件，把 DSH 的类型翻译成 core/ports 里我们自己定义的中性类型
3. **`src/host`（业务）与 `src/client/ui/` 只允许 import core 和 adapter 的接口**，禁止直接引用 `ctx.*`、`@deepseek-ai/*`、`window.__DSH_*`

**效果**：DSH SDK 升级时，改动面被收口在 adapter 目录（预计每侧 3~5 个小文件）。核心业务逻辑、解析器、UI 组件零改动。适配器同时是**文档**——想知道我们用了 DSH 的哪些能力，看 adapter 目录即可。

**Ports**（以 `src/core/ports.ts` 里的真实接口为准，这里是它的形状）：

```ts
// core/ports.ts — Host 侧：core 需要 DSH 提供的那几样本事
interface HostPorts {
  resolveRepo(sessionId: string, root?: string): Promise<Result<string>>;  // → 真实路径
  generateText(prompt: string, signal?: AbortSignal): Promise<Result<string>>; // → LLM
  credentials: GitCredentialStore;   // read/save，落在 DSH 自己的凭据缝
  log(level: LogLevel, message: string): void;
  audit(entry: string): void;        // 破坏性操作的审计行
}

// core/ports.ts — 业务契约（两侧各实现一份：host 是执行者，客户端是调用者）
interface WorkspaceGitService { /* 见 5.4 的每一条路由，一一对应 */ }
interface GitRemoteClient { /* 同一份契约的客户端镜像 */ }
```

客户端不直接触 DSH 的能力，而是经由 `client/adapter/` 拿到三样东西：`git`（上面那份契约）、`t`（locale）、以及工作区/会话订阅。**没有**"按路径打开文件"这一条：本 profile 没有这个缝，所以 FR-9.2 的"打开文件"本期不提供。

**升级时的移植工作流**：DSH 升级 → 构建报错集中在 adapter → 逐文件对照上游变更修复 → 跑 core + 集成测试验证。

### 5.3 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 分层 | core（零依赖）+ adapter（DSH 适配）+ 业务/UI | DSH rc 阶段 API 不稳定，防腐层收口升级成本（见 5.2） |
| 前后端通道 | **webServer HTTP 路由 + SSE**，经 adapter 封装 | TypertRemoteService 的 wire schema 由未随发行版发布的生成器产生，手写无先例；同 profile 的成熟第三方 git 插件也走 HTTP 路由。改动面收口在 `client/adapter/git-client.ts` 与 `host/adapter/routes.ts` |
| UI 挂载 | Sidebar tab（与内置 Files 并列） | 非模态，看变更与干活并行（4.1） |
| git 执行 | `execFile` + 参数数组 | 禁 shell 插值；同仓库串行队列防 index.lock；**环境策略**统一在这里（`GIT_TERMINAL_PROMPT=0`、`GIT_EDITOR=true`、按需注入 askpass / sequence editor），且读取一律 `GIT_OPTIONAL_LOCKS=0`——否则一次"读"会改写 `.git/index`，而监听器正盯着它，面板会自己刷新自己 |
| diff 读取 | `--no-color --no-ext-diff --no-textconv --unified=N`，未跟踪文件走 `--no-index` | 面板的配色与对齐不能由用户/仓库的 git 配置改写；`--no-index` 让未跟踪文件也能按全新增渲染 |
| 第三方依赖 | 只有一个：`vscode-diff`（MIT、零依赖），只被 core 的 diff 引擎用到 | 自己实现逐词标记的成本远大于这一层依赖；换实现只影响 `core/diff-engine/marks.ts`，且 client bundle 不引用它 |
| diff 引擎 | 移植 VS Code `DefaultLinesDiffComputer` 入 core | MIT，CnsMaple 已验证路径；纯函数天然属于 core 层 |
| 状态分发 | `fs.watch` 探测（工作区 + git 目录）→ SSE → 客户端订阅 | 替代轮询，agent 改动即时可见；探测失败自动降级为轮询 |
| 历史改写 | 交给 git 自己的 `rebase --onto` / `rebase -i` + 临时 sequence editor | 冲突、sequencer、`--abort` 全由 git 管；面板只负责**拒绝**它不该决定的场合（FR-10.7），不自己重造历史 |
| 浮层 | rail 的层用 `ui/popover.tsx`（贴锚点、整栏宽），**右键工具条用自己的 `ui/toolbar.tsx`**（贴指针、内容宽） | 两种东西不该长成一个样：一个是打开来读的列表，一个是召来用一次就走的动作 |
| 反馈 | 成功与失败都浮起（`ui/notice.tsx`），成功按时关、失败手动关 | 一次操作的报告不该把用户正要点的东西顶开（4.3） |
| 颜色 | 只认 DSH **定义过的** alias token | 引用不存在的 token 会让该声明在计算值阶段失效并静默变透明；2026-09-13 修掉过 11 处 |
| AI 提交信息 | host 端经 `HostPorts.generateText` 调 LLM | UI/业务不感知 `ctx.llm` 的存在；缺模型时是一个普通失败 |
| 凭据 | 经 `HostPorts` 读写 **DSH 自己的凭据缝** | 插件不自己落盘，也不把凭据带进前端状态 |

### 5.4 前后端契约（HTTP 路由 + SSE）

浏览器半**只能发** `{ sessionId, ...参数 }`；host 用自己 session store 里的 cwd 解析真实路径，参数一律先过 `core/validate.ts` 的形状校验。路由前缀 `/git-panel/`。

| 方法 | 路由 | 内容 |
|---|---|---|
| GET | `status` | 分支、是否游离/未出生、ahead/behind、三组变更 + 冲突组、在途操作种类、仓库根、上游是否还在 |
| GET | `branches` / `remoteBranches` / `repos` | 本地分支；远程分支（只读）；工作区里的仓库清单 |
| GET | `log` / `showCommit` | 提交历史（分页）与单条提交详情（文件清单 + 每文件增删行） |
| GET | `diff` | 一条 diff：目标可以是工作区、索引，或**某次提交里的某个文件** |
| GET | `stashes` / `fileIcons` | 贮藏栈；部署配置的图标映射 |
| GET | `events`（SSE） | 变更事件流（`refs` / `index` / `worktree`），按 burst 合并，驱动自动刷新 |
| POST | `stage` / `unstage` / `discard` | 暂存、取消暂存、放弃更改（路径数组；discard 由 host 按索引决定走 restore 还是删文件） |
| POST | `commit` | 只提交暂存区；无暂存时前端文案换成显式的 `add -u` 分支 |
| POST | `checkout` / `createBranch` / `deleteBranch` / `selectRepo` | 分支与多仓库 |
| POST | `push` / `pull` / `fetch` / `sync` | 远程同步（`fetch` 不带 prune；`sync` 是 pull 后 push） |
| POST | `undoCommit` / `revertCommit` / `cherryPick` / `reset` / `rewrite` | 撤销与历史改写；后端在执行时重核 HEAD、推送状态与祖先关系 |
| POST | `continueOperation` / `skipOperation` / `abortOperation` | 在途操作；请求带种类，后端现读状态并要求相符（FR-9.4） |
| POST | `stashSave` / `stashApply` / `stashDrop` | 贮藏 |
| POST | `saveCredential` | 保存 HTTPS 凭据。不是仓库改动，但它决定面板接下来读什么、花谁的预算，所以与 `generateCommitMessage` 一样要 POST + 同源 |
| POST | `generateCommitMessage` | AI 提交信息 |

> 读接口只走 GET，写接口只走 POST（GET 打到写接口一律 405）。这份契约定义在 `core/ports.ts`（中性类型），host adapter 注册成 HTTP 路由，client adapter 消费；换通道时 core 与 UI 不动。

### 5.5 安全需求（继承 EasyTZ 的合理设计，并按实现收紧）

- 浏览器半**只能传不透明 sessionId + 相对路径 / 分支名 / hash**，绝不传绝对路径；host 端经 session store 解析 cwd，因此没有"穿越检查写错"的余地
- 所有 git 参数校验形状：hash 只放行 `^[0-9a-f]{4,40}$`；分支名禁 `..`、`:`、控制字符、以 `-` 开头；路径禁绝对路径与 `..` 穿越；**会变成 git flag 或子命令的取值（重置模式、改写动作、在途操作种类）只能从固定词表里取**，浏览器的原话不进命令行
- `GIT_TERMINAL_PROMPT=0`，凭据缺失快速失败不挂死；gpg 之类管不到的交互另有登记（`plan.md` §11）
- **自带网关**：第三方 `webServer` 路由不在 DSH 前端鉴权覆盖范围内（实测 `/` 401 而 `/git-panel/*` 200），所以这一层自己做 loopback-only、同源校验、POST 才允许写、请求体上限（1 MiB）
- 破坏性操作（discard、deleteBranch、undoCommit、revert/cherry-pick/reset/rewrite、continue/skip/abort、stashDrop）在 host 层**记审计日志**；discard 逐条列出被丢弃的路径（文件已经没了，日志是唯一记录）
- 每条路由的输出有大小上限：巨型 diff 截断并带上 `truncated` 标记，而不是打爆内存
- **不外发任何数据**：没有遥测、没有匿名心跳

---

## 6. 非功能需求

| 类别 | 要求 |
|---|---|
| 性能 | status 刷新 < 500ms（千文件仓库）；diff 渲染千行不卡顿（**虚拟滚动尚未做**，§10.3）；大仓库超时后返回部分结果 + 提示，不阻塞 UI |
| 兼容 | dsh ≥ 0.1.5-rc.1；Windows/macOS/Linux 同一代码路径；git ≥ 2.20 |
| 可维护性 | DSH SDK 升级的改动面 ≤ adapter 目录（每侧 4–5 个小文件）；core 与 UI 零改动 |
| 国际化 | zh/en 双语字典，走 locale 适配器；**组合句也随语言切换**（占位值可以再是一句话） |
| 可测试 | core 纯函数零依赖，`node --test` 覆盖；git 操作用临时**真仓库**做集成测试；UI 行为用 jsdom 覆盖。`npm run check` = `tsc --noEmit` + 566 项测试 + 两个打包产物 |
| 安装 | `dsh plugin --profile web add <pkg>` 一条命令，自带 `dsh.bundle`，无需手写 patch。**目前只验过 `link:` 装法**，真实装法是 v1.0 收尾项 |
| 隐私 | 不外发任何数据：无遥测、无匿名心跳 |

---

## 7. 里程碑

| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| M0（地基） | core 层骨架（types/ports/git-parse）+ host/client adapter 最小实现 + 依赖方向规则 | 解析器测试全绿；adapter 目录是唯一碰 DSH API 的地方 | ✅ 2026-09-12 |
| M1（骨架） | host service + status/log/branches 只读 + sidebar tab 渲染变更列表 | 面板能看到当前仓库变更分组与分支 | ✅ |
| M2（提交闭环） | stage/unstage/commit/push/pull + 提交框 + 历史 | 不碰终端完成 改→暂存→提交→推送 全流程 | ✅ |
| M3（diff） | diff 视图 + 逐词高亮 + 布局切换 | 点文件可见 VS Code 级 diff | ✅（数据面端到端核对过，观感待人工看） |
| M4（分支+同步完善） | 新建/删除分支、sync、冲突标记、AI 提交信息 | 分支管理与同步全在面板内闭环 | ✅ |
| M5a（P1 写操作） | 行级菜单机制、discard、撤销最近提交、贮藏 | 破坏性写操作全部经武装确认 + 审计 | ✅ 2026-09-12 |
| M5b（P1/P2 + 收尾） | 提交图、下钻 diff、多仓库、**历史改写**、fetch、远程分支、凭据 | 发布 v1.0 | ✅（只差顺序 10 的发布收尾） |

超出原清单、由产品方在交付期加进来的：历史改写（FR-10）、获取所有远程、远程分支只读列表、HTTPS 凭据（FR-11）、右键工具条（4.3）。逐条来龙去脉见 `plan.md` §10。

---

## 8. 风险与开放问题

> 本清单只留**仍然成立**的风险；每条的实际状态、实测证据与未覆盖的场景记在 `plan.md` §11（那才是活的清单）。

1. **DSH client-plugin API 稳定性**：已证实是真问题（`httpServer` 被改名为 `webServer`），防腐层正在起作用——改动面收口在 adapter 目录
2. **watcher 可靠性**：主路径已改为文件系统事件；`fs.watch` 在同步盘/网络盘上仍可能不可靠，因此保留轮询兜底，且**两条路径都未在真实同步盘上验过**
3. **AI 提交信息成本**：只有点击才生成，diff 截断（12 000 字符）并提示，`maxTokens = 512`；**未用真实 provider 跑过**
4. **大仓库性能**：超时（15s）与 `truncated` 标记已就位；**未在真实 monorepo 上压过**，diff 也还没有虚拟滚动
5. **兼容层的代价**：多一层间接，简单功能（如 locale 翻译）也要过一道 ports → 接受，用依赖方向规则防"图省事绕过去"
6. **安装路径**：一条命令装的真实路径还没走过（只验过 `link:`），是 v1.0 收尾项
7. **浏览器目视验收**：M3 之后的全部 UI 行为只有 jsdom 覆盖；真实观感需要人在浏览器里看一眼（本仓库的会话没有可用的 browser provider）
8. **网络与凭据的边角**：https/ssh 的真实 push/pull、代理、同主机多仓库不同凭据、`commit.gpgsign=true` 时提交可能卡在 gpg 提示上——逐条见 `plan.md` §11
