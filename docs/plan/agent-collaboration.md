# 讨论记录 · 多 agent 协作与插件定位

- **日期**：2026-09-13
- **来源**：与产品方的连续讨论。起点是「TODO 里很多操作其实不必由人做」，随后扩展到
  提交出处（provenance）、多 agent 同目录协作，以及这个插件到底该是什么。
- **对应 TODO**：无（讨论未排期；结论若要落地，再拆成 TODO 条目）
- **状态**：**讨论记录**，未排期，**无代码交付**。逐条标注【已定】/【提议】/【未决】，
  不要把「提议」当成结论读。

> 这份文件是讨论的备忘录，不是计划：`docs/plan.md` 记「已经是什么、为什么」，
> `docs/TODO.md` 记「还差什么」。等其中的方向被产品方排期，再按本仓惯例拆出
> `docs/plan/<slug>.md`。

---

## 1. 缘起

1. 先给 `docs/TODO.md` 加了 A-16（分支之间的合并与变基）。
2. 随即意识到一个更大的问题：**面板上的很多操作，本来就不该由人来点**。
   agent（以及它的 subagent）才是这个仓库里真正的写者——D25 那次返工
   （工作区里发生的事不动 `.git`）早就证明了这一点，而被删掉的 `requirements.md`
   里那句「不碰终端完成 改→暂存→提交→推送」的前提是**人是操作者**，现在看是错的。
3. 顺着这条线，讨论走到三处：**操作该由谁发起**、**提交该记在谁名下**、
   **多个 agent 同时改一个目录时怎么协作**。

---

## 2. 【已定】判断

### 2.1 人的角色是 review 与状态监控

分界线不是「要不要人」，而是**判断 vs 执行**：

- **判断**留给人：要不要做、合哪一边、提交信息怎么写、这个改动对不对。
- **执行**交给 agent：什么时候跑哪条 git 命令。
- review 与状态监控是判断的输入面，因此它们不是「剩下的事」，而是插件存在的理由。

### 2.2 agent 今天已经能做这一切

agent 有 shell，可以绕过面板直接跑 git。所以「不给它通道」不等于「它不做」，
只是那条路没有校验、没有审计、没有 deadline（F-1 正是这条路上的坑）。这句是后面
「要不要开受控通道」的核心论据。

### 2.3 worktree 不在根源上解决冲突

> 产品方指出，我最初的「worktree 在根源上避免冲突」是错的，已收回。

- worktree 只消除**写争用**（两个写者同时改同一个文件），不消除**语义分歧**；
  它做的是**把冲突推迟到合并那一刻**，而推迟越久越贵。
- **协议/接口变更是最坏的一类**：它被藏在某个 worktree 里、另一个 worktree 完全不知道
  调用约定变了；合并时不是一处文本冲突，而是一批调用点同时过期（编译/类型/测试全红），
  且三方合并会「干净地」合过去，留下一个能合但不对的结果。这就是长寿命分支这个经典
  反模式，持续集成那一整套实践（小批量、频繁回合）正是为它存在的。

### 2.4 默认形态：共享工作区

> 产品方定：**在频繁多任务场景下，共享工作区的工作效率远超 worktree 方案。**

- 共享工作区让面板永远只显示**一份真相**；隔离会把 review 面打散成 N 个工作树，
  面板要聚合、要分别对比、要决定合哪个——那正是 A-13（展示 worktree）至今只是
  「登记待办」而不是核心的原因。
- 共享工作区把冲突**立即暴露**（写被挡 / 立刻可见），代价是必须接受协作开销，
  且守卫是合作式的（见 §3.1）。

### 2.5 `dsh-file-claim` 不够成熟，倾向自建

> 产品方判断：想法好，代码质量不高，倾向自己做一个面向扩展的。**【待复核】**
> 我尚未逐行读它的源码（下面的 §6 来自子代理的报告）。复核完再确认这条。

---

## 3. 【提议】操作交出去之后：通道、身份、安全落点

### 3.1 「ban 掉 agent 直接跑 git」的现实

- **能拦**：harness 的工具策略可以拒 `git`（或只拒改状态的子命令，保留只读的
  `status`/`diff`/`log`）；插件侧还能用 `tools/pre-execute`（`dsh-file-claim` 就是这么做的）。
- **拦不干净**：本地强制在同一 uid 下都可绕（绝对路径、脚本、IDE、`--no-verify`、
  `core.hooksPath`）。**这个类别全是合作式的**，`dsh-file-claim` 自己文档里写了
  Enforcement Boundary: advisory / fail-open。
- 因此正确定位是**策略 + 校验，不是安全边界**：允许裸 git 发生，但把没有有效签名的提交
  标成「未验证」；真要硬，只有远端（签名 + 分支保护）。

### 3.2 身份必须是 ambient，不能是参数

工具从 harness 的调用上下文取身份（会话 / agent / subagent），**不暴露「我是谁」的参数**，
否则任何人都能冒充另一个 subagent。`dsh-file-claim` 这一点做对了（`exec.agent.id`）。

### 3.3 安全设计的落点

§4.3 的「点击武装 → 3s 内再点」对 agent 无意义（它防的是人手滑）。不可逆操作
「谁拍板」需要一个替代，最自然的位置是 **harness 自己的权限层**（yolo / manual / auto，
工具调用本来就能被批准）。**未决**：插件注册的 tool 是否进同一层、能否标成「危险需确认」。

---

## 4. 【部分已定】提交出处与验真

目标是让「agent / subagent 写的提交」可识别，而不是全部记在本人名下。

### 4.1 四个强度层次

| 层 | 机制 | 强度 | 代价 |
|---|---|---|---|
| 声明 | trailer：`Assisted-by: <tool> (<model>)`、`Agent:`、`Agent-Session:` | 可见、可 grep、托管平台直接显示；**可伪造** | 几乎为零 |
| 身份分工 | author = 本人，committer = agent 身份（git 原生区分） | 语义清楚、不改历史 | 要定 blame 看哪个 |
| 附注 | `refs/notes/*` 挂机器可读记录（session / subagent id / model / tool-call id） | 不动提交对象、信息量最大 | 要显式 push；不可验 |
| 签名 | 每个身份一把 SSH 签名密钥（`gpg.format=ssh`），`git verify-commit` 验 | **唯一算凭证的** | 密钥生命周期、公钥分发、签名可能卡住（A-7） |

### 4.2 【已定】选择

- **目标是验真**，不是「看得见」。
- **粒度到 subagent**。
- **author 保持本人不变**——把模型写成 author 会破坏 blame / CODEOWNERS / 协作预期，
  这正是 `Co-authored-by` 被批评的点（[claude-code#36105](https://github.com/anthropics/claude-code/issues/36105)、
  [ruflo#1670](https://github.com/ruvnet/ruflo/issues/1670)）。
- 用 **SSH 签名**（git ≥ 2.34），避开 GPG 与 A-7。
- 身份 ambient（同 §3.2）。

### 4.3 【未决】谁盖章、密钥怎么发

- **盖章位置**：harness 给 agent 的 shell 注入 `GIT_AUTHOR_*` / 签名环境（或装
  `prepare-commit-msg` hook / PATH 上包一层 git）；或让 agent 走我们注册的 tool 提交
  ——**后者天然知道 session / subagent / model，且正是 §3 那条通道的额外收益**。
- **密钥生命周期**：subagent 是瞬时的，per-subagent 密钥很难事后验证。可行折中是
  **会话级一把密钥 + trailer 里带 subagent id**；但那样「subagent 级」的断言就依赖
  harness 的诚实。真要独立可验，只能 per-subagent 密钥 + 发布公钥映射。
- **诚实边界**：签名只证明「持有该密钥的东西签的」；**model→密钥是 DSH 的政策性断言**，
  不是模型自证。UI 上 `declared` 与 `verified` 必须是两种标记。

### 4.4 可参考的先例

- `Assisted-by:` 的采用与"`Co-authored-by` 是字面作者断言"的争议
  （[cue-lang](https://github.com/cue-lang/cue/issues/4452)、[provenance trailer](https://www.baristalabs.io/blog/ai-assisted-commits-need-provenance-trailer)）。
- 把「agent 名 → 签名密钥指纹」写进 `AUTHORS.md`、对不上即算冒名
  （[frankenpandas AGENTS.md](https://github.com/Dicklesworthstone/frankenpandas/blob/main/AGENTS.md)）。
- agent 密钥再链到人类 owner 的 OIDC 令牌（[Alien Agent ID](https://docs.alien.org/agent-id-guide/introduction)）。

---

## 5. 【已定方向 + 提议】多 agent 同目录协作

### 5.1 决定胜负的三个变量

| 变量 | 便宜的一侧 | 昂贵的一侧 |
|---|---|---|
| 寿命 | 几分钟的任务 | 长时间跑的特性 |
| 影响半径 | 局部、独立模块 | 跨接口、跨协议 |
| 集成频率 | 频繁回合 | 攒到最后一次合 |

### 5.2 按影响半径分派（不是按工具信仰）

- **局部且独立**（新文件、独立模块、测试）→ 隔离可选，集成点小。
- **跨接口/协议** → **绝不允许静默发生在隔离里**：广播、单写者、尽早落到共享主干，
  或先把接口冻结再并行。
- **共享热点文件**（lockfile、`package.json`、生成物）→ 认领 / 串行。

### 5.3 协调层的定位：不是锁，是「早看见 + 分级」

它最有价值的输出不是「这个文件被占了」，而是「**这次改动的影响半径跨出了 agent 边界，
而且可能是契约变更**」。契约变更升级处理；局部改动随便做。这服务的是一次**决策**，
不是一次排队——正是产品方说的「我接下来要改什么逻辑、影响范围」。

### 5.4 行锁：没有成熟实现，而且锚点错了

- **我没找到像样的开源「行锁」**；生态走的是相反的路：要么文件级锁，要么不用锁。
  多 agent 产品目前也只做到文件级（Claude Cowork 一类）。
- 行号是**不稳定锚点**：上面插删一行，后面所有区间失效。真正的并发编辑器锚的是
  **字符 ID**（CRDT：[Yjs](https://github.com/yjs/yjs)、Automerge、
  [Diamond Types / Eg-walker](https://arxiv.org/html/2409.14252v1)），不是行号。
- **影响半径本来就不是按行算的**：两个 agent 改同一文件的不相交行，仍可能语义打架。
  行锁给的是机械安全 + **语义上的虚假安心**。
- 有论文正好点出同类问题：**文件级粒度会让「改同一文件的不同函数」被误判成冲突**
  （[arXiv 2605.20563](https://arxiv.org/html/2605.20563v1)）。

### 5.5 【提议】三层方案

| 层 | 做法 | 解决什么 |
|---|---|---|
| 机械 | pending-apply 用**结构化合并**替换 `git merge-file` | 同一文件的不相交改动自动合掉——这就是「不在影响半径内就并行写」的机械那一半 |
| 语义 | intent / 影响半径声明 + 分级（§5.2） | 协议/接口变更；**结构化合并救不了这个** |
| 兜底 | 文件级 claim，只留给热点文件 | 粗粒度串行 |

认领的粒度应该是 **symbol**（`file#symbol`）而不是行，也不是文件——A-14 的代码智能
（`ts-service` / `ctags`）正好提供 symbol 模型，两者可以共用一套解析。

### 5.6 结构化合并的现成件

- **[Mergiraf](https://codeberg.org/mergiraf/mergiraf)**：Rust + tree-sitter 的
  **git merge driver**，33+ 语言，能解「同一行上的不相交改动」这类 diff3 解不了的冲突
  （[LWN](https://lwn.net/Articles/1042355/)、[综述](https://daily.dev/posts/mergiraf-syntax-aware-merging-for-git-akvmx1pyu)），
  在 Linux 内核历史上解掉了 7415 个冲突中的 428 个。**它不需要写者配合**。
- **difftastic**：结构化 diff（只 diff，不合并）。
- 学术线：3DM → FSTMerge/JFSTMerge → GumTree → IntelliMerge → Spork
  （[survey](https://gitwand.app/blog/state-of-merge-conflict-resolution-2026.html)）。
- CRDT（agent 作为 Yjs peer，[Electric](https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs)）
  能零冲突并发编辑，但每字符元数据 + 要同步服务 + 产物不再是普通文件，与
  「agent 用工具改文件 + git」不匹配。

**诚实边界**：结构化合并降低的是**机械**冲突，消不掉**语义/协议**冲突。

### 5.7 agent 之间的通信：现状【已查】

「子代理」和「同伴」是两种东西：

- **subagent（子代理）**：汇报式——干完把摘要交回父代理，彼此不通信。Claude Code 的
  subagent 至今如此（[tembo](https://www.tembo.io/blog/claude-code-subagents)）。
- **teammate / peer（同伴）**：有对等消息。Claude Code 的 **Agent Teams** 有 **mailbox**，
  lead↔teammate、**teammate↔teammate** 都能直发
  （[brandonwie](https://brandonwie.dev/posts/claude-code-agent-teams)、
  [alexop](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/)）。

框架层早就有：AutoGen 的核心抽象就是会收发消息的 `ConversableAgent` + GroupChat manager；
LangGraph 走图/共享状态（supervisor、swarm 两种模式）；CrewAI 有 delegation-to-coworker；
OpenAI Agents SDK 是 handoffs（严格说是控制权转移）。跨进程还有 A2A。一份 2026 的评测
就是拿 LangGraph / CrewAI / AutoGen / OpenAI Agents SDK 四种搭 MAS 的
（[arXiv 2606.23664](https://arxiv.org/pdf/2606.23664)）。但它们**拓扑归框架所有**，
接入等于把状态搬出 DSH。

**DSH 有消息注入，但要分清两层**（2026-09-13 实查 `~/.dsh/profiles/node_modules/@deepseek-ai/`）：

- **子代理层（树内，邻接受限）**：`ctx.subagents`（`@deepseek-ai/dsh-subagent`）——
  - `sendMessage(sender: Agent, targetId: SessionId, content, options)`：把消息送到**发送者的
    直接父或直接 continuable 子**（邻接不符会被拒）。运行中的目标在**最近的步边界**收下，
    空闲的目标会起一轮，缺席的直接子会**从持久化冷恢复**。
  - `interrupt(targetId, authority)`（human parent 地址或精确活祖先）；
    `listChildren(parentSessionId)` / `listDescendants(rootSessionId)`；
    浏览器面 `prompt(request, signal)`（`delivery: queue | steer`）。
  - 模型面工具是 `send_message` / `interrupt_agent` / `list_agents`
    （`@deepseek-ai/dsh-tool-subagent-control`，薄适配 `ctx.subagents`）。
- **会话层（任意 sessionId）**：`ctx.sessionController.prompt(request, signal)`
  （`@deepseek-ai/dsh-api-session-controller`，声明在 Context 上的宿主服务）——请求是
  `{ requestId, sessionId, mode: 'queue' | 'steer', content, clientTimeZone? }`，返回
  `{ accepted: true }`；**按 sessionId 寻址、不限委派树**，并且会「显式 resume」目标会话。
  这是前端发消息走的同一条路。**注意它的出处是写死的**：实现里
  `source = { kind: 'user', rpcId: requestId, … }`，所以走这条路的注入在日志里**就是一条
  用户消息**，只能靠 `rpcId` 分辨。
- **更低一层（出处可留）**：`ctx.agents`（`AgentRegistry`）拿到活 Agent 后，运行面有四个
  方法，都收 `UserMessage`、**source 由产出方给**：
  - `inject(message)`——注入模型可见的上下文、**不唤醒**驱动，下一轮 pre-step 取（最轻）；
  - `followup(message)`——排一个独立轮次并唤醒；
  - `steer(message)`——插到最近的步边界（打断当前思路）；
  - `send(message, 'next-turn' | 'next-step', wakeup)`——底层那个。
  `MessageSourceMap` 里 **`kind: 'plugin'` 是一等公民**（带 `plugin` 名），整张表还是
  **merge-extensible**（注释原话：「plugins add their own `kind`s」）——所以「这条是协调层
  发的」是**可表达**的；真正的出处在这里，不在会话 RPC 里。
- **观察面**：Session 树 + session 事件；`Agent.inbox` 与 `agent/inbox/spliced`；
  `sessionController.list/search/inspect`、`subagents.listChildren/listDescendants`。
- **权限**：`ctx.sessionController` 与 `ctx.agents` 都是**全局 Context 服务**；`prompt()` 只做
  内容 / 时区 / 模型路由 / `requestId` 幂等校验，**本层没有授权检查**——授权在 Remote
  （浏览器）那一层，host 插件直接调用是绕过去的。所以「谁能叫醒谁」是**我们自己的策略**，
  不是平台给的约束。

所以先前那句「DSH 没有 peer 消息」不准确：**没有任意对等消息**，但有三条现成通道——
树内邻接的 `sendMessage`、会话级 `prompt`、Agent 级的 `inject` / `followup` / `steer`。
push 的强度天然可以分级：**`inject`（塞上下文、不打扰）< `followup`（排一轮）<
`steer`（插到下一个步边界）< `interrupt` / `cancel`（打断）**。

【提议】不引入外部框架的传输层（DSH 是单进程，**host 服务 + 事件**是最短路径，且与工作区、
身份、审计同处）。**黑板不必只是 pull**，push 用现成的强度阶梯：默认 `inject`（不打断，只在
下一次模型调用前递上下文），只有契约变更 / 冲突预警才升到 `followup` / `steer`；出处用
`kind: 'plugin'` 的 source 标明，**不要走会把消息伪装成用户的会话 RPC**。**协议必须先定**
——消息要短、要结构化（「契约变了，影响这些路径」），不是自由聊天。**先把 Session 树与
inbox 消费起来**（谁在等、child 做了什么，是 review 与 provenance 的原料）。风险：看不见的
协调让 review 更难、消息风暴、死锁、各 agent 局部最优。

### 5.8 【提议】独立会话之间的共享状态（前后端两个 agent）

> 产品方提出：实际开发里前后端常常各开一个 agent，两个会话的工作彼此隔离；
> 插件其实可以充当「我们 OS 里的 shared state」。

- **问题的本质**：DSH 的 Session 树只在**同一棵委派树**内有效。两个独立会话（前端一个、
  后端一个）之间**没有任何共享上下文**，只有**共享工作区**——而工作区是**滞后指标**：
  它只显示已经写下来的东西，不显示意图、契约与计划。
- **缺的不是文件，是元数据**：仓库本身已经是共享内存；缺的是「接口契约 / 我要改什么 /
  影响谁 / 谁 review 过了」这一层。
- **契约优先**：前后端并行时最高价值的共享物是**接口契约**（API schema、共享类型、端点
  清单）。先发布契约，两边就能并行；契约变动成为事件，去通知另一边适配——这正是 §5.2
  「跨接口改动」在真实场景里的样子。前端还能先对着契约做 mock。
- **作用域必须是工作区，不是会话**：host 侧现有状态（`selectRepo` 的 selections、界面
  偏好）都按会话/容器；共享状态必须按 **workspace realpath** 键控，两个会话才看到同一份。
- **分两层，别混**：
  - **持久层**：契约、ADR、决策——**必须进 git**（可 review、可回溯、不漂移）。
  - **易逝层**：意图、影响半径、进行中状态、review 状态——黑板，带 TTL。
  黑板若把持久契约也兜住，就会长出**第二个真相源**，迟早和代码漂移。
- **人的位置**：面板显示黑板 = 天然的 review 面：能看见「后端 3 分钟前改了契约、
  前端还没跟上」这种状态，这正是监控的价值。
- **风险**：第二真相源、过期条目被信任、噪声。缓解：能派生的就派生（从 OpenAPI/代码生成，
  而不是手写）、TTL、绑到提交或校验上、面板显示漂移。
- **未决**：黑板归**协调插件**还是 git 面板的 host（倾向协调插件，面板只做窗口）；
  契约用什么格式（OpenAPI / JSON Schema / 共享类型）；agent 是否直接读写。

### 5.9 【已定方向】统一写入口：把文件锁变成写路径的内部性质

> 产品方：**把所有文件变更方式全 ban 掉**，把插件的 tool 作为**统一入口**；
> 自己的文件变更方式解决文件锁的问题。

- **这条顺带回答了「为什么要从 session 事件拿归属」——不需要**：**写路径自己带 actor**。
  `ctx.fs`（`@deepseek-ai/dsh-fs`）的
  `fs/write-intent(target, actor, next)` 与 `fs/edit-intent(target, actor, next)`
  是 **单槽 waterfall**，`actor` 就是「这次工具执行的上下文」——谁写的、写哪里，
  在写的那一刻就有答案，不必事后推断。
- **两个执法点，都不用解析 shell**：
  - **fs 工具写**（`write` / `edit` / `str_replace` / 任何走 `ctx.fs` 的路径）：
    `fs/*` 这个**单槽**事件就是唯一决策点——注释原话「**第一个返回 intent 的 listener
    拥有决定权**，而不是与同伴组合」。今天占着它的是 `dsh-fs-observation-policy`
    （observed-state + read-before-edit + version-guarded write，也就是我们之前抱怨的
    「文件变过就不让编辑」）。要当统一入口，就是**接管这个槽**。
  - **进程写**（bash/pwsh 里的 `sed -i`、脚本、`git apply`…）：靠 `ctx.sandboxPolicy`
    （`@deepseek-ai/dsh-sandbox-policy`）——默认就是 **`read-only`**（fail-safe，注释原话）；
    file-sandbox 与 bash-sandbox 都按 per-call 模式执行，且 `SandboxPolicyRequest.mode`
    允许**显式批准的逐次放宽**。
- **更彻底的一层：自己当 provider**。DSH 把能力拆成「Service Definition（缝）+ provider
  （实现）」：`dsh-fs` 定义抽象类 `FileSystem extends Service` 并声明 `Context.fs`；
  `dsh-fs-local` 给 `LocalFileSystem extends FileSystem`；`dsh-fs-sandbox` 给
  `SandboxedFileSystem extends LocalFileSystem`。它的源码注释写明了机制——
  **「registers as `ctx.fs`（loading it INSTEAD OF `dsh-fs-local`）」：同一时刻只有一个
  provider，靠 composition 选择，不是并存注册**。所以「提供自己的 provider」= 注册一个
  `FileSystem` 子类（`extends SandboxedFileSystem` 以保留沙箱），覆写 `writeText` / `editText`
  加锁、归属、合并、审计，再 `super.writeText(...)` 落盘。与 `fs/*` 事件槽的分工：
  **事件槽只裁决，provider 拥有这次写**——「统一入口」要靠 provider 这一层。顺带：
  `writeText(target, content, expected?, signal)` 本来就带 **expected version**（CAS），
  `SandboxedFileSystem` 正是「先策略检查、再 `super.writeText`」。
- **接线（实查 `dsh-tool-fs`，2026-09-13）**：工具自己调
  `ctx.waterfall("fs/write-intent" | "fs/edit-intent", target, exec, () => void 0)`，把返回的
  `intent` 当作 `expected` 传给 `ctx.fs.writeText` / `editText`，写完再
  `ctx.emit("fs/observed", …, {version})`。所以**「按什么版本守」在事件槽、「写」在 provider**，
  两处可以分开动：要取消 read-before-edit，把 `dsh-fs-observation-policy` **disable 掉**即可
  （waterfall 回落到 `() => void 0`，intent 变成「无守卫」）；要拥有写，替换 `fs-sandbox`
  那一行 provider。另外 `sandboxPolicy` 是**工具每次调用算好传进来**的
  （`sandbox.resolvePolicy("write" | "edit", args, exec)`），provider 要原样转给 `super`。
- **锁因此变成内部性质**：所有写都经过同一个进程内的决策点，互斥就是一条按 `FsTarget`
  排队的队列——不需要 sidecar、心跳、stale 接管、邻接校验。`dsh-file-claim` 那一整套
  （§6）都是为「拦不全」的前提下尽量合作而生的；这里是「拦得住」。
- **一条只有 git 能给出来的规则**：把 bash 一刀切成 `read-only` 会打断正常开发
  （格式化、codegen、build、`npm install`）。用 git 知识切细：**忽略 / 未跟踪的路径允许
  bash 写（产物），被跟踪的文件只许走我们的 tool**。这正是本插件独有的信息。
- **诚实的缺口**：
  - 单槽意味着 `dsh-fs-observation-policy` 只能被**替换或 disable**，不能并存；它现在负责的
    read-before-edit 语义由我们接手——不过这是机会：把「拒绝」换成「按 base 校验 + 三方重放」
    （§5.12）。
  - host 进程自己、自带 fs 的 MCP server、外部编辑器、用户的终端都不在这条路里；
    绕过 `ctx.fs`、直接 `node:fs` 的插件也拦不到。
  - 一旦我们是唯一写入口，这个 tool 必须至少不比现在的 `view / create / replace / insert`
    难用，否则 agent 的能力是净损失。

### 5.10 【提议】兜底：检测「没走过我们」的写入 → 回退 / 重放 + 告知 agent

> 产品方：检测文件变更，若不是我们的 tool 写的就**回退**它，并给 agent 返回一条
> 「请用本插件的 tool 做变更」的消息。

- **定位：这是兜底，不是主执法。** 主执法是 §5.9 的两个点（`fs/*` 单槽 + sandbox）；
  这里覆盖的是漏过来的——bash / 脚本、外部编辑器、自带 fs 的 MCP、直接 `node:fs` 的插件。
- **能做**：工作区探测已经有了（D25）；「是不是我们写的」由 §5.9 的 `actor`，加上我们自己的
  「在途写入登记」（tool 写之前记 path + 期望内容/版本）回答。
- **四条必须先解掉的失败模式**：
  1. **不能一律回退**：bash 合法地写产物（build/dist、快照、格式化、`npm install`）。
     回退范围只能是**被 git 跟踪的文件**（还是 §5.9 那条 git 切法）；忽略 / 未跟踪的产物放行。
  2. **回退到哪里**：不是 HEAD——那会连带丢掉该文件上**此前合法**的未提交改动。应回退到
     **我们上次已知的内容**（上次 owned 写之后的快照）。
  3. **「删掉 agent 的工作」比「拒绝」更糟**：无声回退是破坏性动作，与 §4.3 的确认原则相冲。
     更好的形状是**捕获内容 → 回退 → 用我们的 tool 重放**，再告知 agent「你的改动已通过
     tool 重新落地」：不丢工作、归属修好，重放还顺带走结构化合并（§5.6）。
  4. **时序与竞态**：检测是异步的（fs.watch + burst 合并，D25；同步盘降级为轮询），
     「未走过写」与「我们回退」之间别的读者可能已经看到脏状态；一次脚本里的多文件写入会被
     逐条处理，可能拆散一次本来合法的批量操作。
- **升级阶梯**（避免「写 → 被回退 → 再写」烧 token）：第一次 → 重放 + 明确告知；重复 →
  对该会话把 bash 收成 `read-only`（sandbox 的 per-call 模式）；再重复 → 停这一轮。
- **可观测**：每一次「检测到没走过我们的写」都是一个 review 信号——面板应当显示
  「bash 写了 `src/x.ts`，已回退 / 重放」，而不是静默处理。

### 5.11 【已调研】写入方式：确定性 apply 阶梯，托管模型只作可选后端

> 产品方要求调研 `opencode-morph-fast-apply` 这一类的写入方式。

- **这一类分两半**：
  - **托管 apply 模型**（Morph `morph-v3-fast` / `-large`、Relace Apply 3）：OpenAI 兼容 /
    REST，送 `(instruction, 完整原文件, 带懒标记的片段)` → 回**整个合并后的文件**。
    **只有 API、没有权重**；而且**它们不解决 stale**——是往你给的那份 `<code>` 里合。
    「不强制重读」是调用方做的事（opencode 那个插件先读当前文件，再让模型做语义归并）。
  - **离线确定性 applier + 结构化合并**：`git merge-file`（current × base × other）、
    `git apply -3`、`patch --fuzz`、Aider 的分层模糊匹配、Codex V4A 的 `@@` 上下文锚点、
    Mergiraf（tree-sitter 三方合并，§5.6）。
- **失败模式是把托管模型当主路径的理由**：`opencode-morph-fast-apply`（MIT、172★、薄封装）
  的「安全护栏」本身就是模型失败模式的目录——懒标记泄漏、整文件灾难性截断、import 丢失、
  改错位置；Relace 自己的分类还有幻觉与「smoothing」（它会顺手改你没要求的地方）。模型是
  **重生成整个文件**，所以并发改动可能被静默覆盖。厂商的 98% 准确率出自自家对比页，
  **没有独立的横向评测**。
- **没有开权重的等价物**：最接近的 Sweep next-edit 是「预测下一处编辑」，另一个任务。
  自己训一个可行（Relace 公开复盘：3–8B LoRA + ~145k 精选样本就够），但要自己承担数据、
  评测与 GPU 服务，不现实。
- **【提议】默认走确定性阶梯，托管模型只作可插拔后端**：
  1. 精确字面匹配（今天的语义，零风险快路径）；
  2. **stale 用 `git merge-file` 归并**：`base` = agent 那条编辑写就时的内容，
     `other` = base + 该编辑，`current` = 磁盘现状 → 三方合并。**并发改动被保住、冲突显式
     暴露**，而不是静默覆盖。**而且 base 是白拿的**——见 §5.12；
  3. 有 unified diff 且 base 是仓库里的 blob 时用 `git apply -3`；
     **不要用 `patch --fuzz`**（它会猜，见 §5.12）；
  4. 仍有冲突再上 Mergiraf 做语法感知合并；
  5. 落盘前校验 + opencode 那套护栏（标记泄漏、截断比例、import 丢失），并回一个 diff。
- **托管后端要可插拔而非耦合**：配置面 `apply: 'merge-file' | 'fuzzy' | 'morph' | 'relace'`。
  理由：每次编辑都要把代码送出自己的机器（隐私）、网络延迟与成本、离线 / 内网部署、以及
  上面那些未经验证的厂商说法。opencode 自己也是「在 `morph_edit` 与原生 `edit` 之间路由」，
  不是只留一条路。
- **顺带的确认**：社区已有 `dsh-tool-edit`（`@hy-sde-org` + `dsh-hashline`）——本地增强的
  edit 工具，模式有 `replace`（模糊空白匹配）/ `patch` / `apply_patch` / `hashline`
  （行+哈希锚点的补丁语言），还内嵌 LSP 做诊断；**它读 `ctx.fs`、写走 `fs/edit-intent`
  waterfall**——正好确认了 §5.9 要替换的那条缝，值得当参考实现读。**没有找到任何 DSH 的
  fast-apply 插件。**

### 5.12 【已调研】不换错内容：锚点只证明身份，不证明意图

> 产品方决定：（§5.9）替换 provider，**read-before-edit 的语义我们不需要**；
> 但要先解决「怎么保证不会改错内容」，参考开源实现。

- **两类失败要两把锁**：**意图歧义**（模型选的锚点在文件里能匹配到多处）与**陈旧**
  （read 之后文件动过）。锚点（哈希 / 行号）只证明**内容身份**，不证明**意图**。
- **我们有的三样别人通常没有**：`base`（编辑写就时的内容）、`disk`、`actor`。规则：
  1. **在 base 上解析锚点**：精确匹配且**唯一**；0 或 >1 一律硬拒；
  2. `disk == base` → 直接写（绝大多数情形）；
  3. 否则 `git merge-file(disk, base, base+edit)`（**fuzz 0**）；只有干净**且**编辑区间与磁盘
     已变区间**不相交**才自动落盘，否则硬拒；
  4. 拒的时候**带修复信息**（该区域的新内容 / 新锚点），把循环从「重读整个文件」缩到一轮。
- **硬拒清单**（永不自动应用）：锚点在 base 里 0 或 >1；合并冲突或区间重叠；
  base→disk 之间锚点的出现次数变了（base 唯一、disk 变重复）；锚点只是**近似**
  （相似度 < 1.0 一律不收）；连续 no-op。
- **`patch --fuzz` 必须从阶梯里删掉**：GNU patch 自己的 BUGS 就说，重复代码（`#ifdef` 双胞）
  会「改错还报成功」。能安全用的是 `git merge-file`（退出码 = 冲突数，配
  `--diff-algorithm=histogram` 可减少「无关紧要的相同行」导致的语义误合）与 `git apply -3`
  （需要 base blob 在本地）。
- **可读的参考实现**：
  - [`pi-hashline-edit`](https://github.com/RimuruW/pi-hashline-edit)（MIT）——正是这个配方：
    在快照上重放 + `fuzzFactor: 0` 三方合并到实时文件，恢复失败才要求重读。
  - [`dsh-tool-hashline`](https://github.com/InklingYoshi584/dsh-tool-hashline)（MIT，DSH 插件）——
    行哈希 = 前后文三元组的 FNV-1a，2–4 字符；**陈旧即整次调用失败，从不重定位、从不模糊匹配**。
  - [`hy-sde/dsh-tool-edit`](https://github.com/hy-sde/dsh-tool-edit)——一个工具分派
    `auto · hashline · replace · patch · apply_patch`，替换掉 stock 的 `str_replace_editor`。
  - **Aider 要小心**：它的 difflib 模糊那一步在主分支上是**死代码**
    （`replace_closest_edit_distance` 之前有一个裸 `return`），而 `perfect_replace` 取
    **第一个**匹配、不做唯一性检查。所以「Aider 会模糊匹配」这个流行说法不准。
  - Codex V4A `apply_patch`：`@@` 上下文锚；已知一个文件里多个 `@@` 有 parser bug。
  - Mergiraf / [Weave](https://github.com/ataraxy-labs/weave)：实体级合并，冲突时**拒绝**
    而不是编造一个顺序。
- **独立证据**：一个 160 任务的对拍里 **78/160 是「改到了错误的那一处」**，而模型给的
  `line_hint` 大多本来就是对的——说明「唯一的 old_string」不足以防，必须用 base 校验目标
  （[nanobot #4634](https://github.com/HKUDS/nanobot/issues/4634)；单个 maintainer 的数据，
  方向可信、百分比当参考）。
- **结论**：哈希回答「锚点还在不在」，三方合并回答「还放不放得下」，base 上的唯一性回答
  「本来有没有歧义」——三样都要，而我们都拿得到（§5.9 的 provider 侧可以维护
  version→content 缓存）。

---

## 6. 参考实现评估：`dsh-file-claim`

面向「多个 DSH 会话同工作区」的文件认领插件（[repo](https://github.com/Nwflower/dsh-file-claim)），
host-only、零依赖、MIT。以下来自子代理读源码的报告，**我尚未逐行复核**。

### 6.1 它是什么

- `inject: ['tools']`；注册 8 个工具（`claim_files` / `release_files` / `who_claims` /
  `claim_status` / `pending_write` / `pending_apply` / `pending_show` / `pending_drop`）
  与 3 个斜杠命令；挂 `agent/created`、`agent/status`、`agent/disposed`；
  `tools/pre-execute` 做写保护；给 `systemPrompt` 注入协作协议。
- 身份是 ambient：`exec.agent.id`，工具没有 `--as`。
- 三方合并用 `git merge-file -p current base other`（**没传 `-L`**）。

### 6.2 值得抄的（协议层）

- 认领先于写；目录认领覆盖子孙；重复认领幂等。
- **靠生命周期事件释放**（`agent/disposed` 立刻释放、`agent/status` 刷心跳），而不是只靠超时。
- **pending 异步写入 + 三方合并**：不阻塞，别人释放后自动合，冲突才交人。
- 审计 JSONL；**systemPrompt 注入协议**（比强制拦截便宜，且更有效）。

### 6.3 必须反着做的

- **不要把状态写进工作区**：`<file>.dshclaim`、`<file>.dshpending/`、
  `.dsh-file-claim.audit.jsonl`、`.dsh-file-claim.lock` 在 `git status` 里就是未跟踪文件，
  会污染变更列表；心跳每次 `agent/status` 与每 10 分钟重写 sidecar，**mtime 一直抖**
  （喂给我们的探测/watcher）；一次「丢弃未跟踪」就会**删掉协作状态**。
  → 改成工作区**之外**的注册表（按 workspace realpath 键控，落在 `$DSH_HOME` 下）。
- **要有服务与事件，不要只有文件**：它没有 `ctx.set`、没有事件，别人只能 import
  纯核心或轮询文件——这正是「面向扩展」的反面。
- **身份不要靠 `pid`**：容器/远端/WSL、或一个 host 跑多会话时会误判；应基于会话/agent 身份。
- **不要往共享文件里写冲突标记**：它把带标记的结果写回工作区、条目又保留，再合一次会嵌套。
  冲突应留在 pending 区，交给面板两边对照。
- **锁的过期时间要有据可依**：10s 获取 / 60s 可抢，大目录或 `git merge-file` 超 60s 会双入。

### 6.4 成熟度与待证

- 2026-08-14 建仓，**5 star / 1 作者 / 33 个测试 / 无并发测试**。
- **待证 1：npm 上装到的版本**。`package.json` 是 0.2.0（sidecar 布局），但最后一个提交
  就是这条破坏性存储变更、**没有 0.2.0 的发布提交**；很可能实际装到的是 0.1.7 的旧
  集中式 `.dsh-file-claim/` 目录。**对着 sidecar 写集成会全错**。
- **待证 2：我们的模块图能不能解析到它**（没人声明这个 peer）。

### 6.5 若集成的代价（无论自建还是复用它都要处理）

1. 变更列表要过滤 `*.dshclaim` / `*.dshpending/` / `.dsh-file-claim.audit.jsonl` /
   `.dsh-file-claim.lock`；
2. 丢弃 / 清理未跟踪**绝不能**碰它们；
3. sidecar 的 mtime 抖动要当噪声；
4. 它的冲突标记是 `<<<<<<< current`（临时文件名），我们的冲突处理认不出来；
5. 没有跨插件 API → 想显示「谁在改哪个文件」只能轮询或读文件。

---

## 7. 【未决】清单

1. **插件边界【已定：本仓 + 同包两行】**：产品方 2026-09-13 定——工作量够得上独立插件，但它
   **依赖本仓已有的能力**（仓库 / 工作区解析、git 状态与忽略规则、面板这个 review 面），所以
   落在本仓；挂载用**同一个包、bundle patch 插两行**（面板行 + `dsh-git-panel/fs`），各自可按
   loader id 单独 disable，细节见 [plan/write-path.md](write-path.md) 的「落地形状」。
   → §9.4 的「落点」一项据此作废。
2. **操作通道**：agent 走**注册 tool**（受控、可审计、可盖章），还是干脆不建、
   让 agent 用裸 shell（那就只剩事后校验）？
3. **harness 权限层**：插件 tool 是否进同一层、能否标「危险需确认」？
4. **盖章位置**：harness 注入环境/hook，还是我们的 tool（§4.3）？
5. **密钥策略**：per-subagent 密钥，还是会话级密钥 + subagent trailer？
6. **`dsh-file-claim`**：自建，还是先复核源码后决定复用/借鉴？（产品方倾向自建）
7. **Mergiraf 验证**：要不要拿本仓一对「同文件、不同函数」的真实改法，量一下它比
   `git merge-file` 少报多少冲突？需要允许下载/安装（Rust 工具）。
8. **TODO 重排**：§2 的分类表是否照此改写 `docs/TODO.md`？（现在一个字没动）
9. **DSH 的 subagent / session 能力边界【①② 已查，结论：不是缺口；见 §5.7】**：
   ① **出处**——会话 RPC 把 source 写死成 `{kind:'user', rpcId}`；但 Agent 级的
   `inject` / `followup` / `steer` 的 source **由产出方给**，且 `MessageSourceMap` 里
   `kind:'plugin'` 是一等公民、整表 merge-extensible。**保留出处的路是走 Agent 级 API，
   不是会话 RPC**。② **权限**——`ctx.sessionController` / `ctx.agents` 都是全局 Context
   服务，`prompt()` 本层**没有授权检查**（授权在 Remote/浏览器那层）。所以不是缺能力，
   是**没有约束**：「谁能叫醒谁」要我们自己定策略。
   **③（原列的「能否从 session 事件拿到哪个 child 改了哪些文件」）作废**：问题问错了——
   归属由**写路径**直接给出（§5.9：`fs/write-intent` / `fs/edit-intent` 带的 `actor`），
   不需要事后从 session 事件推断；而这条要成立的前提是「统一写入口」，那正是 §5.9 的方向。
10. **共享状态的归属与格式**（§5.8）：黑板放**协调插件**还是本插件的 host；契约用
    OpenAPI / JSON Schema / 共享类型；agent 是否直接读写；易逝层与持久层的分界线画在哪。

---

## 8. 【提议】TODO 按判据的重排（尚未落地）

| 现有条目 | 按「判断留人 / 执行交 agent」的判定 |
|---|---|
| A-5 / A-10 / A-11 / A-12 | **核心**：方向键、布局单按钮、自动换行、行间展开，全是 review 体感 |
| A-6 / E 组性能 | **核心**：diff 虚拟滚动、千文件/monorepo 压测，review 的性能上限 |
| A-13 | **核心**：worktree 列表是状态监控（但 §2.4 定了共享工作区，它的定位要重估） |
| C-1 / C-2 | **核心**：游离 HEAD 胶囊、上游被删提前报告，状态必须准 |
| D 组「打开文件」/「am、edit-todo 在途状态」 | **核心**：review 与监控 |
| A-15 冲突的「合并」动作 | **交出去**：合哪边是判断，但「合成一个版本」是执行；面板留两侧对比（已交付）+ 交给 agent |
| A-16 分支间合并与变基 | **交出去**：整条；面板只做「它在改写/合并中」的监控与继续/中止 |
| A-1 检出远程分支 | **拆开**：rebase onto / drop 是判断（留成一次选择），执行交出去 |
| A-4 / D 组 reword、连续捡取 | **交出去**：机械、一次性、可脚本化 |
| A-8 / A-7 / F-1 | **重定位**：面板还要自动 fetch 才需要；提交卡死发生在 agent 的 shell，不在面板 |
| A-3 通知时长设置 | 与判据无关，价值最低 |
| A-14 代码导航 | 是 review，但已越出「git 面板」，属另一个插件；不过它是 §5.5 symbol 级认领的前置 |
| B-1 / 浏览器目视验收 | 后者是**核心**：review 面从没被人眼看过 |

---

## 9. 【提议】距离 MVP：缺口与关键路径（2026-09-13 复盘本文档）

### 9.1 结论

本文件是**架构讨论，不是计划**：没有 MVP 定义、没有验收、没有落点，全部标着未排期、无代码。
所以「距离 MVP」**不是把 §5 做完**，而是三件事：① 定一个足够小的 MVP；② 退掉关键路径上
3 个未知；③ 一个薄实现 + 回归。**§2 / §3 / §4 / §5.7 / §5.8 / §5.10 / §6 / §8 都不在 MVP 里。**

### 9.2 MVP 提议：统一写入口的最小版本

一个 host 插件，注册自己的 `FileSystem`（`extends SandboxedFileSystem`，保留沙箱），只做六件事：

1. 按 `FsTarget` **进程内排队**（互斥）；
2. 记**归属**：`actor` → session / agent；
3. `writeText`：沿用 `expected`（CAS），不符即拒——今天的行为，只是错误里带现状摘要；
4. `editText`：先字面匹配；**stale 时 `git merge-file`**（base = 该编辑写就时的内容，
   other = base+edit，current = 磁盘）→ 干净则落盘，冲突则返回**带两侧内容的类型化错误**；
5. **审计一行**（actor / path / 结果 / 是否归并或冲突）；
6. 配置开关 `passthrough`：打开即逐字回到父类（**kill switch**）。

**不做**：黑板 / intent、推送消息、提交签名、Mergiraf、bash 收紧、§5.10 的检测-回退、面板 UI。

**验收**：① 现有 `read` / `write` / `edit` / `str_replace` 行为不变（回归）；② 两个会话并发写
同一文件**串行**，审计能点名 actor；③ **不重叠**的 stale 编辑自动归并、并发改动被保住；
④ **重叠**的 stale 编辑返回带两侧内容的冲突（不是静默覆盖）；⑤ kill switch 打开即回旧语义；
⑥ 无新增依赖（除 git 本身），Windows 上临时路径有测试。

### 9.3 关键路径上的未知：1–3 已查清 / 已决定（2026-09-13）

1. **provider 替换机制【已查清】**：`dsh-base` 的 bundle patch 用 loader id **`fs-sandbox`**
   插入 `@deepseek-ai/dsh-fs-sandbox`（`dsh-fs-local` 只是它的父类依赖，不单独挂载）。
   替换 = profile patch 里 `- id: fs-sandbox` + `disabled: true`，再 `- insert:` 我们自己的
   provider——就是本 profile `cordis.patch.yml` 已经在用的那套 overlay（那里 disable 了
   `dsh-whale-keyboard`、insert 了 LSP 三行）。**不改官方包，是配置级。**
2. **base / `expected` 的来源【已查清】**：`dsh-tool-fs` 自己调
   `ctx.waterfall("fs/write-intent" | "fs/edit-intent", target, exec, () => void 0)`，把返回值当
   `intent` 传给 `ctx.fs.writeText` / `editText`，写完 `ctx.emit("fs/observed", …, {version})`。
   所以**决策在事件槽、写在 provider**，两者可以分开动；而作为 provider 我们看得见每次
   `read` / `write` / `edit` / `stat`，可以自己维护 version→content 缓存——**base 确实白拿**。
3. **observation policy【已决定：不要 read-before-edit】**：甚至不必「替换」它——把它 disable
   掉，waterfall 就回落到 `() => void 0`（intent 无守卫），守卫逻辑由我们的 provider 做。
   防「改错内容」的完整方案见 **§5.12**。
4. **sandbox 的 per-tool-family 旋钮【部分已知】**：`sandbox.resolvePolicy(capability, args, exec)`
   是**按能力**解析的（工具传 `"write"` / `"edit"`），但 `dsh-sandbox-policy` 的配置注释说
   没有 per-family 旋钮——**配置层能不能让 bash 与 fs 拿不同默认值仍未定**。只影响
   「ban bash 写」那一半，MVP 不做，但要在 MVP 文档里写明「bash 仍能写」这个已知漏洞。
5. **Windows / 多 worktree**：`git merge-file` 的临时目录、`FsTarget` 跨 worktree 的身份
   （测试项，不是阻塞项）。

### 9.4 要成为计划还缺的东西

- **落点**（§7.1）：独立插件，还是本仓 `src/coord/` 先走通；
- **tool 面**：保留现有 `write` / `edit` / `str_replace`，还是自己的 tool（未决）；
- **冲突 UX**：归并不成时给 agent 什么（未决）；
- **kill switch 与回归策略**（未决）；
- **测试策略**：provider 级 + 真仓库并发用例（未定）；
- **性能**：每次编辑多出一个 `git merge-file` 进程（未定）；
- **产品风险**：这是全 harness 每一次文件编辑的**承重梁**——出 bug 等于 agent 不能改文件。

### 9.5 两条 MVP 路线

- **A（最薄）**：先只做「自己的 edit tool」（读 `ctx.fs`、写 `ctx.fs`，像 `dsh-tool-edit`），
  把 apply 阶梯跑通。零承重风险、可增量；但**不是「统一入口」**，只覆盖愿意用它的 agent。
- **B（方向要求的）**：替换 provider。真正统一入口 + 归属；但动的是承重梁，**必须先 spike**。

**建议**：1–3 号未知已查清，所以 spike 的目的从「验证可行性」变成「验证接线」——
一个 passthrough provider（只记日志、不改行为）走通 overlay 挂载 + 事件槽 disable，
再按 §9.2 加那六件事。不通就退 A。

**2026-09-13 更新**：§9.4 的清单已逐条定下，落成 [plan/write-path.md](write-path.md)——
落点 = 本仓 + 同包两行；工具面 = **整包接管 fs 工具**（disable `dsh-tool-fs` 行，自注册
`read` / `write` / `edit` / `read_image`——机制上不存在「全局按名覆盖」，见 write-path.md）；
冲突 UX = 类型化错误 + 修复信息；
kill switch = 全局一个开关；安全策略 = **严格失败优先**（自身故障也拒写，带可 grep 的内部
错误码）；base = 内存 LRU + 只有 stale 才起 `git merge-file`。本节的两条路线随之收敛为 B。
