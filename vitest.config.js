// Vitest config — usa jsdom só pros poucos testes que precisam de localStorage.
// A maioria roda em node puro.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    globals: false,
  },
});
