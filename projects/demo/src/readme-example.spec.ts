import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Relative to the repository root, where vitest runs.
describe('the README example', () => {
  it('is readme-example.ts, which the demo typecheck and lint cover', () => {
    const source = readFileSync('projects/demo/src/readme-example.ts', 'utf8').trimEnd();
    for (const path of ['README.md', 'projects/core/README.md']) {
      expect(readFileSync(path, 'utf8')).toContain(`\`\`\`ts\n${source}\n\`\`\``);
    }
  });
});
