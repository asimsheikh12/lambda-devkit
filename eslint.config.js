import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['dist/**', 'tests/fixtures/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // LocalStack queue URLs in tests intentionally use http://
      'sonarjs/no-clear-text-protocols': 'off',
    },
  },
);
