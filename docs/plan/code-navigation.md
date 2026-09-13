# 计划 · 侧边栏里的定义/引用跳转（代码导航）

- **来源**：`docs/plan.md` §10.3（产品方 2026-09-13 提出）
- **对应 TODO**：[TODO.md](../TODO.md) A-14
- **状态**：未排期。方向已选定（本地编译器优先、`ctx.lsp` 只作可选一路，落点用本插件已经在用的
  原生右侧栏 resource 类型），但**范围本身**还要产品方定，见「待定」第 1 条

## 背景

- 今天侧边栏里没有任何代码导航：本插件的两个 tab 都是**只读视图**（变更面板与 diff，
  `src/client/adapter/sidebar-tab.tsx`），编辑器属于 profile 里的另一个插件
  （`dsh-better-sidebar`），不是本插件的东西。
- **本插件已经有开自己视图的全部接缝，不必新增依赖**。原生右侧栏的两级注册已在使用：
  类型进 `ctx.sidebarRightTabs.register`，正文与 chip 标题进 `slots`
  （`src/client/index.tsx:46`、`:63`、`:77`、`:109`）。而且已经有一个 **resource 类型**的先例
  ——diff tab 用 `patterns: ['dsh-resource://git-diff/**']` + `canOpen` + 自己的地址编解码
  （`sidebar-tab.tsx:48-116`、`:159`）。resource tab 按地址认领、按 `(kind, contentId)` 去重，
  正是「一个文件一个 tab、一个读法一个 chip」的形状。
- **行号是原生参数，不用自己发明**：`openResource(address, { params: { line } })`，`file`
  类型已经声明 `file: { line?: number }`，会话区的文件链接与工具行的行号引用走的就是这条路
  （`@deepseek-ai/dsh-client-ui-sidebar-right/lib/types/client/contract/params.d.ts:6`）；
  其它 resource 类型把自己的那项并进 `SidebarRightResourceParamsMap` 即可（同文件 `:21`）。
  这条**替代**了「better-sidebar 的 `openFile` 没有行号」那个缺口——走原生面就没有这个缺口。
- **现成的能力缝只有一条，而且不够用**：官方 `ctx.lsp` 恰好四个只读操作
  （`goToDefinition` / `findReferences` / `goToImplementation` / `hover`），语言服务器要部署方
  自己装并配 `dsh-lsp-stdio`，provider 独占扩展名（撞名 `LSP_CONFLICT`、没装
  `LSP_UNAVAILABLE`），并且**没有 documentSymbol**——符号大纲只能自己解析。
  所以不把 `ctx.lsp` 当唯一路径，而是当**一条可选 adapter**。
- 生态里的两个先例值得照抄形状：`dsh-code-nav` 做了只读代码预览（轻量分词 + 符号大纲 +
  文件内查找，**没有跨文件跳转**）；`dsh-code-check` 证明「插件在 host 半跑本地编译器」可行
  ——监听 `fs/observed`、800ms 防抖、按被编辑文件向上找最近的 `tsconfig.json`。

## 目标

在侧边栏里从某个符号**跳到它的定义**（跨文件也要落到那一行），并能**列出引用**、点一条跳过去。
**只读**——不改磁盘。

## 做法

三半分开，跟着本插件已有的分层（`test/dependency-direction.test.ts` 钉住 core / client / host
的依赖方向）。

1. **host 半：一个 CodeIntel 服务 + 三条路由**。路由进既有的 `/git-panel` 前缀
   （`src/host/adapter/routes.ts:51`），沿用同一套信封（`{ ok, value }` / `{ ok, error }`）与
   两道闸门；只读回答 `GET`、进 `READ_OPERATIONS`。接口就三条：
   `definition(file, line, col)`、`references(file, line, col)`、`symbols(file)`。
   下面是多个 **adapter**，按扩展名 + 可用性挑，结果带 `engine` 字段，好让 UI 如实标注精度：
   - `ts-service`（**第一个做**）：host 半直接 `import` `typescript`（现在是 devDependency，
     要提进 `dependencies`），用 `ts.createLanguageService` 的
     `getDefinitionAtPosition` / `findReferences` / `getNavigationTree` / `getQuickInfoAtPosition`。
     **常驻、增量**，不每次重建 Program——这是它相对 `lsp-stdio`（每次查询
     transient-open）的实质优势。
   - `ctags`：universal-ctags / GNU Global 的索引，覆盖其它语言；纯语法、精度掉一档，作兜底。
   - `lsp`（可选第三路）：`ctx.get('lsp')` 探测，有 provider 且扩展名有主时优先，
     `query({ operation, filePath, position, workspaceRoot })` 的结果直接映射；没装就整段不参与。
2. **core 半：纯函数**。零基 UTF-16 的 `(line, char)` ⇄ 编辑器偏移的换算、地址编解码
   （照 diff 那条先例）、引擎选择规则，都放 `core/`，可单测、不碰 IO。
3. **client 半：第三个 tab 类型**（resource）。地址自带文件与目标行，body 是只读代码视图 +
   Ctrl/Cmd+Click 跳转 + 引用列表；跳转用 `tab.actions.openResource(...)` 走同一个控制器
   （同 `(kind, contentId)` 聚焦、否则新开）。**不认领 `dsh-resource://file/**`**：那会与
   better-sidebar 的 `editor` 落在同一个地址上，同档（`extension`）再比模式长度、最后比注册
   顺序——胜负由加载顺序决定，不稳（`.../dsh-client-ui-sidebar-right/README.zh.md:80`）。
   用自己的 scheme，例如 `dsh-resource://git-panel-code/…`。

## 待定（要产品方定）

1. **范围**：这已经超出「git 面板」。继续放在本插件里，还是另起一个插件？若放这里，是当第三个
   常驻 tab 类型（自己开代码视图），还是只在变更 / 冲突 / diff 的入口上挂一个「看定义」的窄面
   （点开只显示定义与引用列表，文件本身仍交给别的编辑器）？后者不动编辑器，成本低一档。
2. **要不要可编辑**：只读导航不用碰编辑与保存；「编辑器 + 导航」要自己带一份 CodeMirror
   ——`dsh-better-sidebar` 的编辑器 chunk 是它内部件（`/sidebar/bundle` + 它自己的
   chunk-loader），跨插件拿不到，等于重造。选后者要认这笔成本。
3. **默认开哪几条 adapter、按什么顺序探测**：`ts-service` 用户零成本；`ctags` 要用户装；
   `ctx.lsp` 要用户配 server。以及 `ts-service` 用哪份 `typescript`（插件自带的依赖，还是解析
   工作区里的那一份——后者版本更贴项目，但等于执行被审仓库的代码）。
4. **首查延迟怎么呈现**：建 Program / 全仓索引是秒级。点第一下要有 loading 与「还在建索引」的
   说明，还是先要求用户显式「建立索引」。
5. **入口**：diff 行 / 变更行 / 冲突行上的右键菜单，还是只在自己代码视图里 Ctrl+Click。

## 代价与已知限制

- **正确性绑在编译上下文上**：tsconfig 的 `paths` 与项目引用、`compile_commands.json`、GOPATH
  ——flags 不对就跳到「看起来像」的位置；`ctags` 那一路则是主动放弃类型精度（没有重载 / 宏 /
  成员解析）。UI 必须把 `engine` 显示出来，不能假装同等可信。
- **进程与内存**：常驻 TS LanguageService 在大仓库吃内存，要按 workspace root 隔离、并考虑
  空闲回收；不能像 `lsp-stdio` 那样每查询起一次就走。
- **失效**：跟着 `fs/observed` 走（`dsh-code-check` 的模式：防抖 + 按被编辑文件向上找最近
  `tsconfig.json`），否则跳转会落在旧位置上。
- **安全**：从工作区解析编译器（`node_modules/.bin/tsc`）等于执行被审仓库的代码；优先从 PATH
  或插件自己的锁定依赖解析。spawn 语言服务器同理。
- **相对 `ctx.lsp` 丢掉的是统一协议**；换来的是不要求用户装语言服务器、能给出 documentSymbol
  （seam 没有）、以及没有每查询 transient-open 的固定开销。
- 只读纪律：这条链不写任何文件。它与 git 那条「只读用 `GIT_OPTIONAL_LOCKS=0`」是两套东西，
  别混。

## 验收

- TS 仓库里 Ctrl/Cmd+Click 一个符号 → 落到定义那一行（跨文件时开 / 聚焦一个 code tab 并高亮
  该行）；「查找引用」列出全部引用，点一条跳过去。
- 引擎不可用（没装 ctags / 没配 lsp / 找不到 tsconfig）时入口**不可用并给出原因**，不是静默
  失败——与 D43① 同一条判断。
- 分层门禁与既有测试全绿（`npm run check`）；新增用例只覆盖 core 的纯函数与 host 的引擎选择，
  不依赖真实语言服务器。
