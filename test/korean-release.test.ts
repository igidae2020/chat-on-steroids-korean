import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Build-time JavaScript has no declaration file, like the other packaging scripts.
import { mergeVersionConflict, nextDistributionVersion, prepareKoreanRelease } from '../scripts/korean-release.mjs';

const roots: string[] = [];
afterEach(() => { for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function put(cwd: string, file: string, value: string): void { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), value); }
function versions(cwd: string, version: string): void {
  put(cwd, 'package.json', JSON.stringify({ name: 'test', version, dependencies: { preserved: '1.0.0' } }, null, 2) + '\n');
  put(cwd, 'package-lock.json', JSON.stringify({ name: 'test', version, lockfileVersion: 3, packages: { '': { name: 'test', version }, 'node_modules/preserved': { version: '1.0.0' } } }, null, 2) + '\n');
  put(cwd, 'extension/manifest.json', JSON.stringify({ manifest_version: 3, name: 'test', version }, null, 2) + '\n');
  put(cwd, 'src/main/version.ts', `export const APP_VERSION = '${version}';\nexport const BRIDGE_PROTOCOL = 13;\n`);
}
function fixture(current = '2.0.9', upstream = '2.0.9', conflict?: string, publishedNotes = false) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-release-test-')); roots.push(cwd);
  git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'Release Test'); git(cwd, 'config', 'user.email', 'release-test@example.invalid');
  git(cwd, 'config', 'core.autocrlf', 'false'); git(cwd, 'config', 'commit.gpgsign', 'false');
  versions(cwd, '2.0.8');
  put(cwd, 'README.md', '# Official\n');
  put(cwd, 'CHANGELOG.md', '# Changelog\n\nOfficial preamble\n\n## Unreleased\n\n## [2.0.8]\n\nOriginal history\n');
  put(cwd, 'feature.txt', 'original\n');
  put(cwd, 'docs/release-notes/v2.0.8.md', '## 2.0.8\n\nunsigned unnotarized\n`SHA256SUMS.txt`\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'Official baseline'); const base = git(cwd, 'rev-parse', 'HEAD');
  versions(cwd, current);
  // Use the actual distribution's current first-line shape, not a different invented heading.
  const heading = fs.readFileSync('README.md', 'utf8').split(/\r?\n/).find(line => line.startsWith('> **한국어 · OpenCodex 배포판'))!;
  expect(heading).toBeTruthy();
  put(cwd, 'README.md', heading + '\n\n# Official\n');
  put(cwd, 'local-ui.txt', '한국어 · OpenCodex preserved\n');
  if (publishedNotes) put(cwd, `docs/release-notes/v${current}.md`, `## ${current}\n\nPublished Korean notes — preserve verbatim.\n`);
  if (conflict === 'source') put(cwd, 'feature.txt', 'local code\n');
  if (conflict === 'metadata') { const p = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); p.name = 'local-name'; put(cwd, 'package.json', JSON.stringify(p, null, 2) + '\n'); }
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'Distribution');
  git(cwd, 'checkout', '-b', 'official', base); versions(cwd, upstream);
  put(cwd, 'feature.txt', 'official improvement\n');
  if (conflict === 'metadata') { const p = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); p.name = 'official-name'; put(cwd, 'package.json', JSON.stringify(p, null, 2) + '\n'); }
  put(cwd, `docs/release-notes/v${upstream}.md`, `## ${upstream}\n\nOfficial improvements.\nunsigned unnotarized\n` + '`SHA256SUMS.txt`\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'Official update'); const commit = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', 'main');
  return { cwd, base, commit, tag: `v${upstream}` };
}
it('uses independent numeric distribution versions and preserves three components', () => {
  expect(nextDistributionVersion('2.0.9', '2.0.9')).toBe('2.0.10');
  expect(nextDistributionVersion('2.0.12', '2.0.9')).toBe('2.0.13');
  expect(nextDistributionVersion('2.0.10', '2.1.0')).toBe('2.1.0');
  expect(() => nextDistributionVersion('2.0.9-local', '2.0.10')).toThrow();
});
it('does nothing for an already merged official commit and does not touch metadata', () => {
  const f = fixture(); const before = git(f.cwd, 'status', '--porcelain');
  expect(prepareKoreanRelease(f.cwd, f.base, 'v2.0.8')).toMatchObject({ changed: false });
  expect(git(f.cwd, 'status', '--porcelain')).toBe(before);
  expect(JSON.parse(fs.readFileSync(path.join(f.cwd, 'package.json'), 'utf8')).version).toBe('2.0.9');
});
it.each([['2.0.9', '2.0.9', '2.0.10'], ['2.0.12', '2.0.9', '2.0.13'], ['2.0.10', '2.1.0', '2.1.0']])('prepares %s plus official %s as %s without committing or tagging', (current, official, expected) => {
  const f = fixture(current, official); const head = git(f.cwd, 'rev-parse', 'HEAD');
  expect(prepareKoreanRelease(f.cwd, f.commit, f.tag)).toMatchObject({ changed: true, version: expected, releaseTag: `v${expected}`, upstreamTag: f.tag });
  expect(git(f.cwd, 'rev-parse', 'HEAD')).toBe(head);
  expect(git(f.cwd, 'tag', '--list')).toBe('');
  const read = (file: string) => fs.readFileSync(path.join(f.cwd, file), 'utf8');
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json')), manifest = JSON.parse(read('extension/manifest.json'));
  expect([pkg.version, lock.version, lock.packages[''].version, manifest.version]).toEqual(Array(4).fill(expected));
  expect(read('src/main/version.ts')).toContain(`APP_VERSION = '${expected}'`);
  expect(read('src/main/version.ts')).toContain('BRIDGE_PROTOCOL = 13');
  expect(lock.packages['node_modules/preserved'].version).toBe('1.0.0');
  expect(pkg.dependencies).toEqual({ preserved: '1.0.0' });
  expect(read('local-ui.txt')).toContain('한국어 · OpenCodex preserved'); expect(read('feature.txt')).toBe('official improvement\n');
  expect(read('README.md')).toContain(`배포판 ${expected}** — 공식 ${f.tag} (${f.commit})`);
  expect(read('CHANGELOG.md')).toMatch(new RegExp(`^# Changelog\\n\\n## \\[${expected.replaceAll('.', '\\.')}\\]`));
  expect(read('CHANGELOG.md')).toContain('Original history');
  const notes = read(`docs/release-notes/v${expected}.md`);
  expect(notes).toContain(f.commit); expect(notes).toContain('unsigned unnotarized'); expect(notes).toContain('Official improvements');
  expect(git(f.cwd, 'diff', '--name-only', '--diff-filter=U')).toBe('');
});
it.each(['source', 'metadata'])('refuses non-version %s conflicts rather than choosing a side', conflict => {
  const f = fixture('2.0.10', '2.0.9', conflict); const head = git(f.cwd, 'rev-parse', 'HEAD');
  expect(() => prepareKoreanRelease(f.cwd, f.commit, f.tag)).toThrow(/conflict|Manual merge/);
  expect(git(f.cwd, 'rev-parse', 'HEAD')).toBe(head);
  expect(git(f.cwd, 'tag', '--list')).toBe('');
});
it('rejects unknown metadata and retains non-version changes in a version-only merge', () => {
  const base = JSON.stringify({ version: '2.0.8', title: 'Original', permissions: ['storage'] });
  const ours = JSON.stringify({ version: '2.0.10', title: '한국어', permissions: ['storage'] });
  const theirs = JSON.stringify({ version: '2.0.9', title: 'Original', permissions: ['storage', 'alarms'] });
  const merged = JSON.parse(mergeVersionConflict('extension/manifest.json', base, ours, theirs, '2.0.11'));
  expect(merged).toEqual({ version: '2.0.11', title: '한국어', permissions: ['storage', 'alarms'] });
  expect(() => mergeVersionConflict('feature.txt', base, ours, theirs, '2.0.11')).toThrow('Not a version metadata file');
});
it('refuses existing release tags and dirty source before merging', () => {
  const f = fixture(); git(f.cwd, 'tag', 'v2.0.10');
  expect(() => prepareKoreanRelease(f.cwd, f.commit, f.tag)).toThrow('already exists');
  put(f.cwd, 'feature.txt', 'uncommitted user edit');
  expect(() => prepareKoreanRelease(f.cwd, f.commit, f.tag)).toThrow('clean checkout');
});

it('preserves published distribution notes on the exact upstream add/add collision and carries the full official text forward', () => {
  const f = fixture('2.0.9', '2.0.9', undefined, true);
  const published = fs.readFileSync(path.join(f.cwd, 'docs/release-notes/v2.0.9.md'), 'utf8');
  const incoming = execFileSync('git', ['show', `${f.commit}:docs/release-notes/v2.0.9.md`], { cwd: f.cwd, encoding: 'utf8' });
  prepareKoreanRelease(f.cwd, f.commit, f.tag);
  expect(fs.readFileSync(path.join(f.cwd, 'docs/release-notes/v2.0.9.md'), 'utf8')).toBe(published);
  const next = fs.readFileSync(path.join(f.cwd, 'docs/release-notes/v2.0.10.md'), 'utf8');
  expect(next.endsWith(incoming)).toBe(true);
  expect(next).toContain(f.commit);
});

it('refuses modify/modify release-note conflicts even for the exact upstream tag', () => {
  const f = fixture('2.0.9', '2.0.8');
  put(f.cwd, 'docs/release-notes/v2.0.8.md', 'Changed Korean existing release history\n');
  git(f.cwd, 'add', '.'); git(f.cwd, 'commit', '-m', 'Historical note edit');
  expect(() => prepareKoreanRelease(f.cwd, f.commit, f.tag)).toThrow('Manual merge required');
});
