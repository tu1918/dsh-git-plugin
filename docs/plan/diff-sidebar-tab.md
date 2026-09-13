# 计划 · 在右侧栏自己的标签页里打开 diff

- **来源**：`docs/requirements.md` §3.6 第 8 行；`docs/plan.md` §10.3 末行（产品方 2026-09-13 提出）
- **对应 TODO**：[TODO.md](../TODO.md) A-2
- **状态**：未排期

## 目标

把 diff 从 Git 面板**底部的 dock** 改到**右侧栏自己的标签页**里打开，让 diff 拿到整栏高度
（现在拿到的是面板减掉提交框与变更列表之后的那半屏）。

## 现状

- diff 开在面板底部的 dock：一条文件一条标签，标签条归面板（`openFiles` + `tab`，
  `BottomPane` 是受控组件），见 `docs/plan.md` 的「验收期改动：底部 pane 的 diff 标签」。
- 路已通：本插件已注入 `@deepseek-ai/dsh-client-ui-sidebar-right`，它支持同一 pane 内多条标签，
  且 `ISidebarRight.openTab(kind, options)` 带 `paneId` / `revealIfOpened` / `replaceTab`。

## 做法（按 §10.3）

像 `gitPanelDefinition` 那样**再注册一个类型**：

- `client/adapter/sidebar-tab.tsx` + `client/index.tsx` 两段注册；
- 参数经 `SidebarRightTabParamsMap` 声明；
- 打开动作从 tab body 的 `useTabInfo().tab.actions.openTab` 发起。

## 排期前要先定三件事（文档点名）

1. **一个文件一条标签，还是所有 diff 共用一条**：page 类型按 `kind` 记在一个地址上、
   同 pane 内**恒去重**（`revealIfOpened` 只管 resource 类型）。所以「一个文件一条」
   要么走 resource 类型（地址即路径，天然按文件分开），要么共用一个标签、靠
   `params` + `navigation.revision` 换内容。
2. **标签条的开关与面板内 `openFiles` / `tab` 这套状态谁说了算**：dock 今天是受控组件，
   而标签页版的标签条归 sidebar-right。
3. **底部 dock 是留还是撤**。

## 验收

打开 diff 后它出现在右侧栏的独立标签页、占满整栏高度；多文件行为与上面第 1 条的决定一致；
面板内的 diff 入口与状态不两处各说各话。
