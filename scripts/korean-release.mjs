import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Build-time distribution numbering only. The installed application's updater is unchanged.
const VERSION_FILES = ['package.json', 'package-lock.json', 'extension/manifest.json', 'src/main/version.ts'];
const UPSTREAM = 'https://github.com/totec448-spec/chat-on-steroids';
function parts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected a three-number release version');
  const values = version.split('.').map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value > 65535)) throw new Error('Version exceeds browser component bounds');
  return values;
}
export function nextDistributionVersion(current, upstream) {
  const next = parts(current), official = parts(upstream);
  if (++next[2] > 65535) throw new Error('Distribution patch exhausted; choose the next minor version explicitly');
  const difference = official.findIndex((value, index) => value !== next[index]);
  return (difference >= 0 && official[difference] > next[difference] ? official : next).join('.');
}
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
function succeeds(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || ![0, 1].includes(result.status)) throw result.error ?? new Error(result.stderr || 'Git inspection failed');
  return result.status === 0;
}
function replaceVersion(file, text, version) {
  if (file === 'src/main/version.ts') {
    const pattern = /export const APP_VERSION = '([^']+)';/g;
    if ([...text.matchAll(pattern)].length !== 1) throw new Error('Unknown APP_VERSION declaration');
    return text.replace(pattern, `export const APP_VERSION = '${version}';`);
  }
  const json = JSON.parse(text);
  parts(json.version);
  json.version = version;
  if (file === 'package-lock.json') {
    if (!json.packages?.['']) throw new Error('Missing lockfile root package');
    parts(json.packages[''].version);
    json.packages[''].version = version;
  }
  return JSON.stringify(json, null, 2) + '\n';
}
/** Neutralize only owned version fields; merge every other byte/JSON field normally. */
export function mergeVersionConflict(file, base, ours, theirs, version) {
  if (!VERSION_FILES.includes(file)) throw new Error(`Not a version metadata file: ${file}`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-version-merge-'));
  try {
    for (const [name, text] of Object.entries({ base, ours, theirs })) {
      fs.writeFileSync(path.join(directory, name), replaceVersion(file, text, '0.0.0'));
    }
    const result = spawnSync('git', ['merge-file', '-p', 'ours', 'base', 'theirs'], { cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Non-version conflict in ${file}; manual review required`);
    return replaceVersion(file, result.stdout, version);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function readVersion(cwd, ref) { return JSON.parse(git(cwd, ['show', `${ref}:package.json`])).version; }

export function prepareKoreanRelease(cwd, upstreamRef, upstreamTag) {
  if (!/^v\d+\.\d+\.\d+$/.test(upstreamTag)) throw new Error('Invalid upstream release tag');
  if (git(cwd, ['status', '--porcelain']).trim()) throw new Error('Release preparation requires a clean checkout');
  const commit = git(cwd, ['rev-parse', '--verify', `${upstreamRef}^{commit}`]).trim();
  const upstreamVersion = readVersion(cwd, commit);
  if (`v${upstreamVersion}` !== upstreamTag) throw new Error('Upstream tag and package version disagree');
  parts(upstreamVersion);
  if (succeeds(cwd, ['merge-base', '--is-ancestor', commit, 'HEAD'])) return { changed: false, upstreamTag, upstreamCommit: commit };
  const current = readVersion(cwd, 'HEAD');
  const version = nextDistributionVersion(current, upstreamVersion), releaseTag = `v${version}`;
  if (succeeds(cwd, ['show-ref', '--verify', '--quiet', `refs/tags/${releaseTag}`])) throw new Error(`Release tag ${releaseTag} already exists`);
  // Existing distribution history is immutable. Only the incoming official tag's
  // exact add/add note may keep ours: its complete upstream text is embedded below.
  const notesFile = `docs/release-notes/${releaseTag}.md`;
  if (fs.existsSync(path.join(cwd, notesFile))) throw new Error(`Release notes ${releaseTag} already exist`);
  const merge = spawnSync('git', ['merge', '--no-commit', '--no-ff', commit], { cwd, encoding: 'utf8' });
  if (merge.error) throw merge.error;
  const conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).trim().split('\n').filter(Boolean);
  if (merge.status !== 0 && !conflicts.length) throw new Error(merge.stderr || 'Upstream merge failed');
  const upstreamNotesFile = `docs/release-notes/${upstreamTag}.md`;
  const stages = git(cwd, ['ls-files', '--unmerged', '--', upstreamNotesFile]).split('\n').filter(Boolean);
  const addAddNotes = stages.length === 2 && stages.every(line => /^100644 [a-f0-9]+ [23]\t/.test(line)) &&
    stages.some(line => / 2\t/.test(line)) && stages.some(line => / 3\t/.test(line));
  if (conflicts.some(file => !VERSION_FILES.includes(file) && !(file === upstreamNotesFile && addAddNotes))) throw new Error(`Manual merge required: ${conflicts.join(', ')}`);
  for (const file of conflicts) {
    if (file === upstreamNotesFile && addAddNotes) {
      fs.writeFileSync(path.join(cwd, file), git(cwd, ['show', `HEAD:${file}`]));
      git(cwd, ['add', '--', file]);
      continue;
    }
    const [base, ours, theirs] = [1, 2, 3].map(stage => git(cwd, ['show', `:${stage}:${file}`]));
    fs.writeFileSync(path.join(cwd, file), mergeVersionConflict(file, base, ours, theirs, version));
    git(cwd, ['add', '--', file]);
  }
  for (const file of VERSION_FILES) {
    const target = path.join(cwd, file);
    fs.writeFileSync(target, replaceVersion(file, fs.readFileSync(target, 'utf8'), version));
  }
  // Preserve upstream notices verbatim beneath the distribution provenance. The native
  // publish gate still validates every artifact name, unsigned notice and checksum.
  const officialNotes = git(cwd, ['show', `${commit}:docs/release-notes/${upstreamTag}.md`]);
  if (fs.existsSync(path.join(cwd, notesFile)) && version !== upstreamVersion) throw new Error(`Merged tree already owns ${notesFile}; manual review required`);
  const provenance = `공식 [${upstreamTag}](${UPSTREAM}/releases/tag/${upstreamTag}) 기반 · 기준 커밋 [${commit}](${UPSTREAM}/commit/${commit})`;
  fs.writeFileSync(path.join(cwd, notesFile), `## ${version}\n\n한국어 · OpenCodex 배포판입니다. ${provenance}\n\n기존 한국어 UI·OpenCodex 프리셋과 로컬 공통 수정사항을 유지하고 공식 변경을 병합했습니다. 배포 번호는 공식 버전과 별도로 증가합니다. 개인 설정·키·세션은 배포하지 않습니다.\n\n### 기반 공식판의 변경 및 배포 고지\n\n${officialNotes}`);
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  if (!/^# Changelog\r?\n/.test(changelog)) throw new Error('Missing changelog title');
  // Distribution notes are before upstream's preamble, not at its Unreleased insertion point.
  fs.writeFileSync(changelogPath, changelog.replace(/^# Changelog\r?\n/, `# Changelog\n\n## [${version}] — 한국어 · OpenCodex\n\n${provenance}\n\n공식 변경을 병합하고 한국어 UI·OpenCodex 프리셋·공통 수정사항을 유지했습니다. [배포 노트](${notesFile})\n`));
  const readmePath = path.join(cwd, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const baseline = /^> \*\*한국어 · OpenCodex 배포판(?: \d+\.\d+\.\d+)?\*\*[^\r\n]*공식 v\d+\.\d+\.\d+[^\r\n]*$/m;
  if (!baseline.test(readme)) throw new Error('Missing Korean README upstream baseline');
  fs.writeFileSync(readmePath, readme.replace(baseline, `> **한국어 · OpenCodex 배포판 ${version}** — 공식 ${upstreamTag} (${commit}) 기반입니다.`));
  git(cwd, ['add', '--', ...VERSION_FILES, notesFile, 'CHANGELOG.md', 'README.md']);
  return { changed: true, version, releaseTag, upstreamTag, upstreamCommit: commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , ref, tag] = process.argv;
  const result = prepareKoreanRelease(process.cwd(), ref, tag);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `changed=${result.changed}\n${result.changed ? `release_tag=${result.releaseTag}\nupstream_tag=${result.upstreamTag}\n` : ''}`);
  console.log(JSON.stringify(result));
}
