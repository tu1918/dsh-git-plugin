# 计划 · 分离 HEAD 时的 ref 胶囊

- **来源**：`docs/plan.md` D47 末尾「已知未做」
- **对应 TODO**：[TODO.md](../TODO.md) C-1
- **状态**：未排期（文档写着「留待需要时」）

## 背景

D47 给历史行加了 ref 胶囊（本地分支 / 远程分支 / 标签），数据来自多读一次的
`for-each-ref`，按**命名空间**（`refs/heads` / `refs/remotes` / `refs/tags`）定类型。

后果：**分离 HEAD 时该提交没有任何胶囊**——`refs/heads` 不覆盖游离 HEAD。
同 profile 的 `dsh-better-sidebar` 在这种情况会显示一个 `HEAD`。

## 做法（按 D47）

1. `core/types.ts` 的 `CommitRefKind` 新增一种 `head`（当前只有 `branch` / `remote` / `tag`）。
2. 在 `log` 读取时用**已经读到的 status** 判断当前 HEAD 是否游离、以及它指哪一条提交，
   给那一条补一个 `head` 类型的胶囊；命名空间判断那一套（`%(symref)` 非空排除符号引用等）
   不因此改变。
3. UI 的胶囊配色 / tooltip 为 `head` 补一档。

## 注意

- 胶囊类型是从命名空间推出来的，`head` 是唯一一个**不能**由 `for-each-ref` 命名空间得到的，
  所以它的来源必须写清楚，别让它看起来像第四条命名空间。
- 若将来同类需求变多（如 `ORIG_HEAD`、`FETCH_HEAD`），先想清楚哪些值得进胶囊再扩。

## 验收

分离 HEAD 时，HEAD 所指的那条提交恰好有一个 `head` 胶囊；非游离时行为逐字节不变。
