export default {
  testEnvironment: 'jsdom',
  testMatch: ['**/test/**/*.test.ts', '**/src/**/__tests__/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  transform: {},
  extensionsToTreatAsEsm: ['.ts'],
  globals: {},
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
};
