# 计划 · 冲突行「打开文件」

- **来源**：`docs/plan.md` §10.4 / D21；`docs/requirements.md` FR-9.2
- **对应 TODO**：[TODO.md](../TODO.md) D 组第 1 条（**仍在「有意不做」组里，是否解禁由产品方定**）
- **状态**：原文的阻塞理由已被推翻（2026-09-13 复查），做法先记在这里

## 背景

D21 与 §10.4 拒绝这条的理由是：本 profile 的 `dsh-better-sidebar` 对外只有
`registerTab` / `registerFileViewer` / `registerFileIcon` 三个缝，**没有「按路径打开文件」**，
所以本插件没有绕过去的正当办法。

2026-09-13 复读该插件源码（v0.19.0，
`/home/tutu/.dsh/profiles/web/node_modules/dsh-better-sidebar`）后，这个前提不成立：

- `registerFileIcon` **全包不存在**（grep 零命中）；文件图标是 `TabDescriptor.icon` 字段。
- 公开面是 `ctx.betterSidebar`（`src/client/service.ts:408-493`），其中有
  **`openFile(scope, path, title?)`**（`service.ts:487`，feature flag `openFile`），
  内部落地为 `surface.openResource(<file address>)`（`service.ts:705-710`）。

本插件这边：冲突行现在只有「标记为已解决」（`ui/ChangeGroup.tsx:238`）与行菜单
（`StatusPanel.tsx:1832` 一带），没有任何打开文件的通道；`src/client` 也从未
`ctx.get('betterSidebar')`。

## 做法

1. 把 better-sidebar 当**可选依赖**：用 `ctx.get('betterSidebar')` 探测，
   **不要写进 `inject`**——它没启用时本插件仍要能起来；能力再按 feature flag `openFile` 判断。
2. 冲突行加一条「打开文件」，与「标记为已解决」**并列**（两者是不同意图，不是替代）。
   落在 D43① 的同一条判断上：**有能力才给入口**，没有就什么也不渲染——
   一个按下去没反应的入口比少一个入口更糟。
3. 打开目标是工作区绝对路径，标题用仓库相对路径。

## 代价与已知限制

- 这是本插件**第一次依赖同 profile 的另一个插件**。要在计划里写明降级行为，
  而不是让它变成隐性硬依赖。
- 读源码得到的两条限制：原生 surface **只在面板挂载时存在**（`native/surface.ts:9-18`），
  其原生标签布局是**内存态**（不持久）。surface 不在时入口应如实不可用，不能静默失败。
- 若不愿引入这个依赖，替代方案是用本插件已有的 tab 注册能力自己开一个文件标签，
  但那等于重造一个文件查看器，成本高得多。

## 验收

装有 better-sidebar 时，冲突行出现「打开文件」并能在右侧栏打开该文件；
未安装、未启用或 surface 不在时该入口不出现/不可用，面板其余功能不受影响。
