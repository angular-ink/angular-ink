import eslint from '@eslint/js';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import regexp from 'eslint-plugin-regexp';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const lib = 'projects/core/src/lib';

// Ink and React are for comparing with, in parity/, and must reach nothing that ships.
const noInk = {
  group: ['ink', 'ink/*', 'react', 'react/*'],
  message: 'Ink and React are used only by the parity tests in parity/.',
};

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.stryker-tmp/',
      'reports/',
      'coverage/',
      '.angular/',
      'out-tsc/',
      'node_modules/',
      '.superpowers/',
      'docs/superpowers/',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      ...angular.configs.tsRecommended,
      regexp.configs['flat/recommended'],
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts', 'vitest.stryker.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'ink', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'ink', style: 'kebab-case' },
      ],
      'regexp/no-super-linear-backtracking': 'error',
      // Angular components and directives are often decorated empty classes.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // The demo apps are user code: an `ink-*` host would be a layout node, and only the library's are.
    files: ['projects/demo/src/**/*.ts'],
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'demo', style: 'kebab-case' },
      ],
    },
  },
  {
    // ɵINJECTOR_SCOPE is the one private Angular symbol the project uses, read in one file only.
    files: [`${lib}/**/*.ts`],
    ignores: [`${lib}/platform/angular-private.ts`, `${lib}/**/*.spec.ts`],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportSpecifier[imported.name=/^ɵ/]',
          message: 'Private Angular symbols are read only in platform/angular-private.ts.',
        },
      ],
    },
  },
  {
    // The parity apps are user code too, one equivalent of each app written for Ink.
    files: ['parity/ng-apps/**/*.ts'],
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'parity', style: 'kebab-case' },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    ignores: ['parity/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noInk] }] },
  },
  {
    // @angular/common is not a peer dependency: the published libraries must not import it.
    files: ['projects/core/src/**/*.ts', 'projects/testing/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/common', '@angular/common/*'],
              message: 'The libraries peer on @angular/core only.',
            },
            noInk,
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [eslint.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      // Specs poke at internals and use non-null assertions on fixtures.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
