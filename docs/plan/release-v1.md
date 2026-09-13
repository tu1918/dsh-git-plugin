# 计划 · v1.0 发布收尾

- **来源**：`docs/requirements.md` §7（M5b 验收标准 = 发布 v1.0）、§6「安装」行
  （该文件已于 2026-09-13 删除，标签为历史出处）；`docs/plan.md` §10.2 顺序 10
- **对应 TODO**：[TODO.md](../TODO.md) B-1
- **状态**：未排期；M5b 的其余顺序均已交付

## 目标

把当前 `0.1.0` 发布为 `1.0.0`，并把文档口径、安装路径与真实状态对齐。

## 步骤（按 §10.2 顺序 10）

1. **版本号** `0.1.0` → `1.0.0`（`package.json`；实测目前仍是 `0.1.0`）。
2. **README 与 `docs/plan.md` 的已交付范围对齐**，并修正测试计数口径：
   - `docs/plan.md` 头部写 557 项测试；以 `npm run check` 的实际输出为准改成同一个数
     （原先与它不一致的另一份文档 `docs/requirements.md` 已于 2026-09-13 删除）。
3. **安装路径核对**：目前只验过 `link:` 装法（原 `docs/requirements.md` §6、§8 第 6 条，
   该文件已删除）。要真跑一次 `dsh plugin --profile web add <pkg>`，确认 `dsh.bundle`
   清单无需手写 patch。
4. 顺带核对 `README.md` 的「Install」「Check」两节与真实命令一致。

## 验收

- `npm run check` 全绿（`tsc --noEmit` + 测试 + 两个打包产物）。
- `dsh plugin --profile web add` 一条命令装得上、`dsh web` 启动后面板可用。
- 版本号、README 与 `docs/` 的口径一致，不再互相矛盾。
