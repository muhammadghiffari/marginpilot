import { expect, test } from 'vitest';

test('core entry point can be loaded by workspace consumers', async () => {
  await expect(import('@marginpilot/core')).resolves.toBeDefined();
});
