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
const chatReplacement = String.raw`function paintDeliveryControls(): void {
  paintGoalProgress();
  const working = selectedId !== null && controlledSessionId === selectedId && controlledSelection === selectionGeneration && controlledTurnId !== null;
  const queueAtFinish = selectedId !== null && controlledSessionId === selectedId && controlledSelection === selectionGeneration && controlledQueueAtFinish;
  const canInject = selectedId !== null && controlledSessionId === selectedId && controlledSelection === selectionGeneration && controlledCanInject;
  const canSendDirectly = selectedId !== null && controlledSessionId === selectedId && controlledSelection === selectionGeneration && controlledCanSendDirectly;
  const files = imageDrafts.get(draftKey()) ?? [];
  const nativeFiles = files.some(file => 'id' in file) && !(canInject && injectableAttachments(files));
  $('queueAtFinish').hidden = !queueAtFinish || nativeFiles;
  ui($('afterTurnLabel'), 'textContent', () => queueAtFinish && !nativeFiles ? '종료 시점에 예약' : '현재 턴이 끝난 뒤');
  const generate = $<HTMLButtonElement>('generateFinishGoal');
  const queued = [...startingInputs.values(), ...pendingComposerInputs].some(entry =>
    (entry.sessionId ?? entry.deliveredSessionId) === selectedId && ['queued', 'browser', 'tool'].includes(entry.state));
  generate.hidden = !working || !controlledFinishWaiting || queued || controlledStopPending || !!finishGoalDraftView;
  generate.disabled = generate.dataset.busy === `${selectedId}:${controlledTurnId}`;
  const sendOption = $<HTMLSelectElement>('sendMode').querySelector('option[value="auto"]');
  const immediateLabel = () => nativeFiles && working ? '현재 턴이 끝난 뒤' : canSendDirectly ? '바로 보내기' : canInject ? '지금 전달' : '보내기';
  if (sendOption) ui(sendOption, 'textContent', immediateLabel);
  ui($('immediateDeliveryLabel'), 'textContent', immediateLabel);
  const immediateAction = $('sendOptions').querySelector<HTMLElement>('[data-delivery="auto"]');
  if (immediateAction) immediateAction.hidden = nativeFiles && working;
  if (!canInject && !canSendDirectly && !queueAtFinish) $<HTMLSelectElement>('sendMode').value = 'auto';
  const pending = pendingComposerInput();
  const stop = (working || !!pending) && !currentPreparedPlan() && !$<HTMLTextAreaElement>('chatInput').value.trim() && !(imageDrafts.get(draftKey())?.length);
  // Hover selects delivery for the next message. Clicking the empty-composer
  // Stop still acts immediately; there is no second Stop action in the menu.
  $('sendOptions').hidden = !canInject && !canSendDirectly && !queueAtFinish;
  const send = $<HTMLButtonElement>('chatSend');
  const planMode = taskPlans.has(draftKey()), preparedPlan = currentPreparedPlan();
  send.disabled = !!preparedPlan && (preparedPlan.sending || preparedPlan.stages.some(stage => !stage.trim()));
  send.dataset.action = stop ? 'stop' : 'send';
  ui(send, 'aria-label', () => stop ? (controlledStopPending ? '중지 요청됨' : '응답 중지') : '메시지 보내기');
  if (stop && !working && pending) ui(send, 'aria-label', () => '전달 취소');
  const planAction = selectedId ? 'Session 종료 시 계획 예약' : '전체 계획 시작';
  if (preparedPlan && !stop) send.setAttribute('aria-label', planAction);
  else if (planMode && !stop) ui(send, 'aria-label', () => '계획 생성');
  send.classList.toggle('is-plan-ready', !!preparedPlan && !stop);
  ui(send, 'title', () => stop && !working && pending ? '전달 취소' : preparedPlan && !stop ? planAction : planMode && !stop ? '클릭하여 계획 생성' : '');
  send.classList.toggle('is-stop', stop);
  for (const button of $('sendOptions').querySelectorAll<HTMLElement>('[data-delivery]')) {
    button.setAttribute('aria-checked', String(button.dataset.delivery === (nativeFiles && working ? 'after-turn' : $<HTMLSelectElement>('sendMode').value)));
  }
}
function dockAction(label: string | (() => string), symbol: string, click: (event: MouseEvent) => void): HTMLButtonElement {
  const button = el('button', 'dock-action') as HTMLButtonElement;
  const description = typeof label === 'function' ? label : () => label;
  button.type = 'button'; ui(button, 'title', description); ui(button, 'aria-label', description);
  button.append(icon(symbol)); button.onclick = click; return button;
}
function paintActiveGoal(): void {
  const row = $('activeGoalRow');
  const mode = $<HTMLSelectElement>('chatAutomation').value;
  row.hidden = !selectedId || mode === 'off';
  if (row.hidden) { row.replaceChildren(); return; }
  const objective = $<HTMLTextAreaElement>('sessionObjective').value.trim();
  const label = el('span', 'queue-label', () => `${mode === 'loop' ? 'Loop' : '목표 진행 중'}${objective ? ' · ' + objective : ''}`);
  label.title = objective;
  row.replaceChildren(icon('i-pulse'), label,
    dockAction(() => '자동 진행 끄기', 'i-power', () => { const select = $<HTMLSelectElement>('chatAutomation'); select.value = 'off'; select.dispatchEvent(new Event('change')); }),
    dockAction(() => '작업 편집', 'i-pencil', event => {
      event.stopPropagation();
      $<HTMLDetailsElement>('composerSettings').open = true;
      $<HTMLTextAreaElement>('sessionObjective').focus();
    }));
}
type TaskPlanDraft = { text: string; requestId: string | null; stages: string[] | null; sending: boolean; progress: TaskProgress | null; error: string | null };
// Planning belongs to its draft key. Completed stages own their captured objective
// independently of composer edits; existing sessions hand them to the durable queue.
const taskPlans = new Map<string, TaskPlanDraft>();
function currentPreparedPlan(): (TaskPlanDraft & { stages: string[] }) | null {
  const plan = taskPlans.get(draftKey());
  return plan?.stages ? plan as TaskPlanDraft & { stages: string[] } : null;
}
function cancelTaskPlan(key = draftKey()): void {
  const plan = taskPlans.get(key);
  taskPlans.delete(key);
  if (plan?.requestId) void api.cancelTaskRequest?.(plan.requestId);
  if (draftKey() === key) paintTaskPlan();
}
function paintTaskPlan(): void {
  const plan = taskPlans.get(draftKey());
  const preview = $('taskPlanPreview'); preview.replaceChildren();
  preview.hidden = !plan || (!plan.requestId && !plan.stages && !plan.error);
  ui($<HTMLTextAreaElement>('chatInput'), 'placeholder', () => plan && !plan.text ? '계획으로 만들 작업을 입력하세요…' : '메시지를 입력하세요…');
  if (plan?.stages) paintPreparedPlan();
  else if (plan?.error) {
    const failure = plan.error;
    const error = el('div', 'muted', () => failure === 'invalid_goal_decision_json' ? '계획 생성 응답을 읽지 못했습니다.' : goalErrorMessage(failure));
    error.title = plan.error;
    preview.append(error, el('div', 'muted', () => '다시 보내서 재시도하거나 계획을 취소하세요.'));
  } else if (plan?.requestId) {
    const progress = plan.progress;
    const label = () => !progress ? '계획 생성 중…' : progress.phase === 'retrying' ? `공급자 응답 대기 · 재시도 ${progress.attempt ?? ''}${progress.retryAt ? ' 예정 ' + new Date(progress.retryAt).toLocaleTimeString() : ''}` : progress.phase === 'cancelled' ? '계획 취소됨' : progress.phase === 'preparing' ? '계획 준비 중…' : progress.phase === 'ready' ? '계획 준비됨' : progress.phase === 'failed' ? '계획 생성 실패' : '계획 작성 중…';
    preview.append(el('span', 'muted', label));
    if (progress?.text || progress?.error) preview.append(el('pre', 'task-progress-text', progress.error ? goalErrorMessage(progress.error) : progress.text));
  }
  paintTaskActions(); paintDeliveryControls();
}
async function createTaskPlan(backend: 'api' | 'chatgpt'): Promise<void> {
  const input = $<HTMLTextAreaElement>('chatInput'), text = input.value.trim();
  const key = draftKey();
  cancelTaskPlan(key);
  const sessionId = selectedId, projectId = selectedId ? sessions.find(row => row.id === selectedId)?.projectId ?? null : selectedProjectId;
  const requestId = text ? crypto.randomUUID() : null;
  const plan: TaskPlanDraft = { text, requestId, stages: null, sending: false, progress: null, error: null };
  taskPlans.set(key, plan); paintTaskPlan();
  if (!requestId) { input.focus(); return; }
  const current = () => taskPlans.get(key) === plan;
  const unsubscribe = api.onTaskProgress?.(progress => {
    if (progress.requestId !== requestId || !current()) return;
    plan.progress = progress;
    if (draftKey() === key) paintTaskPlan();
  });
  try {
    const result = await api.draftTaskPlan(text, backend, requestId);
    if (!current()) return;
    const draft = draftKey() === key ? input.value : inputDrafts.get(key) ?? '';
    if (draft.trim() !== text) { cancelTaskPlan(key); return; }
    if (result.ok) {
      plan.stages = result.data;
      plan.requestId = null;
      inputDrafts.delete(key);
      if (draftKey() === key) input.value = '';
      if (sessionId) await queuePreparedPlan(key, plan as TaskPlanDraft & { stages: string[] }, sessionId, projectId);
    }
    else plan.error = result.error;
  } catch (error) {
    if (current()) plan.error = error instanceof Error ? error.message : String(error);
  } finally {
    unsubscribe?.(); plan.requestId = null;
    if (current() && draftKey() === key) paintTaskPlan();
  }
}
`;
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
