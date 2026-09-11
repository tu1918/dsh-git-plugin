/**
 * The panel's copy, in both shipped languages.
 *
 * The dictionary is declared in the `gitPanel` locale namespace, which is what
 * makes the key set type-checked: the Chinese dictionary below is the source of
 * truth for the key union, and English is checked against it, so a key added to
 * one language and forgotten in the other is a compile error rather than a
 * string that silently falls back.
 *
 * The wording follows the doc's terminology rule (§3.1): "暂存" always means
 * stage, and stash is always "贮藏", so the two are never confused the way
 * Visual Studio's Chinese translation confuses them.
 *
 * @module dsh-git-panel/client/locales
 */

/**
 * The namespace every one of this plugin's strings lives in.
 *
 * The namespace itself is DECLARED to the slot runtime in
 * `client/adapter/locale.ts`; keeping that declaration out of this file leaves it
 * free of every DSH import, so the dictionaries stay plain data.
 */
export const NS = 'gitPanel'

/** Simplified Chinese dictionary, and the key-set source of truth. */
export const zh = {
  'type.label': 'Git',
  'guide.title': 'Git 变更',
  'guide.description': '查看当前工作区的改动与分支状态',

  loading: '正在读取…',
  'action.refresh': '重新读取',
  'action.retry': '重试',

  'branch.detached': '游离 HEAD',
  'branch.unborn': '尚无提交',
  'branch.upstreamGone': '上游已删除',
  'branch.ahead': '领先上游 {count} 个提交',
  'branch.behind': '落后上游 {count} 个提交',
  'branch.synced': '与上游一致',
  'branch.noUpstream': '尚未设置上游分支',

  'group.staged': '已暂存的更改',
  'group.unstaged': '更改',
  'group.untracked': '未跟踪的文件',
  'group.conflicted': '合并冲突',
  'group.count': '{count}',

  'clean.title': '没有未提交的更改',
  'clean.hint': '工作区与 HEAD 一致。',

  'noRepo.title': '这里不是 Git 仓库',
  'noRepo.hint': '在会话的工作区里运行 git init，再回到这里。',

  'history.title': '最近提交',
  'history.loadMore': '加载更多',
  'history.empty': '提交之后，历史会显示在这里。',
  'history.pushed': '已在远端',
  'history.unpushed': '尚未推送',

  'state.truncated': '改动太多，列表只显示了一部分。',
  'state.binary': '二进制文件',

  'error.notARepo': '这个目录不在 Git 仓库中。',
  'error.noSession': '这个会话没有可用的工作目录。',
  'error.gitMissing': '找不到 git 命令，请确认这台机器已安装 Git。',
  'error.timeout': 'Git 响应太慢，这次读取已中止。',
  'error.tooLarge': '输出太大，这次读取已中止。',
  'error.badRequest': '请求不完整，请重新打开这个面板。',
  'error.generic': '读取失败：{message}',
} as const

/** English dictionary, checked against the Chinese key set. */
export const en: Record<GitPanelKey, string> = {
  'type.label': 'Git',
  'guide.title': 'Git changes',
  'guide.description': 'Review this workspace’s changes and branch state',

  loading: 'Reading…',
  'action.refresh': 'Reload',
  'action.retry': 'Try again',

  'branch.detached': 'Detached HEAD',
  'branch.unborn': 'No commits yet',
  'branch.upstreamGone': 'Upstream is gone',
  'branch.ahead': '{count} commits ahead of upstream',
  'branch.behind': '{count} commits behind upstream',
  'branch.synced': 'Up to date with upstream',
  'branch.noUpstream': 'No upstream branch set',

  'group.staged': 'Staged changes',
  'group.unstaged': 'Changes',
  'group.untracked': 'Untracked files',
  'group.conflicted': 'Merge conflicts',
  'group.count': '{count}',

  'clean.title': 'No uncommitted changes',
  'clean.hint': 'The working tree matches HEAD.',

  'noRepo.title': 'This is not a git repository',
  'noRepo.hint': 'Run git init in the session’s workspace, then come back.',

  'history.title': 'Recent commits',
  'history.loadMore': 'Load more',
  'history.empty': 'Commits will show up here.',
  'history.pushed': 'On the remote',
  'history.unpushed': 'Not pushed yet',

  'state.truncated': 'Too many changes: the list shows only some of them.',
  'state.binary': 'Binary file',

  'error.notARepo': 'This directory is not inside a git repository.',
  'error.noSession': 'This session has no usable working directory.',
  'error.gitMissing': 'The git command was not found. Check that Git is installed on this machine.',
  'error.timeout': 'Git took too long, so this read was stopped.',
  'error.tooLarge': 'The output was too large, so this read was stopped.',
  'error.badRequest': 'The request was incomplete. Reopen this panel.',
  'error.generic': 'Could not read: {message}',
}

/** Every key the panel can translate. */
export type GitPanelKey = keyof typeof zh
