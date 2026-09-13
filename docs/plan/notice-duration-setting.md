# 计划 · 通知时长接进 DSH 设置（插件配置面）

- **来源**：`docs/requirements.md` §3.6 第 3 行；`docs/plan.md` §10.3 第 3 行、D40 末尾
- **对应 TODO**：[TODO.md](../TODO.md) A-3
- **状态**：未排期（产品方 2026-09-12 决定先不做）

## 目标

把悬浮通知的停留时长从代码常量变成可配置项，让用户在 DSH 设置里改。

## 现状

- 时长是 `src/client/ui/notice.tsx` 的 `NOTICE_DURATION_MS = 4000`，
  由 `StatusPanel` 作为 `durationMs` prop 传给 `Notice`（成功 4s 自动关、失败 `null` 等到按 ×）。
- 通知组件本身已经把时长做成「调用方给的值」，差的只是一个设置面。

## 做法（按 §10.3）

1. DSH 的 **`settings.section` 槽**（`@deepseek-ai/dsh-client-ui-settings`）注册一张设置卡；
   同 profile 的 `dsh-better-sidebar` 的「Side card」是现成例子。
2. host 侧要有 **settings 命名空间**与一对**读写路由**。
3. 面板读取该值并传给 `Notice`。

## 前置与理由

- 这是本插件的**第一个配置面**。`docs/plan.md` 把它记成「等真有功能需要设置时一起做」——
  也就是说，若同时还有别的可配置项（如 A-6 的虚拟滚动阈值、图标配置的 UI 面），
  应当与它共用同一套设置面，而不是各开一条路由。
- 文件名图标配置（D38）走的是独立 YAML 文件，不经过这里；两者是否需要统一入口，
  排期时一并定。

## 验收

设置卡能改时长并即时生效；host 侧读写路由经过与其它写路由相同的网关；未配置时回落 4s。
