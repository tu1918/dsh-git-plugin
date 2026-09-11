# DSH Git 插件需求文档

> 项目代号：**dsh-git-panel**（暂定）
> 版本：v0.2 草案（新增 5.2 兼容层设计）
> 日期：2026-09
> 定位：DeepSeek Harness（DSH）Web GUI 的可视化 Git 管理插件，对标 VS Code 源代码管理面板 + IDEA Git 工具窗口的核心体验

---

## 1. 背景与动机

### 1.1 现状

DSH 作为 agent 运行时，会话内产生的代码变更目前只能依靠终端命令或外部 IDE 管理。社区已有相关插件，但均存在明显缺口：

| 插件 | 模式 | 主要缺口 |
|---|---|---|
| EasyTZ/dsh-git | 模态浮层面板 | 无 diff 视图、无新建分支、无 pull、无 discard、无自动刷新；浮层盖住整个界面，看变更与干活不能并行 |
| CnsMaple/dsh-plugin-git | 侧边栏标签页 | **只读**：不能暂存/提交/推送，只有查看能力 |
| Shyboy0499/dsh-git-tools | agent 工具（无 UI） | 面向模型调用，用户无可视化界面 |
| sakthiveltofficial/dsh-git-plugins | agent 工具套件 | 同上，无 GUI |

### 1.2 机会点

没有一个插件同时满足：**常驻侧边栏（非模态）+ 可写操作（暂存/提交/推送）+ diff 查看**。此外 DSH 原生具备 LLM 能力，可以做 VS Code 需要 Copilot 才有的 **AI 生成提交信息**，形成差异化。

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

- 不做完整的 Git GUI（不替代 GitKraken/Fork）：交互式 rebase、blame 视图、submodule 管理不做
- 不做托管平台集成（PR/Issue/CI 属于 sakthiveltofficial 套件的地盘，不重复造）
- 不做 agent 工具（模型调用的 git 工具与本插件解耦，可后续复用同一 host service 另做）

---

## 3. 功能需求

### 3.1 功能总览（按优先级）

| 优先级 | 功能域 | 说明 |
|---|---|---|
| **P0** | 状态管理 | 变更分组列表、文件状态徽标、自动刷新 |
| **P0** | Diff 查看 | 点文件看 diff，逐词高亮，上下/左右布局切换 |
| **P0** | 提交管理 | 暂存/取消暂存（含全部暂存）、提交、提交历史、AI 提交信息 |
| **P0** | 分支管理 | 当前分支展示、切换、新建、删除、ahead/behind |
| **P0** | 远程同步 | 推送、拉取、同步（pull+push） |
| **P1** | 更改操作 | 放弃更改（discard）、stash（贮藏）存取 |
| **P1** | 历史增强 | 提交图（多泳道）、提交详情含 diff |
| **P1** | 撤销 | 撤销最近提交（reset --mixed / revert 自动选择） |
| **P2** | 冲突处理 | 冲突文件标记、解决引导（打开文件/标记已解决） |
| **P2** | 多仓库 | 工作区内多子仓库切换 |

> 术语约定：本文档中**"暂存"专指 stage（git add，代码不动）**；stash 一律称"**贮藏**"，UI 文案同样遵守此约定，避免 Visual Studio 中文版把 stash 也译作"暂存"造成的混淆。

### 3.2 P0 详细需求

#### FR-1 状态管理

- FR-1.1 变更列表分三组展示：**已暂存的更改** / **更改** / **未跟踪的文件**，与 VS Code 分组语义一致
- FR-1.2 每个文件显示状态徽标（M/A/D/R/U/?）+ 相对路径；路径过长时**保留文件名、截断目录部分**（VS Code 风格），tooltip 显示完整路径
- FR-1.3 支持列表/树形两种展示模式切换（树形按目录折叠）
- FR-1.4 **自动刷新**：监听 `.git/index` 与 `.git/HEAD` 的 mtime 变化 + 定时兜底轮询（面板可见时 10s，不可见时停止）；同时保留手动刷新按钮
- FR-1.5 分支行显示：当前分支名、相对上游的 ↑n/↓n（ahead/behind）、detached HEAD / 空仓库（无提交）特殊态

#### FR-2 Diff 查看

- FR-2.1 点击变更列表中的文件，在**侧边栏内嵌 diff 视图**或主区 tab 中打开 diff（不弹模态框）
- FR-2.2 未暂存改动对比 HEAD↔工作区；已暂存改动对比 HEAD↔索引；未跟踪文件按全新增渲染
- FR-2.3 逐词（word-level）高亮：移植 VS Code `DefaultLinesDiffComputer` 的标记逻辑（CnsMaple/dsh-plugin-git 已验证可行，MIT 可参考）
- FR-2.4 支持上下（inline）/ 左右（side-by-side）布局切换，记住用户选择
- FR-2.5 二进制文件显示"二进制文件不显示差异"
- FR-2.6 大文件保护：单文件 diff 超过 5000 行时默认折叠，点击加载

#### FR-3 提交管理

- FR-3.1 文件行操作按钮（hover 显现）：`+` 暂存 / `−` 取消暂存
- FR-3.2 分组标题行提供**组级批量操作**：全部暂存、全部取消暂存
- FR-3.3 提交框常驻于面板顶部（分支行下方），支持多行；`Ctrl+Enter` 提交
- FR-3.4 **提交范围显式化**：有已暂存内容时只提交暂存区；无任何暂存时按钮文案变为"提交全部已跟踪更改"并明示将执行 `add -u`；只有未跟踪文件时按钮禁用并提示先暂存
- FR-3.5 **AI 生成提交信息**：提交框旁 ✨ 按钮，基于暂存区 diff（截断保护）调 LLM 生成 conventional commits 风格信息，一键填入可编辑
- FR-3.6 提交历史列表：短 hash、subject、作者、相对时间、○未推送/●已推送 标记；点击展开详情（完整信息、文件清单、每文件增删行、可下钻看该提交的 diff）
- FR-3.7 历史分页：默认 30 条，"加载更多"按钮，上限 500 条
- FR-3.8 撤销最近提交（仅最新一条）：二次确认；未推送走 `reset --mixed`（改动退回工作区），已推送走 `revert`，执行前由后端重新核实推送状态

#### FR-4 分支管理

- FR-4.1 分支下拉：列出所有本地分支，当前分支高亮带勾选，点击切换
- FR-4.2 **新建分支**：下拉底部"新建分支…"入口，输入名称后 `checkout -b`；支持"基于当前分支/基于指定提交"
- FR-4.3 **删除分支**：分支项 hover 显示删除按钮，二次确认；当前分支与未合并分支给出保护提示（未合并需强制确认）
- FR-4.4 切换分支遇阻（工作区脏文件冲突）时，完整展示 git 的多行错误输出，并提供"贮藏后切换"快捷选项

#### FR-5 远程同步

- FR-5.1 三个常驻动作：**拉取 ↓**、**推送 ↑n**、**同步 ⇅**（pull --rebase=false + push），按 ahead/behind 状态启用
- FR-5.2 首次推送无上游分支时自动 `push --set-upstream origin <branch>`
- FR-5.3 pull 产生冲突时进入冲突态 UI（见 FR-9）
- FR-5.4 推送被拒绝（non-fast-forward）时提示"远端有新提交"，建议改为"同步"按钮高亮引导，而不是甩给用户一句去终端

### 3.3 P1 详细需求

#### FR-6 更改操作

- FR-6.1 文件行提供**放弃更改**（discard）按钮：已跟踪文件 `checkout --`/`restore`，未跟踪文件删除；必须二次确认且文案明确"不可恢复"
- FR-6.2 贮藏（stash）：存（可带消息）、列表、应用（pop/apply）、删除

#### FR-7 历史增强

- FR-7.1 提交图：历史列表旁内嵌 SVG 泳道图（分叉开新道、合并收道），分页不断线（参考 CnsMaple 实现）
- FR-7.2 提交详情内可直接查看任一文件的完整 diff（复用 FR-2 渲染器）

### 3.4 P2 详细需求

#### FR-8 多仓库

- FR-8.1 工作区根非仓库时扫描一层子目录（跳过 node_modules/dist/build/点开头目录），提供仓库下拉
- FR-8.2 默认选中 `.git` 最近活动的仓库，选择按工作区记忆

#### FR-9 冲突处理

- FR-9.1 冲突文件（U 状态）红色标记独立分组"合并冲突"
- FR-9.2 每个冲突文件提供：打开文件（调 DSH 文件编辑器）、标记已解决（add）
- FR-9.3 全部解决后提示"继续合并"（commit）或"中止合并"（merge --abort）

---

## 4. 交互与 UI 需求

### 4.1 形态

- **注册为 Sidebar tab 页**（与内置 Files 标签并列，通过 ＋ 打开），**禁止模态浮层**——这是与 EasyTZ 方案的核心差异，保证"看变更与干活并行"
- 面板宽度跟随侧边栏，不做固定宽度弹窗

### 4.2 布局（自上而下）

```
┌─────────────────────────────┐
│ 🌿 main  ↑2 ↓0   ⇅ ↓ ↑  ⟳  │  ← 分支行 + 同步动作 + 刷新
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ 提交信息…            ✨ │ │  ← 提交框（Ctrl+Enter）
│ └─────────────────────────┘ │
│              [ 提交 (3) ]   │  ← 按钮带暂存数量
├─────────────────────────────┤
│ ▼ 已暂存的更改        3  ±× │
│   M  src/foo.ts          −  │
│ ▼ 更改                2  +× │
│   M  src/bar.ts      +  🗑  │
│ ▼ 未跟踪的文件        1  +  │
├─────────────────────────────┤
│ ▶ 最近提交                  │
└─────────────────────────────┘
```

### 4.3 交互细则

- **可发现性**：所有可操作控件必须有 hover 态 + tooltip；分支名一眼可辨为可点控件（EasyTZ 教训）
- **二次确认**：仅用于不可逆操作（discard、删除分支、撤销已推送提交）；采用"点击武装→3s 内再点执行"模式，不用原生 confirm
- **错误呈现**：操作级错误就地显示在操作点附近（不清空整个列表）；git 多行输出保留换行
- **空态引导**：非仓库显示"初始化仓库"按钮（git init）；无变更显示干净状态图标；无提交显示"提交后这里会显示历史"
- **主题**：全部颜色走 DSH 设计 token（--dsw-alias-*），禁写死色值，深浅主题自适应
- **键盘**：Ctrl+Enter 提交、Esc 关闭下拉/详情、上下方向键导航文件列表（P1）

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
│   ├── core/                   # ★ 核心层：零 DSH 依赖，纯 TS
│   │   ├── ports.ts            #   全部对外接口（HostPorts / ClientPorts）
│   │   ├── types.ts            #   领域模型（FileChange/BranchInfo/CommitInfo/DiffHunk…）
│   │   ├── git-parse.ts        #   porcelain v2 / numstat / log 解析（纯函数）
│   │   └── diff-engine/        #   移植 VSCode DefaultLinesDiffComputer
│   ├── host/                   # Host 半（Node，跑在 DSH 进程内）
│   │   ├── index.ts            #   插件入口 apply(ctx)：只负责装配
│   │   ├── adapter/            #   ★ DSH 适配器（唯一允许 import cordis/dsh 的目录）
│   │   │   ├── remote.ts       #     TypertRemoteService 注册与描述符
│   │   │   ├── workspace.ts    #     ctx.workspaceRegistry → HostPorts.resolveRepo
│   │   │   ├── llm.ts          #     ctx.llm → HostPorts.generateText
│   │   │   └── logger.ts       #     ctx 日志 → HostPorts.log
│   │   ├── git-exec.ts         #   execFile 封装：队列锁/超时/GIT_TERMINAL_PROMPT=0
│   │   ├── git-service.ts      #   实现 core 的 GitService 接口（编排 git-exec/parse）
│   │   └── watcher.ts          #   .git/index|HEAD mtime 监听 → 事件
│   └── client/                 # 浏览器半（React）
│       ├── index.tsx           #   入口：只负责装配，不直接碰 slots
│       ├── adapter/            #   ★ DSH 适配器（唯一允许碰 slots/locale/store 的目录）
│       │   ├── sidebar-tab.ts  #     sidebar tab 注册
│       │   ├── remote-client.ts#     remote.workspaceGit 客户端封装
│       │   ├── locale.ts       #     ctx.locale → t() 函数
│       │   └── stores.ts       #     workspaces/sessions store → 订阅接口
│       └── ui/                 #   ★ 纯 React 组件，只依赖 core/types + client/ports
│           ├── StatusPanel.tsx
│           ├── DiffView.tsx
│           ├── CommitBox.tsx
│           ├── BranchPicker.tsx
│           └── HistoryGraph.tsx
└── test/                       # node --test / vitest（core 层 100% 可脱离 DSH 测试）
```

### 5.2 兼容层设计（DSH SDK 防腐层）

**动机**：DSH 处于 rc 阶段，client-plugin 的 slots / Remote / locale 等 API 在版本间可能变动。插件本体（git 业务逻辑 + UI 组件）不能直接依赖这些不稳定 API，否则每次 DSH 升级都要全仓改代码。

**规则（依赖方向钉死，用 eslint `no-restricted-imports` 强制）**：

1. **`src/core/` 禁止 import 任何 DSH/cordis 包**——它是纯 TypeScript，能在普通 Node 测试进程里直接跑
2. **`src/host/adapter/` 与 `src/client/adapter/` 是唯一允许 import DSH API 的地方**——每个 DSH 能力对应一个小适配器文件，把 DSH 的类型翻译成 core/ports 里我们自己定义的中性类型
3. **`src/host`（业务）与 `src/client/ui/` 只允许 import core 和 adapter 的接口**，禁止直接引用 `ctx.*`、`@deepseek-ai/*`、`window.__DSH_*`

**效果**：DSH SDK 升级时，改动面被收口在 adapter 目录（预计每侧 3~5 个小文件）。核心业务逻辑、解析器、UI 组件零改动。适配器同时是**文档**——想知道我们用了 DSH 的哪些能力，看 adapter 目录即可。

**Ports 接口草案**：

```ts
// core/ports.ts — Host 侧
interface HostPorts {
  resolveRepo(workspaceId: string, repo?: string): Promise<string>; // → 真实路径
  generateText(prompt: string): Promise<string>;                    // → LLM
  log(level: 'info'|'warn'|'error', msg: string): void;
}

// core/ports.ts — Client 侧
interface ClientPorts {
  git: GitRemoteClient;              // 对应 5.4 的 service 方法
  t(key: string, vars?: object): string;
  subscribeWorkspace(cb: (workspaceId: string) => void): () => void;
  openFile(path: string): void;      // 调 DSH 编辑器打开文件（冲突处理用）
}
```

**升级时的移植工作流**：DSH 升级 → 构建报错集中在 adapter → 逐文件对照上游变更修复 → 跑 core + 集成测试验证。

### 5.3 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 分层 | core（零依赖）+ adapter（DSH 适配）+ 业务/UI | DSH rc 阶段 API 不稳定，防腐层收口升级成本（见 5.2） |
| 前后端通道 | TypertRemoteService（`workspaceGit`），经 adapter 封装 | 官方机制，session 级工作区解析；若 Remote 机制变动，备选方案是 webServer 路由（EasyTZ 模式），只改 adapter |
| UI 挂载 | Sidebar tab（`git` page type），经 adapter 封装 | 非模态，与 Files 并列 |
| git 执行 | `execFile` + 参数数组 | 禁 shell 插值；同仓库串行队列防 index.lock |
| diff 引擎 | 移植 VS Code `DefaultLinesDiffComputer` 入 core | MIT，CnsMaple 已验证路径；纯函数天然属于 core 层 |
| 状态分发 | host watcher 事件 → client `useSyncExternalStore` | 替代轮询，agent 改动即时可见 |
| AI 提交信息 | host 端经 `HostPorts.generateText` 调 LLM | UI/业务不感知 ctx.llm 的存在 |

### 5.4 Remote Service API 草案

```ts
service workspaceGit {
  status(): { branch, detached, unborn, hasUpstream, ahead, behind,
              staged[], unstaged[], untracked[], conflicted[] }
  diff(path, area: 'worktree'|'index', contextLines?): { hunks, truncated, binary }
  log(offset, limit): { commits[], total }
  showCommit(hash): { meta, files[] }
  branches(): { locals[], current }
  stage(paths[]) / unstage(paths[]) / discard(paths[])
  commit(message)               // 只提交暂存区
  commitAll(message)            // 显式 add -u + commit，UI 文案对应
  checkout(branch) / createBranch(name, base?) / deleteBranch(name, force?)
  pull() / push() / sync()
  undoCommit(): { mode: 'reset'|'revert' }
  generateCommitMessage(): { message }   // AI
  watch(): 事件流 statusChanged          // 驱动自动刷新
}
```

> 该 API 定义在 core/types 层（中性契约），host adapter 负责把它注册成 TypertRemoteService，client adapter 负责消费。若未来 Remote 机制被 DSH 废弃，同一契约可平移到 HTTP 路由，core 与 UI 不动。

### 5.5 安全需求（继承 EasyTZ 的合理设计）

- 浏览器半**只能传 workspaceId + 相对路径/分支名/hash**，绝不传绝对路径；host 端经 workspaceRegistry 解析
- 所有 git 参数校验形状：hash 只放行 `^[0-9a-f]{4,40}$`；分支名禁 `..`、`:`、控制字符、以 `-` 开头；路径禁绝对路径与 `..` 穿越
- `GIT_TERMINAL_PROMPT=0`，凭据缺失快速失败不挂死
- 破坏性操作（discard、deleteBranch、undoCommit）在 host 层记审计日志
- 每条路由输出大小上限（防巨型 diff 打爆内存）

---

## 6. 非功能需求

| 类别 | 要求 |
|---|---|
| 性能 | status 刷新 < 500ms（千文件仓库）；diff 渲染千行不卡顿（虚拟滚动 P1） |
| 兼容 | dsh >= 0.1.1-rc.2；Windows/macOS/Linux 同一代码路径；git >= 2.20 |
| 可维护性 | DSH SDK 升级的改动面 ≤ adapter 目录（约 8 个小文件）；core 与 UI 零改动 |
| 国际化 | zh/en 双语字典，走 locale 适配器 |
| 可测试 | core 层纯函数零依赖，node --test 覆盖；git 操作用临时真仓库做集成测试；adapter 以手工验证为主 |
| 安装 | `dsh plugin --profile web add <pkg>` 一条命令，自带 dsh.bundle，无需手写 patch |

---

## 7. 里程碑

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| M0（地基） | core 层骨架（types/ports/git-parse）+ host/client adapter 最小实现 + eslint 依赖方向规则 | 解析器测试全绿；adapter 目录是唯一碰 DSH API 的地方 |
| M1（骨架） | host service + status/log/branches 只读 + sidebar tab 空壳渲染变更列表 | 面板能看到当前仓库变更分组与分支 |
| M2（提交闭环） | stage/unstage/commit/push/pull + 提交框 + 历史 | 不碰终端完成 改→暂存→提交→推送 全流程 |
| M3（diff） | diff 视图 + 逐词高亮 + 布局切换 | 点文件可见 VS Code 级 diff |
| M4（分支+同步完善） | 新建/删除分支、sync、冲突标记、AI 提交信息 | 分支管理与同步全在面板内闭环 |
| M5（P1/P2） | discard、stash、提交图、撤销、多仓库 | 发布 v1.0 |

---

## 8. 风险与开放问题

1. **DSH client-plugin API 稳定性**：sidebar tab 注册方式（slots/Remote）在 rc 版本间可能变动 → 已由 5.2 兼容层收口（变动只影响 adapter）；开工前仍需通读 DSH 本体 client-plugin 文档与 CnsMaple 实现作参照
2. **watcher 可靠性**：`.git/index` mtime 监听在部分同步盘/网络盘上不可靠 → 保留轮询兜底
3. **AI 提交信息成本**：每次生成消耗 token → 默认按钮触发不自动生成，diff 超限时截断并提示
4. **大仓库性能**：monorepo 的 `git status` 可能秒级 → 超时时返回部分结果 + 提示，不阻塞 UI
5. **兼容层的代价**：多一层间接，简单功能（如 locale 翻译）也要过一道 ports → 接受，用 eslint 规则防"图省事绕过去"
