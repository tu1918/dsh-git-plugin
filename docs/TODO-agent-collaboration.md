# TODO · agent 协作与统一写入口

> 与 `docs/TODO.md`（dsh-git-panel 面板自身）**分开维护**：这里只放**面向 agent 的那条线**——
> 统一写入口、多 agent 协作、提交出处。产品方 2026-09-13 定：单独立册，免得跟面板待办混在一起。
> 依据：讨论记录 [`plan/agent-collaboration.md`](plan/agent-collaboration.md)；
> 写入口的计划 [`plan/write-path.md`](plan/write-path.md)。
> **维护规则同 `docs/TODO.md`：条目完成即删除**，不留 ✓。

## 已定的方向（不是待办，列在这里防遗忘）

- 人的角色 = **review + 状态监控**；执行交 agent（讨论文档 §2.1）。
- **共享工作区为默认**，不用 worktree 隔离（§2.4）。
- 写入口**落在本仓、同包两行**：`dsh-git-panel` + `dsh-git-panel/fs`（write-path.md「落地形状」）。
- **观察者先行**（P0 → P4）；黑板与出处**默认关**（write-path.md「排期」）。

## W. 统一写入口（原 `docs/TODO.md` 的 A-17）

| # | 待办 | 依据 | 状态 |
|---|---|---|---|
| W-1 | **P0 前置**：`exports` 加 `./fs` + build 第三个 host 产物 + 本包 patch 两行 + 确认 `passthrough` 默认惰性 | write-path.md「排期」 | 未开工 |
| W-2 | **P1 观察者**：passthrough provider（`extends SandboxedFileSystem`）+ 自注册 `read` / `write` / `edit` / `read_image`（原样转发）+ **归属** + **审计** + **shadow 决策日志** | 同上 | 未开工 |
| W-3 | **接口 schema 落地**：按 write-path.md「与 UI 的接口 schema」写 `core/write-path.ts`；host 发布 **`ctx.writePath` 服务**（**自己不注册任何路由**） | write-path.md | 未开工 |
| W-4 | **P1 待验**：`WriteActor.model` 拿不拿得到（工具执行上下文里有没有 model）——拿不到就置 `null` | write-path.md schema | 未开工 |
| W-5 | **P2 review 面**：变更行「**来源胶囊**」+ dock 第三 tab「**活动**」+ `GET /write/attribution`、`GET /write/audit` + SSE 帧 `{kind:'write',seq}` | write-path.md「排期」 | 未开工 |
| W-6 | **P2 待定**：已暂存行没有归属（索引变化来自 `git add` 等命令，不经过 `ctx.fs`）——显示「来自 git 操作」还是不显示 | write-path.md schema | 未开工 |
| W-7 | **P3 开强制**：按路径排队 / base 校验 + 三方重放 / 类型化拒绝 + 修复信息 / **严格失败优先** + 可 grep 的内部错误码 / kill switch | write-path.md「已定的设计决定」 | 未开工 |
| W-8 | **P3 动作接口**：`GET /write/pending` + `POST /write/decide`（同源 + loopback，进 `WRITE_OPERATIONS`） | write-path.md schema | 未开工 |

## C. 开关项（默认关，各自独立验收）

| # | 待办 | 依据 | 状态 |
|---|---|---|---|
| C-1 | **黑板**（`blackboard: false`）：intent / 影响半径 / review 状态 / 推送。产品方：不是所有人都用，且是新的尝试 | 讨论文档 §5.3 / §5.7 / §5.8 | 未开工 |
| C-2 | **提交出处与验真**：SSH 签名、粒度到 subagent、author 保持本人、身份 ambient、盖章位置与密钥策略 | 讨论文档 §4 | 未开工 |

## D. 未决（要产品方定）

- 黑板归协调层还是面板 host（§7.10）；契约用什么格式（OpenAPI / JSON Schema / 共享类型）。
- 「谁能叫醒谁」的策略（§7.9②）——平台**不拦**，得我们自己定。
- 推送的强度阶梯默认值（默认 `inject`、不打断？）。
- 出处的盖章位置（§4.3）与密钥策略（§7.4 / §7.5）。
- Mergiraf 是否采用（§7.7）；`dsh-file-claim` 自建还是借鉴（§7.6）。
- 讨论文档 §9.4 那几项（tool 面 / 冲突 UX / kill switch / 安全策略 / base 存放）**已定**，
  见 write-path.md，不在这里重复。
