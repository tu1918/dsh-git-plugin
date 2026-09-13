# 计划 · diff 布局改成单按钮切换

- **来源**：`docs/plan.md` §10.3「diff 视图改成单按钮切换」（产品方 2026-09-13 提出）
- **对应 TODO**：[TODO.md](../TODO.md) A-10
- **状态**：未排期；落在 A-9 划出的**视图操作**区里

## 目标

布局从两枚段控按钮改成**一枚按钮**：点一下在「上下对照（inline）」与「左右对照
（side-by-side）」之间切换，icon 与当前视图一致——点击后 icon 变、视图也变。

## 现状

- `DiffView.tsx:442-463`：两枚 `diffSegButton` 装在 `diffSeg` 托盘里，`aria-pressed`
  标出当前布局；icon 分别是 `ArrowDownGlyph`（inline）与 `SplitGlyph`（split）。
  选中态上色靠 `.diffSegButton[aria-pressed='true']`（`styles.ts:2254`）。
- 持久化已经有了：`readDiffLayout` / `writeDiffLayout` + `DIFF_LAYOUT_KEY`
  （`DiffView.tsx:50-87`），写失败被刻意吞掉。

## 做法

1. 删掉段控，换成一枚 `<button>`：`onClick` 把 layout 取反；icon 按**当前** layout 选
   ——inline 时 `ArrowDownGlyph`、split 时 `SplitGlyph`，与今天两枚按钮各自的样子一致。
2. **文案要换语义**：`aria-pressed`（「现在哪个开着」）在单按钮上没有位置，
   改成 `title` / `aria-label` 说「点下去会变成什么」，新增 `diff.toSplit` / `diff.toInline`
   两条 key（`locales.ts:241` 一带，zh/en 各一份）。
3. 按钮归哪个容器由 A-9 定：视图操作区若整体做成一个托盘，这一枚进托盘；否则单独一枚
   `cls.tool`。`diff.layout` 这条 group 文案只在这一枚还需要分组标签时保留。
4. 测试要改：`test/client-panel.test.ts:3329`（取两枚按钮、点第二枚切左右）、`:3372`
   （重开后仍在左右）、`:3386` 三处都写着「两枚」的假设，改成单按钮的点按 +
   icon / `aria-label` 断言。

## 注意

- 产品方明确「点击之后 icon 变、视图也变」，所以 **icon 表达当前状态**，
  下一步的信息由 `title` / `aria-label` 承担——别反过来做成「icon 预示下一步」。
- `writeDiffLayout` 的容错照旧：`localStorage` 不可用（隐私模式、jsdom）时不能炸。

## 验收

头部只有一枚布局按钮；点它视图在两种布局间切换、icon 同步变；重开面板后仍是切换后的布局；
无 `aria-pressed` 遗留。
