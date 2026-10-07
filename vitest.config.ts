import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('./src/game/sim', import.meta.url)),
      '@data': fileURLToPath(new URL('./src/game/data', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/game/**/*.test.ts'],
  },
});
