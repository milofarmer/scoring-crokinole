// Lint policy: correctness rules only, style is left to the reader.
// House standard: no `any`, no type assertions (`as const` excepted) — both are
// errors, so `npm run check` fails on a violation.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  { ignores: ['node_modules/**', 'data/**', 'dist/**', 'release/**'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'electron/**/*.ts', 'tools/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-undef': 'off', // tsc owns undefined-identifier checking in TS files
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // House standard.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-shadow': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Browser pages are classic scripts sharing one scope, loaded by the HTML.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': 'off', // top-level functions are used from the HTML
      'no-empty': ['error', { allowEmptyCatch: true }], // localStorage guards
      'no-shadow': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
    },
  },
];
