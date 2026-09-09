/**
 * Status UI, and the one place that answers "where did the stream stop?".
 *
 * Everything this browser observes has to survive three hand-offs before the desktop app
 * has it: this extension reads it off the page, the service worker delivers it, and the
 * app records it into a session for this chat. All three used to fail the same way from
 * here — nothing happens — so "Reaching the app" opens onto those three stages stated
 * separately, and names the one that did not complete.
 *
 * It opens itself when something is wrong and stays shut when nothing is, because a panel
 * that is always expanded is a panel nobody reads.
 */

const $ = (id) => document.getElementById(id);
const RENDER_STREAM_KEY = 'renderStreamEnabled';
const SHOW_TIMES_KEY = 'showStreamTimes';
const POLL_MS = 1500;

let overwriteEnabled = true;
let showTimes = false;
let latest = { status: null, tab: null };
let openedOnFailure = false;

// ------------------------------------------------------------------ formatting

/** Ids are long and only their ends identify them, so keep both ends rather than one. */
function shorten(value, keep = 6) {
  const text = String(value || '');
  if (text.length <= keep + 5) return text;
  return `${text.slice(0, keep)}…${text.slice(-4)}`;
}

function ago(at) {
  if (!at) return '';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}분`;
  return `${Math.round(seconds / 3600)}시간`;
}

/** One capture row: ok, no, wait or off, plus whatever it wants to say on the right. */
function row(name, state, meta) {
  $(`r-${name}`).className = `row ${state}`;
  const value = $(`d-${name}`);
  value.textContent = meta === null || meta === undefined ? '' : meta;
}

function idRow(name, state, meta, full) {
  row(name, state, meta);
  const value = $(`d-${name}`);
  value.title = full || '';
  value.disabled = !full;
}

function stage(name, state, meta) {
  $(`s-${name}`).className = `stage ${state}`;
  $(`n-${name}`).textContent = meta || '';
}

// -------------------------------------------------------------------- pipeline

/** How the app describes what it placed a call on, in its own words. */
const ATTRIBUTION = {
  request_id: '정확한 요청 ID',
  unattributed: '요청 ID 미확인',
  agent: '에이전트 키',
  turn: '페이지의 도구 블록',
  generation: '응답 중인 유일한 대화',
  inferred: '대화 미확인'
};

/**
 * The three stages, from evidence each layer produced independently.
 *
 * Deliberately not one flag set by whoever ran last: "picked up" is the page's own count,
 * "sent to app" is the service worker's delivery log, and "app processed" is the app
 * naming a session for this chat on the feed the page polls. A stage is only green when
 * the layer that owns it said so.
 */
function pipeline(info, ready) {
  const page = info && info.page;
  const sent = info && info.delivery;
  const pending = info ? info.pending : 0;
  const read = page ? page.events : 0;

  if (!info || !info.isChat) return { read: ['off'], sent: ['off'], proc: ['off'], why: ['', ''] };
  if (!info.recorder) {
    return { read: ['failed'], sent: ['off'], proc: ['off'], why: ['bad', '이 탭에 기록기가 없습니다. 페이지를 새로고침하세요.'] };
  }
  if (read === 0) {
    return { read: ['running'], sent: ['off'], proc: ['off'], why: ['', '첫 메시지를 기다리는 중입니다.'] };
  }

  const readStage = ['done', String(read)];
  if (!ready) {
    return {
      read: readStage,
      sent: ['failed', pending ? `${pending}개 보관 중` : ''],
      proc: ['off'],
      why: ['bad', '앱 연결과 프로토콜 호환성이 확인될 때까지 전달이 차단됩니다.']
    };
  }
  if (sent && sent.ok === false) {
    return {
      read: readStage,
      sent: ['failed', String(sent.error || '실패')],
      proc: ['off'],
      why: ['bad', `앱이 마지막 전달을 거부했습니다 (${sent.error || '실패'}).`]
    };
  }
  // Refused by the extension itself, before anything could be queued for the app. `pending`
  // counts only what the service worker already owns, so a document it is rejecting outright
  // reported nothing pending and this drawer went on to say "Delivered" — which is what it
  // said all through the 2026-08-21 blackout while the tab was reading ChatGPT perfectly and
  // sending none of it. The page is the only layer that knows, so it is the layer that says so.
  if (page.blocked) {
    return {
      read: readStage,
      sent: ['failed', page.queued ? `${page.queued}개 페이지에 보관 중` : String(page.blocked)],
      proc: ['off'],
      why: [
        'bad',
        '확장이 이 탭의 기록 수집을 거부했습니다 (' +
          String(page.blocked) +
          '). ChatGPT 탭을 새로고침하세요.'
      ]
    };
  }
  if (pending > 0) {
    return {
      read: readStage,
      sent: ['running', `${pending}개 대기 중`],
      proc: ['off'],
      why: ['', '대기열에 보관 중입니다. 앱 전달을 다시 시도합니다.']
    };
  }

  if (!page.session) {
    return {
      read: readStage,
      sent: ['running'],
      proc: ['running'],
      // The worker's delivery counters cover every tab. Only the page's session
      // receipt proves that this particular chat reached the app.
      why: ['', '앱에 연결할 수 있습니다. 이 대화의 세션 수신 확인을 기다립니다.']
    };
  }
  const sentStage = ['done', sent && sent.total ? String(sent.total) : ''];

  const calls = Array.isArray(page.trace) ? page.trace : [];
  const placed = calls.filter((call) => call.app === 'request_id').length;
  const missed = calls.filter((call) => call.app && call.app !== 'request_id');
  if (missed.length > 0) {
    return {
      read: readStage,
      sent: sentStage,
      proc: ['failed', `${placed}/${calls.length}`],
      why: [
        'bad',
        `앱이 요청 ID로 ${missed.length === 1 ? '호출 1개' : `호출 ${missed.length}개`}의 대화를 확인하지 못했습니다. 대신 ${ATTRIBUTION[missed[0].app] || missed[0].app} 상태로 기록했습니다.`
      ]
    };
  }
  return {
    read: readStage,
    sent: sentStage,
    proc: ['done', calls.length ? `${placed}/${calls.length}` : ''],
    why: ['', calls.length ? '모든 도구 호출의 대화 귀속을 확인했습니다.' : '앱에 기록 중입니다.']
  };
}

/** One row per request id: three dots, the tool, the id. Newest first. */
function paintCalls(page) {
  const box = $('calls');
  box.textContent = '';
  const rows = page && Array.isArray(page.trace) ? page.trace.slice(0, 5) : [];
  for (const entry of rows) {
    const line = document.createElement('div');
    line.className = 'call';
    const pips = document.createElement('span');
    pips.className = 'pips';
    for (const state of [
      entry.read ? 'on' : '',
      entry.sent ? 'on' : '',
      entry.app ? (entry.app === 'request_id' ? 'on' : 'bad') : ''
    ]) {
      const pip = document.createElement('span');
      pip.className = `pip ${state}`;
      pips.append(pip);
    }
    const tool = document.createElement('span');
    tool.className = 'tool';
    tool.textContent = entry.tool || '도구 호출';
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = shorten(entry.requestId, 5);
    line.title = `${entry.requestId} — 수집 ${entry.read ? '완료' : '미완료'} · 전달 ${entry.sent ? '완료' : '미완료'} · 앱 ${ATTRIBUTION[entry.app] || '기록 없음'}`;
    line.append(pips, tool, id);
    box.append(line);
  }
}

// ------------------------------------------------------------------- rendering

function paintHeader(status) {
  const connected = status && status.connected === true;
  const paired = status && status.paired === true;
  const incompatible = connected && status.compatible === false;
  // Disconnected on purpose. This has to say so plainly rather than describing it as a
  // connection that has not finished yet, which is what it looked like back when the next
  // poll would silently undo it.
  const off = status && status.disconnected === true && !paired;
  const ready = connected && paired && status.compatible === true;

  $('pill').className = `pill ${ready ? '' : incompatible ? 'bad' : 'off'}`;
  $('state').textContent = incompatible
    ? '버전 불일치'
    : off
      ? '연결 해제됨'
      : !connected
        ? '앱에 연결할 수 없음'
        : ready
          // Health + pairing prove reachability, not the recorder/command flow.
          ? `앱 접근 가능 · 포트 ${status.port}`
          : `포트 ${status.port} · 연결 중`;

  $('retryBtn').hidden = ready || incompatible;
  $('retryBtn').textContent = off ? '연결' : '다시 시도';
  $('unpairBtn').hidden = !paired || incompatible;
  return ready;
}

function paintAlert(status, info) {
  const page = info && info.page;
  const incompatible = status && status.connected === true && status.compatible === false;
  const pairError = status && status.pairError;
  const error = page && page.lastError;
  const text = incompatible
    ? `앱 v${status.appVersion || '?'} (프로토콜 ${status.appProtocol ?? '?'}), 확장 v${status.extensionVersion || '?'} (프로토콜 ${status.extensionProtocol ?? '?'}). 브라우저 확장 관리에서 개발자 모드를 켜고 확장을 업데이트 또는 새로고침하세요. 계속 불일치하면 COS의 확장 폴더 열기로 확인한 폴더를 로드하세요. 진행 중인 작업이 끝난 뒤 ChatGPT 탭을 새로고침하세요.`
    : pairError && pairError.message
      ? pairError.message
      : pairError && pairError.error === 'secure_storage_unavailable'
        ? '보안 저장소를 사용할 수 없습니다. Chat On Steroids 앱에서 상태를 확인하세요.'
    : error && Date.now() - error.at < 10 * 60 * 1000
      ? error.text
      : '';
  $('alert').textContent = text;
  $('alert').hidden = !text;
}

function detail(list, term, value, bad) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  if (bad) dd.className = 'bad';
  dd.title = dd.textContent;
  list.append(dt, dd);
}

/**
 * Only what changes the reading of the three stages.
 *
 * An earlier draft of this drawer listed twenty-eight fields, which is a different thing
 * from being informative: nothing in it told you which layer had stopped.
 */
function paintDetails(status, info) {
  if (!$('more').open) return;
  const grid = $('grid');
  grid.textContent = '';
  const page = info && info.page;
  const sent = info && info.delivery;

  detail(grid, '앱', status ? `v${status.appVersion || '?'} · 포트 ${status.port || '—'}` : null);
  detail(
    grid,
    '확장',
    status ? `v${status.extensionVersion} · 프로토콜 ${status.extensionProtocol}` : null,
    status && status.compatible === false
  );
  detail(grid, '대화 ID', (info && info.conversationId) || null);
  detail(grid, '앱 세션', (page && page.session) || null, Boolean(page && !page.session));
  detail(grid, '탭', info ? `${info.tab} · 탐색 세대 ${info.epoch ?? '—'}` : null);
  detail(
    grid,
    '귀속',
    info ? (info.terminal ? '종료됨' : info.bound ? '연결됨' : '미연결') : null,
    Boolean(info && info.terminal)
  );
  detail(grid, '기록기', page ? `fiber v${page.recorderVersion} · 실행 ${page.runId}` : '미연결', !page);
  detail(grid, '응답', page ? (page.generating ? `${shorten(page.turnId, 8)} · 진행 중` : '대기') : null);
  detail(grid, '수집', page ? `이벤트 ${page.events}개 · 호출 ${page.calls}개` : null);
  detail(
    grid,
    '이 브라우저',
    info ? `${info.pending}개 보관 · 총 ${info.pendingAll}개` : null,
    Boolean(info && info.pendingAll)
  );
  detail(
    grid,
    '마지막 전달',
    sent && sent.at ? `${sent.ok ? '성공' : sent.error || '실패'} · ${sent.events} · ${ago(sent.at)} 전` : null,
    Boolean(sent && sent.ok === false)
  );
  detail(grid, '전달 완료', sent ? sent.total : null);
  detail(grid, '페이지 전송', page ? `${page.sends} · ${page.failures}회 실패` : null, Boolean(page && page.failures));
}

async function refresh() {
  const [status, info] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'status' }),
    chrome.runtime.sendMessage({ type: 'tabStatus' }).catch(() => null)
  ]);
  latest = { status, tab: info };

  const ready = paintHeader(status);
  const isChat = Boolean(info && info.isChat);
  const page = info && info.page;

  row('tab', isChat ? 'ok' : 'off', isChat ? '' : '열린 탭 없음');
  row('rec', !isChat ? 'off' : info.recorder ? 'ok' : 'no', !isChat ? '' : info.recorder ? (page.generating ? '응답 중' : '') : '새로고침 필요');

  const chatId = info && info.conversationId;
  idRow('chat', !isChat ? 'off' : chatId ? 'ok' : 'wait', !isChat ? '' : chatId ? shorten(chatId, 8) : '새 대화', chatId);

  const requestId = page && page.requestId;
  idRow('req', !isChat ? 'off' : requestId ? 'ok' : 'wait', !isChat ? '' : requestId ? shorten(requestId, 9) : '아직 없음', requestId);

  const state = pipeline(info, ready);
  stage('read', ...state.read);
  stage('sent', ...state.sent);
  stage('proc', ...state.proc);
  $('why').textContent = state.why[1];
  $('why').className = `why ${state.why[0]}`;
  paintCalls(page);

  const broken = state.why[0] === 'bad';
  const flowing = state.proc[0] === 'done';
  row(
    'app',
    !isChat ? 'off' : broken ? 'no' : flowing ? 'ok' : 'wait',
    !isChat ? '' : broken ? '차단됨' : flowing ? ago(info.delivery && info.delivery.at) || '진행 중' : '대기 중'
  );
  // Opens itself the first time something is actually wrong, so the panel that explains
  // the failure is already open when the popup is opened to look at one.
  if (broken && !openedOnFailure) {
    openedOnFailure = true;
    $('stream').open = true;
  }

  paintAlert(status, info);
  paintDetails(status, info);
}

// -------------------------------------------------------------------- controls

function syncOverwrite() {
  $('overwriteToggle').checked = overwriteEnabled;
}

async function loadPreferences() {
  const stored = await chrome.storage.local.get([RENDER_STREAM_KEY, SHOW_TIMES_KEY]);
  overwriteEnabled = stored[RENDER_STREAM_KEY] !== false;
  showTimes = stored[SHOW_TIMES_KEY] === true;
  syncOverwrite();
  $('timeToggle').checked = showTimes;
}

/** Puts one value on the clipboard and says so in place, without moving anything. */
async function copyInto(button, text) {
  if (!text) return;
  const was = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '복사됨';
  } catch {
    button.textContent = '복사 실패';
  }
  setTimeout(() => {
    if (button.textContent === '복사됨' || button.textContent === '복사 실패') button.textContent = was;
  }, 900);
}

for (const id of ['d-chat', 'd-req']) {
  $(id).addEventListener('click', (event) => {
    event.preventDefault();
    void copyInto(event.currentTarget, event.currentTarget.title);
  });
}

$('copyBtn').addEventListener('click', (event) => {
  const cells = [...$('grid').children].map((node) => node.textContent);
  const lines = [$('why').textContent];
  for (let index = 0; index < cells.length; index += 2) lines.push(`${cells[index]}: ${cells[index + 1]}`);
  void copyInto(event.currentTarget, lines.join('\n'));
});

$('more').addEventListener('toggle', () => paintDetails(latest.status, latest.tab));

$('reloadBtn').addEventListener('click', () => {
  // The old worker may be stuck: this explicit action belongs to the popup itself.
  chrome.runtime.reload();
});

$('retryBtn').addEventListener('click', async () => {
  $('retryBtn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'pair' });
  $('retryBtn').disabled = false;
  await refresh();
});

$('unpairBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'unpair' });
  await refresh();
});

$('overwriteToggle').addEventListener('change', async () => {
  const previous = overwriteEnabled;
  overwriteEnabled = $('overwriteToggle').checked === true;
  syncOverwrite();
  try {
    await chrome.storage.local.set({ [RENDER_STREAM_KEY]: overwriteEnabled });
    // The toggle is the action. Enabling it immediately pulls the latest app timeline into
    // every known ChatGPT tab; there is deliberately no second "Overwrite now" button.
    if (overwriteEnabled) await chrome.runtime.sendMessage({ type: 'overwriteNow' });
  } catch {
    overwriteEnabled = previous;
    syncOverwrite();
  }
});

$('timeToggle').addEventListener('change', async () => {
  showTimes = $('timeToggle').checked === true;
  await chrome.storage.local.set({ [SHOW_TIMES_KEY]: showTimes });
});

// A popup is open for seconds at a time and the three stages move within those seconds.
void loadPreferences().catch(() => undefined);
void refresh().catch(() => undefined);
setInterval(() => void refresh().catch(() => undefined), POLL_MS);
