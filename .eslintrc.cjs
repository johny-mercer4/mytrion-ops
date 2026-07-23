/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    es2022: true,
  },
  // apps/mytrion-crm is a separate Vite/React app with its own toolchain — the backend eslint
  // config has no React plugin, so linting its hook files here only produces spurious
  // "react-hooks/exhaustive-deps rule not found" errors. It lints itself.
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.cjs', 'src/db/migrations', 'apps/mytrion-crm'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'no-console': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  overrides: [
    {
      files: ['tests/**/*.ts', 'scripts/**/*.ts', 'metadataScripts/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // LangGraph/LangChain integration glue: the base-class overrides (PagedPostgresSaver) and
      // stream/tool-arg boundaries sit on third-party types that are effectively `any`. Typing
      // them precisely fights @ts-expect-error'd overrides; allow `any` at this boundary only.
      files: ['src/modules/agents/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
