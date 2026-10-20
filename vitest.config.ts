import { defineConfig } from 'vitest/config';

// testTimeout is raised to 30s: the default 5s is too tight for a checkout on a Windows
// filesystem (/mnt/c), where a single core test can exceed it. Our WSL checkout runs in ~1.5s.
export default defineConfig({
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'], testTimeout: 30_000 },
});
