const baseConfig = require('./base');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // NestJS-specific rules
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow console in NestJS (uses Logger instead — enforced by code review)
      'no-console': 'off',
    },
  },
];
