/**
 * The AI commit message, as pure functions: what the model is asked, and what
 * the panel does with the answer (FR-3.5).
 *
 * Both halves live in `core/` for the layer's usual reason: they are ordinary
 * text functions, so a test can check the prompt's guarantees and the cleaning
 * rules without a host, a language model, or a token budget. The host calls them
 * around {@link HostPorts.generateText}; no component sees either.
 *
 * Two decisions are worth stating, because they are what the diff budget and the
 * cleaning step exist for:
 *
 * - **The diff is cut, and the cut is announced.** §8.3 caps what one generation
 *   may cost; a staged diff of a vendored directory can be megabytes. Cutting
 *   silently would let the model describe half a change as if it were all of it,
 *   so the answer carries `truncated` and the panel says so.
 * - **The answer is cleaned, not trusted.** Models wrap messages in code fences,
 *   prefix them with "Commit message:", and answer in prose despite being asked
 *   not to. None of that belongs in a commit, and the panel would rather fix the
 *   common shapes than show the user a fence to delete by hand.
 *
 * @module dsh-git-panel/core/commit-message
 */

/** How much of the staged diff one generation may carry, in UTF-16 code units. */
export const MAX_PROMPT_DIFF_CHARS = 12_000

/** Longest subject the prompt asks for; longer ones are cut by git's own tools. */
const SUBJECT_TARGET = 72

/**
 * Cut a diff to the prompt budget.
 *
 * The cut lands on a line boundary when there is one, so the model does not see
 * a half-written line and treat it as content. The returned flag is the whole
 * point: it travels to the panel, which tells the user the message was written
 * from part of the change.
 * @param diff - The full staged diff.
 * @param limit - Budget in code units; defaults to {@link MAX_PROMPT_DIFF_CHARS}.
 * @returns The text to send, and whether anything was dropped.
 */
export function truncateDiff(
  diff: string,
  limit: number = MAX_PROMPT_DIFF_CHARS,
): { readonly text: string; readonly truncated: boolean } {
  if (diff.length <= limit) return { text: diff, truncated: false }
  const cut = diff.slice(0, limit)
  const lastNewline = cut.lastIndexOf('\n')
  return { text: lastNewline > 0 ? cut.slice(0, lastNewline) : cut, truncated: true }
}

/**
 * Build the one-shot prompt for a commit message.
 *
 * The language comes from the panel's own locale rather than from the diff,
 * because the message is read by the person looking at the panel.
 * @param diff - The staged diff, already truncated.
 * @param locale - BCP-47 tag, e.g. `zh-CN` or `en`.
 * @param truncated - Whether {@link truncateDiff} dropped anything, which the
 *   prompt states so the model does not claim to have seen the whole change.
 * @returns The user-message text.
 */
export function buildCommitMessagePrompt(
  diff: string,
  locale: string,
  truncated: boolean,
): string {
  const language = locale.toLowerCase().startsWith('zh') ? 'Simplified Chinese' : 'English'
  const lines = [
    'Write a git commit message for the staged changes below.',
    '',
    'Rules:',
    `- Conventional Commits style: a type (feat, fix, docs, refactor, test, chore, perf, build, ci), an optional scope, then a summary.`,
    `- The first line is at most ${SUBJECT_TARGET} characters, imperative mood, no trailing period.`,
    '- Add a short body only when the subject cannot carry the reason for the change.',
    `- Write in ${language}.`,
    '- Answer with the commit message only: no explanation, no quotes, no code fences.',
  ]
  if (truncated) {
    lines.push(
      '- The diff was truncated before you saw it. Describe only what is visible.',
    )
  }
  lines.push('', 'Staged diff:', '```diff', diff, '```')
  return lines.join('\n')
}

/**
 * Turn a model's answer into the text a commit box should hold.
 *
 * Handles the three shapes models produce anyway — a fenced block, a
 * `Commit message:` label, and a quoted one-liner — and otherwise returns the
 * answer trimmed as sent. It never invents content: an answer that cleans to
 * nothing comes back empty, and the caller reports that rather than filling the
 * box with a placeholder.
 * @param raw - The model's output.
 * @returns The message to put in the box.
 */
export function cleanCommitMessage(raw: string): string {
  let text = raw.trim()

  // A fenced block: keep what is inside the first fence.
  const fenced = /^```[a-zA-Z-]*\n([\s\S]*?)\n?```\s*$/u.exec(text)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()

  // A label on the first line, with or without a colon.
  text = text.replace(/^(commit message|message|提交信息|提交消息)\s*[:：]\s*/iu, '').trim()

  // Quotes around the whole answer, which is a summary and not a body.
  if (
    text.length > 1 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”')))
  ) {
    text = text.slice(1, -1).trim()
  }

  return text
}
