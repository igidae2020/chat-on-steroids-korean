import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Build-time JavaScript has no declaration file.
import { prepareKoreanRelease } from '../scripts/korean-release.mjs';

const roots: string[] = [];
afterEach(() => { for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function put(cwd: string, file: string, value: string): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), value);
}
function versions(cwd: string, version: string): void {
  put(cwd, 'package.json', JSON.stringify({ name: 'test', version }, null, 2) + '\n');
  put(cwd, 'package-lock.json', JSON.stringify({ name: 'test', version, lockfileVersion: 3, packages: { '': { name: 'test', version } } }, null, 2) + '\n');
  put(cwd, 'extension/manifest.json', JSON.stringify({ manifest_version: 3, name: 'test', version }, null, 2) + '\n');
  put(cwd, 'src/main/version.ts', `export const APP_VERSION = '${version}';\nexport const BRIDGE_PROTOCOL = 13;\n`);
}

it('repairs only the known v2.1.11 broken renderer fingerprints', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-v211-compat-')); roots.push(cwd);
  put(cwd, 'src/renderer/chat.ts', [
    'function paintDeliveryControls(): void {',
    '  const preparedPlan = null;',
    '}',
    'let planGeneration = 0;',
    'let planRequestId: string | null = null;',
    'function paintPreparedPlan(): void {',
    '}',
    '',
  ].join('\n'));
  put(cwd, 'src/renderer/main.ts', [
    ": (status.publicUrl ?? status.localUrl ?? config.tunnel.kind);",
    "      : `연결 확인 ${ago(status.handshakeAt)}`",
    "    : '';",
    "$('apiKey').addEventListener('blur', () => {",
    "  setupKeySave = (async () => {",
    "    toast('API 키를 저장했습니다.');",
    "  }",
    "});",
    "$('removeApiKey').addEventListener('click', async () => {});",
    '',
  ].join('\n'));

  const script = path.resolve('scripts/upstream-compat/v2.1.11.mjs');
  execFileSync(process.execPath, [script], { cwd, stdio: 'pipe' });
  const chat = fs.readFileSync(path.join(cwd, 'src/renderer/chat.ts'), 'utf8');
  const main = fs.readFileSync(path.join(cwd, 'src/renderer/main.ts'), 'utf8');
  expect(chat).toContain('const taskPlans = new Map<string, TaskPlanDraft>();');
  expect(chat).toContain('await queuePreparedPlan(key, plan as TaskPlanDraft & { stages: string[] }, sessionId, projectId)');
  expect(chat).not.toContain('let planGeneration = 0;');
  expect(main).toContain(': (status.publicUrl ?? status.localUrl ?? config.tunnel.kind));');
  expect(main).toContain("    : '');");
  expect(main).toContain('state?.config.tunnel.profileId === owner');
  expect(main).toContain('return next !== null;');
  expect(() => execFileSync(process.execPath, [script], { cwd, stdio: 'pipe' })).toThrow();
});

it('runs an exact-tag compatibility repair inside replay before materializing the release tree', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-tag-compat-')); roots.push(cwd);
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.name', 'Compatibility Test');
  git(cwd, 'config', 'user.email', 'compat@example.invalid');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  versions(cwd, '2.0.8');
  put(cwd, 'README.md', '> **한국어 · OpenCodex 배포판 2.0.8** — 공식 v2.0.8 기반입니다.\n');
  put(cwd, 'CHANGELOG.md', '# Changelog\n\n## [2.0.8]\n\nBaseline\n');
  put(cwd, 'docs/release-notes/v2.0.8.md', '## 2.0.8\n\nBaseline release.\n');
  put(cwd, 'official-only.txt', 'baseline\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'Baseline');
  const base = git(cwd, 'rev-parse', 'HEAD');

  versions(cwd, '2.0.9');
  put(cwd, 'local-ui.txt', '한국어 유지\n');
  put(cwd, 'scripts/upstream-compat/v2.0.9.mjs', "import fs from 'node:fs';\nfs.writeFileSync('official-only.txt', 'compat adjusted\\n');\n");
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'Distribution plus compatibility repair');
  const head = git(cwd, 'rev-parse', 'HEAD');

  git(cwd, 'checkout', '-b', 'official', base);
  versions(cwd, '2.0.9');
  put(cwd, 'official-only.txt', 'new official value\n');
  put(cwd, 'docs/release-notes/v2.0.9.md', '## 2.0.9\n\nOfficial improvements.\n');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'Official 2.0.9');
  const official = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', 'main');

  const result = prepareKoreanRelease(cwd, official, 'v2.0.9');
  expect(result).toMatchObject({
    changed: true,
    version: '2.0.10',
    compatibilityFix: 'scripts/upstream-compat/v2.0.9.mjs',
  });
  expect(result.replayedCommits).toBeGreaterThan(0);
  expect(git(cwd, 'rev-parse', 'HEAD')).toBe(head);
  expect(git(cwd, 'diff', '--name-only', '--diff-filter=U')).toBe('');
  expect(fs.readFileSync(path.join(cwd, 'official-only.txt'), 'utf8').trim()).toBe('compat adjusted');
  expect(fs.readFileSync(path.join(cwd, 'local-ui.txt'), 'utf8')).toContain('한국어 유지');
});
