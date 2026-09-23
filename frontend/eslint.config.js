// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import designSystem from './eslint-rules/design-system.js';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules', 'public']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Design-system guard rails (CLAUDE.md §6.2) for all app code.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'design-system': designSystem },
    rules: {
      'design-system/no-shadow-classes': 'error',
      'design-system/no-heavy-font-weight': 'error',
      'design-system/no-raw-hex-colors': 'error',
    },
  },

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },

  prettier,
]);
