import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['server/providers/eot20.real.test.ts'], testTimeout: 180_000, hookTimeout: 180_000 },
});
