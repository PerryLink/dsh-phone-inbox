/**
 * The system-prompt contract for this plugin.
 *
 * Wording rules this text follows, learned from the host's own tool sections:
 *
 * - It states the **capability and its precondition**, not the tool's JSON
 *   schema (the schema is already in the tool list).
 * - It names the two mistakes worth preventing: re-deriving the path by hand
 *   from the conversation text, and handing a host path to a workspace-confined
 *   consumer.
 * - It stays short and it never claims the inbox is non-empty.
 * @module dsh-phone-inbox/prompt
 */

/** The registered section name and order. */
export const SYSTEM_PROMPT_SECTION = Object.freeze({
  /** Section name; unique within the system prompt. */
  name: 'phone-inbox',
  /**
   * Order. Tool guidance sections cluster at 300 in the host's own tables;
   * this sits just after them so it reads as cross-tool guidance rather than
   * as one tool's usage note.
   */
  order: 320,
})

/**
 * The section text. A function rather than a constant because the host
 * interpolates section text and because a future deployment-specific variant
 * (a different bridge name) must be able to change it without touching the
 * registration site.
 * @returns the system-prompt section text.
 */
export function systemPromptText(): string {
  return [
    'Attachments the user sends from their phone arrive through the WeChat bridge, which saves them outside the session workspace and records the absolute path in the message text.',
    'Use inbox_list to get that list for this session instead of reconstructing a path from the conversation. Use inbox_adopt to copy one into the workspace before calling a tool that refuses paths outside it (for example dsh-data-quality, which rejects them with `path-escape`) — pass the returned workspace-relative path to that tool.',
    'The bridge replaces every non-ASCII character in the on-disk name with `_`, so inbox_list reports the sender\'s original name separately rather than pretending the on-disk name is readable.',
  ].join(' ')
}
