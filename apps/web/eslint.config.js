const nextjsConfig = require('@myfinpro/eslint-config/nextjs');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...nextjsConfig,
  {
    ignores: ['.next/**', 'coverage/**', 'e2e/**', 'node_modules/**'],
  },
];
