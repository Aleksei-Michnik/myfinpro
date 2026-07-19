/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.integration.spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  testTimeout: 60_000, // Testcontainers need time to start
  maxWorkers: 1, // Run integration tests serially
  setupFilesAfterEnv: ['./test/integration/setup.ts'],
};
