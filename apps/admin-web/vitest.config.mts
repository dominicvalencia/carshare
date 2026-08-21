import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { baseVitestConfig } from '@carrental/test-config';

export default defineConfig({
  ...baseVitestConfig,
  plugins: [react()],
  test: {
    ...baseVitestConfig.test,
    environment: 'jsdom',
  },
});
