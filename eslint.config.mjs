import mnci from '@mnci/eslint-config'

import slices from './tools/eslint/slice-boundaries.mjs'

export default [
  {
    name:    'local/ignored-docs-and-generated-files',
    ignores: [
      '**/*.md',
      '**/*.mdx',
      '**/*.markdown',
      'documentation/**',
      'tmp/**',
      'playground-output/**',
    ],
  },
  ...mnci({ workspaceRoot: import.meta.dirname }),
  {
    // Vertical feature slices, enforced: role-suffixed kebab-case files, a
    // subfeature reached only through its index.ts, and no two subfeatures
    // importing each other. See .claude/agents/vertical-slice-architect.md.
    name:    'local/vertical-slices',
    files:   ['packages/*/src/**/*.ts'],
    plugins: { slices },
    rules:   {
      'slices/file-role':      'error',
      'slices/no-deep-import': 'error',
      'slices/no-slice-cycle': 'error',
    },
  },
  {
    name:  'local/image-kernels',
    files: ['packages/{ink,align,diff,extract,enhance,merge,image-fix}/src/**/*.ts'],
    rules: {
      // Every pixel loop in this package is a nested loop, and the cheapest way
      // to skip a pixel is `continue`. The rule wants the inner loop extracted
      // into its own function, which for a per-pixel body means a call per
      // pixel - millions per page - in exchange for readability this code does
      // not gain: `for y { for x { if (blank) continue } }` is the idiom, not a
      // control-flow tangle. Scoped to the packages that own pixel kernels.
      'unicorn/no-break-in-nested-loop': 'off',
    },
  },
  {
    name:  'local/compiler-lib-parity',
    files: ['**/*.{ts,mts,cts}'],
    rules: {
      // The rule rewrites `for await` accumulation into Array.fromAsync, which
      // Node 24 has but TypeScript 6 only declares in the `esnext` lib - and a
      // published package should not compile against unfinished proposals. With
      // `lib: es2024` the fixed code fails typecheck, so the fixer and the
      // compiler cannot both be satisfied. Revisit when TypeScript ships
      // Array.fromAsync in a finished ES lib.
      'unicorn/prefer-array-from-async':  'off',
      // Same collision one step on: Iterator#toArray is ES2025, beyond the
      // es2024 lib, so `[...map.values()]` stays until the lib catches up.
      'unicorn/prefer-iterator-to-array': 'off',
    },
  },
  {
    // Vitest writes these beside a config while it resolves it, then deletes
    // them. Linting one is a race, and it is never source.
    name:    'local/vitest-scratch-files',
    ignores: ['**/vitest.config.*.timestamp*'],
  },
  {
    // @scanmate/ocr reads its English model from @tesseract.js-data/eng with
    // require.resolve at run time, which the rule cannot see - so it calls the
    // package unused, and --fix deletes it, leaving every install without
    // language data. The options repeat mnci's, because a rule's options are
    // replaced, not merged.
    name:  'local/ocr-language-data',
    files: ['packages/ocr/package.json'],
    rules: {
      '@nx/dependency-checks': ['error', {
        ignoredDependencies: ['@tesseract.js-data/eng'],
        ignoredFiles:        [
          '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
          '{projectRoot}/rollup.config.{js,ts,mjs,mts,cjs,cts}',
          '{projectRoot}/tsup.config.{js,ts,mjs,mts,cjs,cts}',
          '{projectRoot}/vite.config.{js,ts,mjs,mts,cjs,cts}',
          '{projectRoot}/vitest.config.{js,ts,mjs,mts,cjs,cts}',
          '{projectRoot}/jest.config.{js,ts,mjs,mts,cjs,cts}',
          '{projectRoot}/**/*.spec.{js,ts,jsx,tsx}',
          '{projectRoot}/**/*.test.{js,ts,jsx,tsx}',
        ],
      }],
    },
  },
  {
    ignores: [
      '**/vitest.config.*.timestamp*',
    ],
  },
]
