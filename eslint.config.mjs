import eslint from '@eslint/js';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';
import regexp from 'eslint-plugin-regexp';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const lib = 'projects/core/src/lib';

export default tseslint.config(
  {
    ignores: [
      'dist/',
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
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
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
