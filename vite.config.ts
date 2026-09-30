import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` so the built site works from any static host or sub-folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
  },
});
