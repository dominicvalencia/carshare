/** @type {import('vitest/config').UserConfig} */
export const baseVitestConfig = {
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    passWithNoTests: false,
    restoreMocks: true,
  },
};
