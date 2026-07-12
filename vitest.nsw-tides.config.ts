import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['server/providers/bomNswTide.real.test.ts'],testTimeout:120_000,hookTimeout:120_000}});
