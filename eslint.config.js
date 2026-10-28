// ESLint 9 flat config — FR-1.0.5.
// typescript-eslint (type-checked for src) + prettier formatting via
// `.prettierrc` / `pnpm format` (formatting is a separate script so the gate
// `pnpm lint` stays focused on rules).
import tseslint from 'typescript-eslint'
import { purityPlugin } from './scripts/eslint-engine-purity.mjs'

const SDK_PACKAGES = ['@huggingface/transformers', '@huggingface/*', '@ffmpeg/*', 'ffmpeg-static', 'mediabunny', 'onnxruntime-web', 'onnxruntime-common', 'sherpa-onnx', '@xenova/*', '@onnxproto/*']
const FRAMEWORK_PACKAGES = ['react', 'react-dom', 'react-dom/*', 'react/*']

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'public/wasm/**', 'fixtures/**', 'reports/**', 'test-results/**', 'playwright-report/**', '.cache/**', 'logs/**', '.vite/**'],
  },

  // All TypeScript: syntax-level rules (no type information required, so
  // scripts/tests/e2e/configs are covered too).
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Product code: type-checked ruleset (FR-1.0.5).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // FR-1.0.5 engine purity: framework-agnostic, no DOM globals, no SDK
  // imports outside **/adapters/**. (DOM *types* stay allowed — see
  // knowledge/conventions.md § Architecture rules; no-restricted-globals only
  // catches *value* uses, and react is a runtime import rule.)
  {
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/**/adapters/**/*.ts'],
    plugins: { '2:zipscribe': purityPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: FRAMEWORK_PACKAGES, message: 'src/engine is framework-agnostic (FR-1.0.5)' },
            { group: SDK_PACKAGES, message: 'SDK glue lives in src/workers or src/engine/**/adapters (FR-1.0.5)' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'document', 'window', 'localStorage'],
      '2:zipscribe/restricted-imports': ['error', { framework: FRAMEWORK_PACKAGES, sdk: SDK_PACKAGES, allowSdkUnder: '/adapters/' }],
      '2:zipscribe/restricted-globals': ['error', { globals: ['document', 'window', 'localStorage'] }],
    },
  },
  {
    files: ['src/engine/**/adapters/**/*.ts'],
    plugins: { '2:zipscribe': purityPlugin },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: FRAMEWORK_PACKAGES, message: 'src/engine is framework-agnostic (FR-1.0.5)' }] }],
      'no-restricted-globals': ['error', 'document', 'window', 'localStorage'],
      '2:zipscribe/restricted-imports': ['error', { framework: FRAMEWORK_PACKAGES, sdk: [], allowSdkUnder: '/adapters/' }],
      '2:zipscribe/restricted-globals': ['error', { globals: ['document', 'window', 'localStorage'] }],
    },
  },

  // The test tree (tests/**, e2e/**) is authored by the separate test-author
  // role and frozen for unit-01 — it declares documentation constants and
  // helpers that a stricter unused-vars rule would flag. Lint scope is
  // configuration (not a test assertion), so the author-owned files keep
  // their intent and stay lint-clean.
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)
