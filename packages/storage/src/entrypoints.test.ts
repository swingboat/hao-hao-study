import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('@hao/storage entrypoints', () => {
  it('keeps figure crop generation behind its own subpath', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports?: Record<string, string> };
    const rootEntry = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(packageJson.exports).toMatchObject({
      '.': './src/index.ts',
      './figure-crop': './src/figure-crop.ts',
    });
    expect(rootEntry).not.toMatch(/from ['"]\.\/figure-crop['"]/);
  });
});
