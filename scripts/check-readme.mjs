// The package READMEs (the ones npm shows) carry copies of the usage sections of the repository
// README. Fails when a copy is missing or differs, so they stay in sync. Runs in CI's lint job.
// Usage: node scripts/check-readme.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Root README sections copied into each package README, matched by the start of the heading. */
export const SYNCED_SECTIONS = {
  'projects/core/README.md': ['Install', 'Example', 'Build', 'v0.1 limits'],
  'projects/cli/README.md': ['Build', 'v0.1 limits'],
};

/** `## ` sections as [heading, trimmed body] pairs, in order. */
function sectionsOf(markdown) {
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      current = { heading: line.slice(3).trim(), lines: [] };
      sections.push(current);
    } else if (!inFence && line.startsWith('# ')) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ heading, lines }) => [heading, lines.join('\n').trim()]);
}

export function checkReadme(root, copy, path, prefixes) {
  const problems = [];
  const rootSections = sectionsOf(root);
  const copies = new Map(sectionsOf(copy));
  for (const prefix of prefixes) {
    const found = rootSections.find(([heading]) => heading.startsWith(prefix));
    if (!found) {
      problems.push(`README.md has no section starting "## ${prefix}"`);
      continue;
    }
    const [heading, body] = found;
    const text = copies.get(heading);
    if (text === undefined) {
      problems.push(`${path} has no "## ${heading}" section`);
    } else if (text !== body) {
      problems.push(`${path} "## ${heading}" differs from README.md`);
    }
  }
  return problems;
}

/** The count in docs/parity.md ("18/20 scenarios") must be the one the README badge and sentence show. */
export function checkParityBadge(readme, parity) {
  const report = /\*\*(\d+)\/(\d+) scenarios identical/.exec(parity);
  if (!report) return ['docs/parity.md has no scenario count'];
  const expected = `${report[1]}/${report[2]}`;
  const problems = [];
  const badge = /badge\/parity%20with%20Ink%20[\d.]+-(\d+)%2F(\d+)%20scenarios/.exec(readme);
  if (!badge) problems.push('README.md has no parity badge');
  else if (`${badge[1]}/${badge[2]}` !== expected) {
    problems.push(
      `README.md: the parity badge says ${badge[1]}/${badge[2]}, docs/parity.md says ${expected}`,
    );
  }
  const sentence = /\*\*(\d+) of (\d+) scenarios give the same screen/.exec(readme);
  if (!sentence) problems.push('README.md has no parity sentence');
  else if (`${sentence[1]}/${sentence[2]}` !== expected) {
    problems.push(
      `README.md: the parity sentence says ${sentence[1]} of ${sentence[2]}, docs/parity.md says ${expected}`,
    );
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = readFileSync('README.md', 'utf8');
  const problems = [
    ...Object.entries(SYNCED_SECTIONS).flatMap(([path, prefixes]) =>
      checkReadme(root, readFileSync(path, 'utf8'), path, prefixes),
    ),
    ...checkParityBadge(root, readFileSync('docs/parity.md', 'utf8')),
  ];
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(
    `${Object.keys(SYNCED_SECTIONS).join(', ')}: usage sections match README.md, parity count matches docs/parity.md`,
  );
}
