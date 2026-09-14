import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(cwd, file), 'utf8');
}
function write(file, text) {
  fs.writeFileSync(path.join(cwd, file), text);
}
function replaceExactlyOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`v2.1.11 compatibility repair could not find ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`v2.1.11 compatibility repair found multiple ${label} matches`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}
function replaceRangeExactlyOnce(text, startMarker, endMarker, replacement, label, requiredNeedles = []) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`v2.1.11 compatibility repair could not locate ${label}`);
  if (text.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(`v2.1.11 compatibility repair found multiple ${label} starts`);
  const old = text.slice(start, end);
  for (const needle of requiredNeedles) if (!old.includes(needle)) throw new Error(`v2.1.11 compatibility repair fingerprint mismatch in ${label}: ${needle}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

let chat = read('src/renderer/chat.ts');
const chatReplacement = fs.readFileSync(new URL('./v2.1.11-chat.tsfrag', import.meta.url), 'utf8');
chat = replaceRangeExactlyOnce(chat,
  'function paintDeliveryControls(): void {',
  'function paintPreparedPlan(): void {',
  chatReplacement,
  'renderer planning block',
  ['let planGeneration = 0;', 'preparedPlan', 'planRequestId']);
write('src/renderer/chat.ts', chat);

let main = read('src/renderer/main.ts');
main = replaceExactlyOnce(main,
  ": (status.publicUrl ?? status.localUrl ?? config.tunnel.kind);",
  ": (status.publicUrl ?? status.localUrl ?? config.tunnel.kind));",
  'header subtitle closing parenthesis');
main = replaceExactlyOnce(main,
  "      : `연결 확인 ${ago(status.handshakeAt)}`\n    : '';",
  "      : `연결 확인 ${ago(status.handshakeAt)}`\n    : '');",
  'live-note closing parenthesis');
const apiKeyReplacement = String.raw`$('apiKey').addEventListener('blur', () => {
  const input = $<HTMLInputElement>('apiKey');
  const submitted = input.value;
  if (submitted === '') return;
  const owner = state?.config.tunnel.profileId;
  setupKeySave = (async () => {
    const next = await run(api.setApiKey(submitted, owner));
    if (next) {
      // Do not erase a newer value typed while safeStorage/IPC was still resolving the previous
      // blur. On failure keep the submitted value too, so the user can retry instead of losing it.
      if (state?.config.tunnel.profileId === owner) {
        if (input.value === submitted) input.value = '';
        apply(next);
      }
      toast('API 키를 저장했습니다.');
    }
    return next !== null;
  })();
});
`;
main = replaceRangeExactlyOnce(main,
  "$('apiKey').addEventListener('blur', () => {",
  "$('removeApiKey').addEventListener",
  apiKeyReplacement,
  'API-key save block',
  ['setupKeySave = (async () => {', "toast('API 키를 저장했습니다.');"]);
write('src/renderer/main.ts', main);

console.log('Applied exact v2.1.11 Korean/OpenCodex replay compatibility repair.');
