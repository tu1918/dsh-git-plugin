# TODO · dsh-git-panel

> 未交付项清单，逐条核对到 2026-09-13（包版本仍为 `0.1.0`）。
> 来源是 `docs/requirements.md` §3.6「已登记、尚未排期的需求」与 `docs/plan.md`
> §10.2 顺序 10 / §10.3 / §10.4，以及散在 D 编号决策里的「已知未做」。
>
> 两份文档分工：`requirements.md` 写**要什么**，`plan.md` 写**已经是什么、为什么**。
> 本文件只负责「还差什么」，并在文档里已有做法/前置条件时指向
> `docs/plan/<slug>.md`。已交付范围见 `README.md` 的「What works today」与
> `docs/plan.md` §1。
>
> **维护规则：条目一旦完成就从本文件删除**（不留 ✓、不留「已交付」小节），
> 它对应的 `docs/plan/<slug>.md` 一并删除；本文件因此永远只列未完成项。

## 状态速览

- 里程碑 M0–M5b 的功能**全部交付**，M5b 按 `docs/plan.md` §10.2 只剩顺序 10 发布收尾。
- 下面 A 组 8 条来自 §3.6 / §10.3（产品方已登记、未排期）；B 组 1 条是发布收尾；
  C 组 2 条是文档在 D 决策里点名的具体缺口（做法已写明）；D 组是有意不做/等条件的；
  E 组只差验证，不是代码工作量。
- **一处文档已过时**：`docs/plan.md` §10.3 列的「凭据缺失的专门文案」在 D44 已交付
  （`auth-required` 分类 + 失败通知内的凭据表单 + 重跑原操作），不再是待办。
  §3.6 那一格说的是另一件事（SSH / 代理 / 同主机多仓库不同凭据），见 A-8。

---

## A. 已登记、尚未排期的功能

| # | 待办 | 文档条目 | 为什么没做 / 现状 | 计划 |
|---|---|---|---|---|
| A-1 | **检出远程分支**（新建跟踪分支 / 快进 / Rebase onto origin / Drop local commits） | requirements §3.6 第 1 行；FR-4.5；plan §10.3 第 1 行、D43 | 只读列表已交付；检出可能改写历史（rebase onto origin / drop local commits），且**先要冲突处理**才能安全收尾——FR-9 与顺序 9 的在途操作条现已交付，前置已解锁 | [plan/checkout-remote-branch.md](plan/checkout-remote-branch.md) |
| A-2 | **在右侧栏自己的标签页里打开 diff**（不再只开在面板底部 dock） | requirements §3.6 第 8 行；plan §10.3 末行（产品方 2026-09-13 提出） | 路已通（已注入 `@deepseek-ai/dsh-client-ui-sidebar-right`，支持同 pane 多标签）；排期前要先定三件事 | [plan/diff-sidebar-tab.md](plan/diff-sidebar-tab.md) |
| A-3 | **通知时长接进 DSH 设置**（插件配置面） | requirements §3.6 第 3 行；plan §10.3 第 3 行、D40 末尾 | 现在是代码常量 `NOTICE_DURATION_MS = 4000`；产品方 2026-09-12 决定「等真有功能需要设置时一起加」 | [plan/notice-duration-setting.md](plan/notice-duration-setting.md) |
| A-4 | **非仓库时的「初始化仓库」按钮**（执行 `git init`） | requirements §3.6 第 2 行；§4.3 空态引导；plan §10.3 第 2 行 | 现在只有一句 `noRepo.hint` 文案，没有按钮 | 无（文档只给了目标，没给做法） |
| A-5 | **上下方向键导航变更列表** | requirements §3.6 第 4 行；§4.3 键盘；plan §10.3 第 4 行 | `Ctrl+Enter` / `Esc` / `Shift+F10` 已有，这一条没有 | 无 |
| A-6 | **diff 虚拟滚动** | requirements §3.6 第 5 行；§6 性能 P1；plan §10.3 第 5 行 | 现靠 FR-2.6 的「>5000 行默认折叠」兜底，展开后整块渲染 | 无 |
| A-7 | **gpg 签名卡死的专门文案** | requirements §3.6 第 6 行；plan §10.3 第 6 行、§11 | `commit.gpgsign=true` 的仓库里提交会卡到 15s deadline；`GIT_TERMINAL_PROMPT=0` 管不到 gpg。M2 不传 `--no-gpg-sign`（会静默产生未签名提交，更糟） | 无（待办只说了「识别并给出文案」） |
| A-8 | **凭据的其余角落**：SSH、代理、同主机多仓库不同凭据 | requirements §3.6 第 7 行；FR-11.4；plan §11 | 本期只覆盖 HTTPS 且按 origin 寻址（git 的提示串只到 origin，故同主机多仓库共用一份）；本地 provider 今天仍是明文 YAML | 无 |

## B. 发布收尾

| # | 待办 | 文档条目 | 现状 | 计划 |
|---|---|---|---|---|
| B-1 | **v1.0 发布收尾**：版本号 `0.1.0` → `1.0.0`、README / `plan.md` 已交付范围与测试计数对齐、安装路径核对 | plan §10.2 顺序 10 | 版本号实测仍是 `0.1.0`；安装只验过 `link:` 装法；两份文档的测试计数不一致（plan.md 写 557、requirements.md 写 566） | [plan/release-v1.md](plan/release-v1.md) |

## C. 文档已登记的具体缺口（做法已写明）

| # | 待办 | 文档条目 | 现状 | 计划 |
|---|---|---|---|---|
| C-1 | **分离 HEAD 时该提交没有 ref 胶囊**（补一种 `head` 类型） | plan D47 末尾「已知未做」 | 胶囊只认 `refs/heads` / `refs/remotes` / `refs/tags`；游离 HEAD 的提交一条胶囊都没有（同 profile 的 better-sidebar 会显一个 `HEAD`） | [plan/head-ref-capsule.md](plan/head-ref-capsule.md) |
| C-2 | **上游被远端删除时要能提前报告**（`--prune` 或 `remote prune --dry-run` 的只读报告） | plan D42 末段 ⚠、D45 | 获取不带 `--prune`（有意），过期的 `origin/<x>` 让 `upstreamGone` 保持为假，`pull` 要按下去才报错 | [plan/upstream-gone-prune.md](plan/upstream-gone-prune.md) |

## D. 有意不做 / 等条件（不排期）

- **冲突行「打开文件」**（FR-9.2；plan §10.4、D21）：本 profile 的 `dsh-better-sidebar`
  对外只有 `registerTab` / `registerFileViewer` / `registerFileIcon` 三个缝，没有
  「按路径打开文件」。等上游出现这个缝再做，本插件没有绕过去的正当办法。
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
