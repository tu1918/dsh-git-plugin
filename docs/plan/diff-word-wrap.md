# 计划 · diff 视图的「自动换行」开关

- **来源**：`docs/plan.md` §10.3「diff 视图增加『自动换行』」（产品方 2026-09-13 提出）
- **对应 TODO**：[TODO.md](../TODO.md) A-11
- **状态**：未排期；**做法已定（2026-09-13 产品方选 c）**——折行只在「上下对照」布局可用

## 目标

给 diff 加一个开关：打开后长行折行，不再靠横向滚动看全。
**左右对照下不提供这个能力**（见「已定的做法」）。

## 现状

- `.diffText` 是 `white-space: pre`（`styles.ts:2400-2407`），长行不折。
- 上下对照靠 `.diffLine { min-width: min-content }`（`styles.ts:2366`）+ 容器横向滚动看全。
- 左右对照是**两个各自滚动的半栏**（`SplitHunks`，`DiffView.tsx:251-311`），同步
  `scrollTop` 与 `scrollLeft`（`:263-269`）。配对的两格靠内容自然撑高
  （`.diffCell` 的 `min-height: 18px`，`styles.ts:2373-2377` 的注释写明"两格必须一样高，
  否则读下去两半会错位"）。
- 布局偏好的持久化范式已存在（`DIFF_LAYOUT_KEY`，`DiffView.tsx:64-87`）。
- 同 profile 的 `dsh-better-sidebar` **没有**这个开关：它的 diff 恒定 `pre-wrap`
  （`src/client/diff/diff.module.css:27`），没有可抄的开关实现。

## 已定的做法（产品方 2026-09-13 选 c）

> 曾经的候选 a（折行时改用单滚动容器 + 两列 grid 行）与 b（量测行高、两格写同样的
> `min-height`）都**已排除**：它们要动 FR-2.4 已经验收过的左右布局内部结构。选 c 之后
> 左右布局那两个滚动容器及其同步逻辑一行都不用改。

1. **状态**：新增 `DIFF_WRAP_KEY = 'dsh-git-panel/diff-wrap'` 与一对带守卫的读写函数，
   形状照抄 `readDiffLayout` / `writeDiffLayout`（`DiffView.tsx:64-87`）。
   默认**关闭**。状态放在 `DiffPane`（像 layout 那样），`DiffView` 保持纯渲染。
2. **只在上下对照生效**：折行的判定是 `layout === 'inline' && wrap`，两者都成立时
   diff 区域才挂 `data-wrap='true'`；该属性下 `.diffText` 换成
   `white-space: pre-wrap; overflow-wrap: anywhere`，同时去掉
   `min-width: min-content`（否则容器照样横向滚动）。
3. **左右对照下按钮禁用**：`disabled` + `aria-label` / `title` 说明原因
   （新增 key，例如 `diff.wrapSplitOff`："左右对照下不支持自动换行"），
   而不是把按钮藏起来——藏起来用户会以为功能没做。
   按钮的 `aria-pressed` **保持真实值**（如实显示偏好），只是当前布局下不生效。
   > 若产品方更想要"切到左右对照就自动关掉"，改动更小，但会丢偏好；
   > 排期时确认一句即可。
4. **持久化与容错照旧**：`localStorage` 不可用（隐私模式、jsdom）时不炸，本次选择仍生效。

## 测试

- `test/client-panel.test.ts:902` / `:908` 钉的是 `diffSplit` 的 `display: flex` 与
  `gap: 16px`——**选 c 后这些断言不用动**（左右布局结构没变），只需新增：
  上下对照下打开开关 → `data-wrap='true'` 且 `pre-wrap` 生效；切到左右对照 →
  按钮 `disabled`、不再折行；重开后开关状态还在。

## 验收

上下对照下开关打开后长行折行、面板不再横向滚动；关闭后回到今天的行为；开关状态持久化；
左右对照下按钮可见但禁用，且不折行（两半不错位，因为压根没折）。
