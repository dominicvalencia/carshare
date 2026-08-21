import { defineConfig } from 'eslint/config';
import reactConfig from '@carrental/eslint-config/react';

export default defineConfig(reactConfig, {
  files: ['apps/api/src/**/*.ts'],
  rules: {
    // Nest constructor metadata and decorated DTO parameters require runtime imports.
    '@typescript-eslint/consistent-type-imports': 'off',
  },
});
