// Keyboard allowlist (FR-105.5, conventions § UI conventions) as a custom
// ESLint plugin, mirroring scripts/eslint-engine-purity.mjs.
//
// Policy: keyboard handling is exclusively command-registry dispatch
// (`ui/commands/useCommands.ts` registers the window keydown owner). JSX
// `onKeyDown` attributes are therefore forbidden in src/** except inside the
// conventions allowlist — `src/ui/commands/**`, `src/ui/**/editable/**`, and
// `src/ui/editable/TimecodeInput.tsx` (Enter/Esc/Shift+Enter/IME handling in
// text-editing components). The frozen scan
// (tests/unit/commands/keyboard-allowlist-scan.test.ts, CC-105.5/reviewer
// ALWAYS-check 11) pins the plugin/rule/messageId names, the RuleTester
// fixtures, and this allowlist's matching semantics.

const ALLOW_EXACT = new Set(['src/ui/editable/TimecodeInput.tsx'])

/** Same semantics as the frozen scan's isAllowlisted: repository-relative
 *  posix path, exact TimecodeInput, ui/commands/ prefix, or an `editable/`
 *  path segment under src/ui/. Absolute RuleTester filenames are reduced to
 *  the repo-relative form at the first `/src/` segment. */
function isAllowlisted(posixPath) {
  const marker = posixPath.indexOf('/src/')
  const relative = marker === -1 ? posixPath : posixPath.slice(marker + 1)
  if (ALLOW_EXACT.has(relative)) return true
  if (relative.startsWith('src/ui/commands/')) return true
  return /(^|\/)editable\//.test(relative) && relative.startsWith('src/ui/')
}

export const noKeydownOutsideAllowlist = {
  meta: {
    type: 'problem',
    messages: {
      outsideAllowlist:
        "JSX 'onKeyDown' is restricted outside ui/commands/**, ui/**/editable/** and ui/editable/TimecodeInput.tsx — keyboard handling goes exclusively through the command registry bindings (conventions § UI conventions, FR-105.5).",
    },
    schema: [],
  },
  create(context) {
    const file = (context.filename ?? context.getFilename?.() ?? '').split('\\').join('/')
    if (isAllowlisted(file)) return {}
    return {
      JSXAttribute: (node) => {
        if (node.name?.name !== 'onKeyDown') return
        context.report({ node, messageId: 'outsideAllowlist' })
      },
    }
  },
}

export const plugin = {
  meta: { name: '@zipscribe/keyboard' },
  rules: {
    'no-keydown-outside-allowlist': noKeydownOutsideAllowlist,
  },
}
