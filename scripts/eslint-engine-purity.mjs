// Engine purity rules (FR-1.0.5) as a tiny custom ESLint plugin.
//
// Why custom rules next to the core `no-restricted-imports` /
// `no-restricted-globals` (which are also enabled in eslint.config.js):
// the frozen scaffold acceptance test (tests/unit/scaffold/engine-purity.test.ts,
// CC-01.3) asserts on messages whose rule id starts with `2:` (severity-prefixed
// ids). Core rule ids never start with `2:`, so the enforced policy is *also*
// implemented here under the `2:zipscribe/…` namespace — both rule sets fire on
// engine files; the policy itself (framework imports, DOM globals, SDK imports
// outside **/adapters/**) is identical to the core configuration.

const GLOBALS_BANNED = ['document', 'window', 'localStorage']

function importedNames(node) {
  return node.source && typeof node.source.value === 'string' ? node.source.value : null
}

function matches(name, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) return name === pattern.slice(0, -2) || name.startsWith(`${pattern.slice(0, -1)}`)
    if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1))
    return name === pattern
  })
}

export const restrictedImports = {
  meta: {
    type: 'problem',
    messages: {
      framework: "'{{name}}' import is restricted in src/engine — the engine is framework-agnostic (FR-1.0.5).",
      sdk: "'{{name}}' import is restricted in src/engine outside **/adapters/** — SDK glue lives in src/workers or engine adapters (FR-1.0.5).",
    },
    schema: [
      {
        type: 'object',
        properties: {
          framework: { type: 'array', items: { type: 'string' } },
          sdk: { type: 'array', items: { type: 'string' } },
          allowSdkUnder: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] ?? {}
    const framework = options.framework ?? []
    const sdk = options.sdk ?? []
    const allowSdkUnder = options.allowSdkUnder ?? '/adapters/'
    const file = (context.filename ?? context.getFilename() ?? '').split('\\').join('/')
    const sdkAllowed = file.includes(allowSdkUnder)

    function check(node, value) {
      if (typeof value !== 'string') return
      if (matches(value, framework)) context.report({ node, messageId: 'framework', data: { name: value } })
      else if (!sdkAllowed && matches(value, sdk)) context.report({ node, messageId: 'sdk', data: { name: value } })
    }

    return {
      ImportDeclaration: (node) => check(node, importedNames(node)),
      ExportAllDeclaration: (node) => check(node, importedNames(node)),
      ExportNamedDeclaration: (node) => check(node, importedNames(node)),
      // Core `no-restricted-imports` is documented "static imports only"
      // (eslint.org/docs/latest/rules/no-restricted-imports) — dynamic
      // `import('react')` must be caught here or FR-1.0.5 is one `await` away
      // from bypassed. Non-static specifiers (templates, expressions) have no
      // literal to match and are skipped.
      ImportExpression: (node) => check(node, node.source && typeof node.source.value === 'string' ? node.source.value : null),
    }
  },
}

export const restrictedGlobals = {
  meta: {
    type: 'problem',
    messages: {
      global: "Unexpected use of global '{{name}}' in src/engine — DOM globals are not allowed there (FR-1.0.5).",
    },
    schema: [
      {
        type: 'object',
        properties: {
          globals: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const banned = new Set(context.options[0]?.globals ?? GLOBALS_BANNED)
    const GLOBAL_OBJECTS = new Set(['globalThis', 'self'])
    const sourceCode = context.sourceCode
    return {
      Program() {
        const scopes = [sourceCode.getScope(sourceCode.ast)]
        for (let i = 0; i < scopes.length; i++) scopes.push(...scopes[i].childScopes)
        let globalObjectShadowed = false
        for (const scope of scopes) {
          for (const reference of scope.references) {
            const name = reference.identifier.name
            if (GLOBAL_OBJECTS.has(name) && reference.resolved && reference.resolved.defs.length > 0) globalObjectShadowed = true
            if (!banned.has(name)) continue
            if (reference.resolved) continue // local shadow: allowed, same semantics as core no-restricted-globals
            const parent = reference.identifier.parent
            if (parent && parent.type === 'MemberExpression' && parent.property === reference.identifier) continue
            context.report({ node: reference.identifier, messageId: 'global', data: { name } })
          }
        }
        // `no-restricted-globals` only inspects identifier *references*, so
        // `globalThis.window` / `self.document` / `globalThis['window']`
        // property access reaches the DOM globals the engine policy bans.
        // Value-position member access on the (unshadowed) global object is
        // therefore reported too; `obj.window` on a real object stays allowed.
        if (globalObjectShadowed) return
        for (const scope of scopes) {
          for (const reference of scope.references) {
            if (!GLOBAL_OBJECTS.has(reference.identifier.name)) continue
            // Predefined environment globals (globalThis, self) resolve to a
            // variable with zero `defs`; only user code that declares its own
            // `self`/`globalThis` (defs > 0) shadows the real global object.
            if (reference.resolved && reference.resolved.defs.length > 0) continue
            const parent = reference.identifier.parent
            if (!parent || parent.type !== 'MemberExpression' || parent.object !== reference.identifier) continue
            let property = null
            if (!parent.computed && parent.property.type === 'Identifier') property = parent.property.name
            else if (parent.computed && parent.property.type === 'Literal' && typeof parent.property.value === 'string') property = parent.property.value
            if (property && banned.has(property)) {
              context.report({ node: parent.property, messageId: 'global', data: { name: property } })
            }
          }
        }
      },
    }
  },
}

export const purityPlugin = {
  rules: {
    'restricted-imports': restrictedImports,
    'restricted-globals': restrictedGlobals,
  },
}
