import type { AppState } from '../shared/types.js';
import type { SettingsPatch } from '../preload/index.js';
import type { PluginSnapshot, PluginView, PluginCatalogEntry, PluginSource } from '../shared/plugins.js';
import { $, el, run, toast } from './dom.js';

let snapshot: PluginSnapshot = { plugins: [], catalog: [], schemaRevision: 0 };
let epoch = 0;
let appState: AppState | null = null;
let applyAppState: (next: AppState) => void = () => {};
const artwork = import.meta.glob('./plugin-icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
function button(label: string, action: () => void | Promise<void>, primary = false): HTMLButtonElement {
  const node = el('button', `btn${primary ? ' btn-solid' : ''}`, label) as HTMLButtonElement;
  node.type = 'button';
  node.addEventListener('click', async () => {
    node.disabled = true;
    try { await action(); } catch (error) { toast(error instanceof Error ? error.message : '플러그인 작업 실패'); }
    finally { node.disabled = false; }
  });
  return node;
}
function art(id: string): HTMLElement {
  const img = document.createElement('img'); img.className = 'plugin-icon'; img.alt = '';
  img.src = artwork[`./plugin-icons/${id}.svg`] ?? artwork['./plugin-icons/custom.svg']!; return img;
}
function field(parent: HTMLElement, label: string, value = '', secret = false, hint = ''): HTMLInputElement {
  const wrap = el('label', 'plugin-field'); const input = document.createElement('input');
  input.type = secret ? 'password' : 'text'; input.value = value;
  if (secret) { input.autocomplete = 'new-password'; input.spellcheck = false; }
  wrap.append(el('span', '', label), input); if (hint) wrap.append(el('small', 'muted', hint)); parent.append(wrap); return input;
}
function dialog(title: string): { box: HTMLDialogElement; body: HTMLElement } {
  document.querySelector('#pluginDialog')?.remove();
  const box = document.createElement('dialog'); box.id = 'pluginDialog'; box.className = 'plugin-dialog';
  const head = el('div', 'plugin-dialog-head'); const heading = el('h2', '', title); heading.id = 'pluginDialogTitle';
  box.setAttribute('aria-labelledby', heading.id); head.append(heading, button('닫기', () => box.close()));
  const body = el('div', 'plugin-dialog-body'); box.append(head, body);
  box.addEventListener('close', () => box.remove()); document.body.append(box); box.showModal(); return { box, body };
}
async function mutate(work: ReturnType<typeof window.api.pluginsSnapshot>, notify = true): Promise<boolean> {
  const own = ++epoch; const result = await run(work);
  if (!result) return false;
  if (own === epoch) { snapshot = result; renderInstalled(); }
  if (notify) toast('플러그인 설정을 저장했습니다. ChatGPT에서 Chat On Steroids Plugins 연결을 새로고침하여 도구 목록을 갱신하세요.');
  return true;
}
export async function refreshPlugins(): Promise<void> { await mutate(window.api.pluginsSnapshot(), false); }
export function applyPluginsState(next: AppState): void {
  appState = next;
  const surface = next.status.surfaces.find((item) => item.id === 'plugins');
  const status = $('pluginsConnectionStatus');
  const contacted = surface?.state === 'live' && !!surface.lastRequestAt;
  const configured = !!next.config.tunnel.pluginsTunnelId?.trim() || surface?.state === 'live';
  $('pluginsSetupTitle').closest('.plugin-connection')!.classList.toggle('is-configured', configured);
  $('pluginsSetupTitle').textContent = configured ? '플러그인 연결' : '플러그인 첫 사용 전 연결 설정';
  $('pluginsSetupHint').textContent = configured
    ? '활성화한 플러그인은 ChatGPT에서 하나의 연결을 공유합니다. 여기에서 연결을 관리하세요.'
    : '설치한 플러그인을 사용하려면 ChatGPT에 Chat On Steroids Plugins 연결을 한 번 추가하세요.';
  $('pluginsSetupLink').textContent = configured ? '플러그인 연결 설정' : '플러그인 연결 설정';
  $('pluginsSetupLink').classList.toggle('btn-solid', !configured);
  status.textContent = surface?.state === 'live'
    ? contacted ? 'ChatGPT 연결 확인' : '연결 제공 중 · ChatGPT 접속 대기'
    : configured ? '플러그인 연결 오프라인' : '설정 필요 · 플러그인을 연결하세요';
  status.dataset.live = String(surface?.state === 'live');
  status.title = surface?.detail ?? '';
  const setupStatus = document.getElementById('pluginSetupStatus');
  if (setupStatus) setupStatus.textContent = surface?.state === 'live'
    ? `${surface.tools.length} tools available · ${surface.lastRequestAt ? 'ChatGPT 연결 확인' : 'ChatGPT에 추가할 준비됨'}`
    : surface?.state === 'error' ? surface.detail : '아래 연결을 저장하면 활성화된 플러그인을 ChatGPT에서 사용할 수 있습니다.';
}
function showConnection(): void {
  if (!appState) { toast('연결 설정을 불러오는 중입니다.'); return; }
  const { config, hasApiKey, status } = appState;
  const surface = status.surfaces.find(item => item.id === 'plugins');
  const { body } = dialog('플러그인 연결 설정');
  body.append(el('p', '', '한 번 연결하면 활성화된 플러그인이 ChatGPT에서 이 연결을 공유합니다.'));
  const connectionStatus = el('p', 'plugin-setup-status'); connectionStatus.id = 'pluginSetupStatus'; body.append(connectionStatus);
  const copy = (label: string, value: string) => {
    const input = field(body, label, value); input.readOnly = true;
    const row = el('div', 'plugin-setup-copy'); input.replaceWith(row); row.append(input, button('복사', async () => { if (await run(window.api.writeClipboard(value))) toast(`${label} 복사됨`); }));
  };
  let tunnel: HTMLInputElement | null = null;
  let key: HTMLInputElement | null = null;
  if (config.tunnel.kind === 'openai') {
    body.append(button('터널 관리 열기', async () => { await run(window.api.openLink('https://platform.openai.com/settings/organization/tunnels')); }));
    tunnel = field(body, 'Plugins 터널 ID', config.tunnel.pluginsTunnelId ?? '', false, 'ChatGPT에서 사용하는 같은 워크스페이스에 전용 터널을 만드세요.');
    tunnel.id = 'pluginsTunnelId'; tunnel.spellcheck = false; tunnel.autocomplete = 'off';
    if (hasApiKey) body.append(el('p', 'hint', '저장된 터널 API 키를 사용할 수 있습니다.'));
    else key = field(body, '터널 API 키', '', true, 'Tunnels: Read 및 Tunnels: Use만 허용한 제한 키를 사용하세요. 보안 저장소에 저장하고 다른 연결과 공유합니다.');
  }
  // Values needed for ChatGPT setup stay copyable; tool lists belong to each plugin.
  copy('연결 이름', surface?.connectorName ?? 'Chat On Steroids Plugins');
  copy('설명', surface?.description ?? 'Tools from your enabled Chat On Steroids plugins.');
  const url = surface?.publicUrl ?? (config.tunnel.kind === 'manual' ? surface?.localUrl : null);
  if (url) copy('MCP server URL', url);
  body.append(el('p', 'hint', config.tunnel.kind === 'openai'
    ? 'ChatGPT에서 Tunnel 방식으로 연결을 추가하고 Plugins 터널을 선택하세요. 플러그인 추가·변경 후 도구 목록을 새로고침하세요.'
    : 'ChatGPT에서 MCP 서버 URL로 연결을 추가하세요. 플러그인 추가·변경 후 도구 목록을 새로고침하세요.'));
  const actions = el('div', 'plugin-setup-actions');
  actions.append(button('ChatGPT 플러그인 열기', async () => { await run(window.api.openLink('https://chatgpt.com/#settings/Plugins')); }), button('저장 후 연결', async () => {
    if (!appState) return;
    if (tunnel && !tunnel.value.trim()) { tunnel.focus(); throw new Error('Plugins 터널 ID를 입력하세요.'); }
    if (key?.value) { const next = await run(window.api.setApiKey(key.value)); if (!next) return; key.value = ''; applyAppState(next); applyPluginsState(next); }
    if (tunnel) {
      const { capabilities, readOnly, tunnel: previousTunnel, ui, sessions, compaction, multiAgent, goal, mcp } = appState.config;
      const base: SettingsPatch = { capabilities, readOnly, tunnel: previousTunnel, ui, sessions, compaction, multiAgent, goal, mcp };
      const next = await run(window.api.saveSettings({ ...base, tunnel: { ...previousTunnel, pluginsTunnelId: tunnel.value.trim() } }, base));
      if (!next) return; applyAppState(next); applyPluginsState(next);
    }
    const next = await run(window.api.connect());
    if (next) { applyAppState(next); applyPluginsState(next); toast('플러그인 연결을 저장했습니다.'); }
  }, true)); body.append(actions);
  applyPluginsState(appState);
}
function renderInstalled(): void {
  const list = $('pluginsInstalled');
  list.replaceChildren(); $('pluginsCount').textContent = `${snapshot.plugins.length}개 설치됨`;
  const query = $<HTMLInputElement>('pluginsSearch').value.trim().toLowerCase();
  const matches = (name: string, description = '') => `${name} ${description}`.toLowerCase().includes(query);
  if (!snapshot.plugins.length) {
    const empty = el('div', 'plugin-empty'); empty.append(art('custom'), el('h2', '', '필요한 도구를 추가하세요'), el('p', 'muted', '아래에서 플러그인을 추가해 기억·창작 도구·브라우저 자동화를 대화에 연결하세요.'), button('첫 플러그인 추가', showCatalog, true)); list.append(empty);
  }
  for (const plugin of snapshot.plugins) {
    const recipe = snapshot.catalog.find(entry => entry.id === plugin.catalogId);
    const description = recipe?.description ?? (plugin.source.kind === 'remote' ? '연결한 MCP 서버입니다.' : '로컬 MCP 연동입니다.');
    if (!matches(plugin.name, description)) continue;
    const card = el('article', 'plugin-card');
    const open = button('', () => showPlugin(plugin)); open.className = 'plugin-entry';
    const title = el('div', 'plugin-card-title');
    title.append(el('h2', '', plugin.name));
    open.setAttribute('aria-label', `${plugin.name} 열기`);
    const status = plugin.status === 'error' ? '확인 필요' : plugin.status === 'needs-auth' ? '로그인 필요' : plugin.status === 'authenticating' ? '로그인 중…' : plugin.status === 'ready' && plugin.tools.length ? '준비됨' : plugin.status === 'ready' ? '연결됨 · 도구 없음' : plugin.status === 'connecting' ? '연결 중…' : plugin.status === 'disabled' ? '비활성화됨' : '연결 확인';
    const count = plugin.tools.filter(tool => tool.enabled).length;
    const foot = el('div', 'plugin-card-foot');
    foot.append(el('span', `pill${status === '준비됨' ? ' is-live' : plugin.status === 'error' ? ' is-error' : ''}`, status));
    if (plugin.error) foot.append(el('span', 'plugin-card-error', plugin.error));
    foot.append(el('span', 'plugin-tool-count', `도구 ${count}개 활성화됨`));
    title.append(foot); open.append(art(recipe?.icon ?? plugin.catalogId ?? 'custom'), title);
    const menu = document.createElement('details'); menu.className = 'plugin-menu';
    const summary = el('summary', '', '•••'); summary.setAttribute('aria-label', `${plugin.name} 작업`);
    const actions = el('div', 'plugin-menu-actions');
    actions.append(button(plugin.enabled ? '끄기' : '켜기', async () => { await mutate(window.api.pluginsSetEnabled(plugin.id, !plugin.enabled)); }), button('설정', () => showConfigure(plugin)), button('다시 시작', async () => { await mutate(window.api.pluginsRestart(plugin.id)); }), button('업데이트', async () => { await mutate(window.api.pluginsUpdate(plugin.id)); }));
    const uninstall = button('제거', () => showUninstall(plugin)); uninstall.classList.add('plugin-destructive'); actions.append(uninstall);
    menu.append(summary, actions); card.append(open, menu);
    list.append(card);
  }
  if (snapshot.plugins.length && !list.children.length) list.append(el('p', 'plugin-no-results muted', '검색과 일치하는 설치된 플러그인이 없습니다.'));
  renderCatalog($('pluginsExplore'), query);
  const catalog = document.querySelector<HTMLElement>('#pluginDialog [data-plugin-catalog]');
  if (catalog) renderCatalog(catalog);
  // Keep an open detail view on the same plugin after a tool or status change.
  const detail = document.querySelector<HTMLElement>('#pluginDialog [data-plugin-detail]');
  if (detail) { const current = snapshot.plugins.find(plugin => plugin.id === detail.dataset.pluginDetail); if (current) renderPluginTools(detail, current); }
}
/** Installation identity, not enabled state or a user-edited display name, owns catalog membership. */
function availableRecipes(): PluginCatalogEntry[] {
  return snapshot.catalog.filter(recipe => !snapshot.plugins.some(plugin =>
    plugin.catalogId === recipe.id || (plugin.source.kind === recipe.source.kind && (
      ((recipe.source.kind === 'npm' || recipe.source.kind === 'python') && plugin.source.package === recipe.source.package) ||
      (recipe.source.kind === 'remote' && plugin.source.url === recipe.source.url)
    ))
  ));
}
function renderCatalog(parent: HTMLElement, query = ''): void {
  parent.replaceChildren();
  for (const recipe of availableRecipes().filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(query))) {
    const card = button('', () => showRecipe(recipe)); card.className = 'plugin-catalog-card';
    const text = el('span', 'plugin-card-title'); text.append(el('h3', '', recipe.name), el('p', 'muted', recipe.description));
    card.append(art(recipe.icon), text); parent.append(card);
  }
  if (!parent.children.length) parent.append(el('p', 'plugin-no-results muted', query
    ? '검색과 일치하는 추가 가능 플러그인이 없습니다.' : '카탈로그의 플러그인이 모두 설치되어 있습니다. 직접 MCP 서버를 추가할 수도 있습니다.'));
}
function renderPluginTools(parent: HTMLElement, plugin: PluginView): void {
    const published = plugin.tools.filter(tool => tool.published).length;
    const publication = plugin.tools.some(tool => tool.published !== undefined) ? ` · ChatGPT에 ${published}개 제공` : '';
    parent.replaceChildren();
    if (plugin.status === 'needs-auth' || plugin.status === 'authenticating') {
      const auth = el('div', 'plugin-auth');
      auth.append(el('p', '', plugin.status === 'authenticating' ? '브라우저에서 로그인을 완료하세요.' : `${plugin.name}에 로그인하여 계정을 연결하세요.`));
      auth.append(plugin.status === 'authenticating'
        ? button('로그인 취소', async () => { await mutate(window.api.pluginsCancelAuthentication(plugin.id), false); })
        : button('로그인', async () => { await mutate(window.api.pluginsAuthenticate(plugin.id), false); }, true));
      parent.append(auth);
    }
    parent.append(el('h3', '', '도구'), el('p', 'plugin-tools-summary', `${plugin.tools.filter(tool => tool.enabled).length}/${plugin.tools.length}개 활성화${publication} · 이 플러그인만 해당 · 변경 후 ChatGPT에서 새로고침`));
    if (plugin.error) parent.append(el('p', 'plugin-error', plugin.error));
    const tools = el('div', 'plugin-tools');
    for (const tool of plugin.tools) {
      const row = el('label', 'plugin-tool'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = tool.enabled; checkbox.disabled = !plugin.enabled;
      checkbox.addEventListener('change', async () => { checkbox.disabled = true; if (!await mutate(window.api.pluginsSetToolEnabled(plugin.id, tool.name, checkbox.checked))) { checkbox.checked = tool.enabled; checkbox.disabled = !plugin.enabled; } });
      const text = el('span'); text.append(el('b', '', tool.name), el('small', 'muted', tool.description || tool.exposedName));
      if (tool.enabled && tool.published === false) text.append(el('small', 'muted', tool.exposureError ?? 'ChatGPT에 제공되지 않습니다. 플러그인 연결을 확인하세요.'));
      row.append(checkbox, text); tools.append(row);
    }
    parent.append(tools);
}
function showPlugin(plugin: PluginView): void {
  const recipe = snapshot.catalog.find(entry => entry.id === plugin.catalogId);
  const { body } = dialog(plugin.name);
  const hero = el('div', 'plugin-detail-hero');
  const intro = el('div', 'plugin-detail-intro');
  const configure = button('플러그인 설정', () => showConfigure(plugin), true); configure.classList.add('plugin-configure');
  intro.append(el('p', '', recipe?.description ?? '대화에서 사용할 직접 설정한 MCP 서버입니다.'), configure);
  hero.append(art(recipe?.icon ?? plugin.catalogId ?? 'custom'), intro); body.append(hero);
  const tools = el('section', 'plugin-detail-tools'); tools.dataset.pluginDetail = plugin.id; renderPluginTools(tools, plugin); body.append(tools);
  const about = document.createElement('details'); about.className = 'plugin-about'; about.append(el('summary', '', '플러그인 정보'));
  about.append(el('p', 'plugin-source', plugin.source.url ?? plugin.source.package ?? plugin.source.command ?? plugin.source.kind), el('p', 'muted', `${plugin.version || '사용자 지정 버전'} · ${plugin.license || '라이선스 미제공'}`), el('p', '', '설치 후 활성화된 동안 실행되며 앱을 다시 열어도 복원됩니다. 끄거나 제거하면 연결이 중단됩니다. 다시 시작하면 재연결하고 도구를 갱신합니다.'));
  if (plugin.homepage ?? recipe?.homepage) about.append(button('원본 프로젝트 열기', async () => { await run(window.api.openLink((plugin.homepage ?? recipe!.homepage)!)); }));
  body.append(about);
}
function showUninstall(plugin: PluginView): void {
  const { box, body } = dialog(`${plugin.name} 제거할까요?`);
  body.append(el('p', '', '연결을 중단하고 설치 파일·COS가 관리하는 로컬 데이터·저장된 자격 증명을 삭제합니다. 필요한 플러그인 데이터를 먼저 백업하세요. 외부 앱의 데이터는 삭제하지 않습니다.'), button('플러그인 제거', async () => { if (await mutate(window.api.pluginsUninstall(plugin.id))) box.close(); }, true));
}
function showConfigure(plugin: PluginView): void {
  const { box, body } = dialog(`설정 · ${plugin.name}`); const config = new Map<string, HTMLInputElement>(); const secrets = new Map<string, HTMLInputElement>();
  const name = field(body, '표시 이름', plugin.name);
  for (const item of plugin.fields ?? snapshot.catalog.find((entry) => entry.id === plugin.catalogId)?.fields ?? [])
    (item.secret ? secrets : config).set(item.key, field(body, item.label, item.secret ? '' : plugin.config[item.key] ?? '', item.secret, item.secret ? '저장된 자격 증명을 유지하려면 비워 두세요.' : item.placeholder));
  for (const [key, value] of Object.entries(plugin.config)) if (!config.has(key)) config.set(key, field(body, key, value));
  for (const key of plugin.credentialKeys) if (!secrets.has(key)) secrets.set(key, field(body, key, '', true, '저장된 자격 증명을 유지하려면 비워 두세요.'));
  const source = field(body, '서버 설정 (JSON)', JSON.stringify(plugin.source), false, '자격 증명은 명령 인수나 URL 대신 보안 입력란에 입력하세요.');
  const extraConfig = field(body, '추가 설정 (JSON 객체)', '{}', false, '비밀이 아닌 설정·환경 변수만 입력하세요.');
  const extraKey = field(body, '추가 자격 증명 이름 (선택)', '', false, '로컬 서버는 환경 변수, 원격 서버는 헤더 이름입니다.'); const extraValue = field(body, '추가 자격 증명 값', '', true);
  body.append(button('저장 후 다시 연결', async () => {
    const credentials = Object.fromEntries([...secrets].filter(([, input]) => input.value).map(([key, input]) => [key, input.value]));
    if (extraKey.value.trim() && extraValue.value) credentials[extraKey.value.trim()] = extraValue.value;
    const additions: unknown = JSON.parse(extraConfig.value);
    if (!additions || typeof additions !== 'object' || Array.isArray(additions) || !Object.values(additions).every((value) => typeof value === 'string')) throw new Error('추가 설정은 문자열 값으로 구성된 객체여야 합니다.');
    const configuredSource = JSON.parse(source.value) as PluginSource;
    if (await mutate(window.api.pluginsConfigure(plugin.id, { name: name.value,
      ...(JSON.stringify(configuredSource) !== JSON.stringify(plugin.source) ? { source: configuredSource } : {}),
      config: { ...Object.fromEntries([...config].map(([key, input]) => [key, input.value])), ...additions as Record<string,string> }, credentials }))) box.close();
  }, true));
}
function showCatalog(): void {
  const { body } = dialog('플러그인 추가'); body.append(el('p', 'muted', '독립적인 연동이 하나의 연결을 공유합니다. 설치 전에 각 플러그인의 접근 범위·설정을 확인하세요.'));
  const grid = el('div', 'plugin-catalog'); grid.dataset.pluginCatalog = ''; renderCatalog(grid);
  body.append(grid, el('h3', '', '직접 서버 연결')); const custom = el('div', 'plugin-actions');
  custom.append(button('MCPB 번들 가져오기', async () => { const path = await run(window.api.pluginsImportBundle()); if (path) showCustom('mcpb', path); }), button('npm / Python / 실행 파일', () => showCustom('npm')), button('원격 MCP URL', () => showCustom('remote')), button('GitHub 저장소', () => showCustom('github')));
  body.append(custom, el('p', 'hint', '로컬 플러그인은 현재 OS 사용자 권한으로 실행되며 COS 승인 폴더 제한이 적용되지 않습니다. 신뢰하는 코드만 설치하세요.'));
}
function showRecipe(recipe: PluginCatalogEntry): void {
  const { box, body } = dialog(`${recipe.name} 설정`); const header = el('div', 'plugin-card-head'); header.append(art(recipe.icon), el('p', '', recipe.description)); body.append(header);
  const actions = el('div', 'plugin-actions'); body.append(actions);
  if (recipe.tools?.length) {
    const tools = el('ul', 'plugin-tool-preview'); for (const name of recipe.tools) tools.append(el('li', '', name));
    body.append(el('h3', 'plugin-preview-title', '도구 미리보기'), tools);
  }
  const setup = document.createElement('details'); setup.className = 'plugin-about'; setup.append(el('summary', '', '설치 요구사항'));
  const steps = el('ol', 'plugin-steps'); for (const step of recipe.instructions) steps.append(el('li', '', step)); setup.append(steps, button('프로젝트·설치 안내 열기', async () => { await run(window.api.openLink(recipe.homepage)); })); body.append(setup);
  const values = new Map<string, HTMLInputElement>();
  for (const item of recipe.fields) { const input = field(body, item.label, '', item.secret, item.placeholder); input.required = !!item.required; values.set(item.key, input); }
  const remote = recipe.source.kind === 'remote';
  body.append(el('p', 'hint', remote
    ? `${recipe.license}. 공급자에서 계정을 연결하세요. 해당 서비스의 요금제·사용량 한도가 적용됩니다.`
    : `라이선스: ${recipe.license}. 설치 시 타사 코드를 내려받아 현재 OS 사용자로 실행합니다. ‘준비됨’은 연결·도구 조회가 성공했다는 뜻입니다.`));
  actions.append(button(remote ? '연결 추가' : '설치 후 연결', async () => {
    for (const item of recipe.fields) if (item.required && !values.get(item.key)!.value.trim()) { values.get(item.key)!.focus(); throw new Error(`${item.label} 항목이 필요합니다.`); }
    const config: Record<string,string> = {}; const credentials: Record<string,string> = {};
    for (const item of recipe.fields) (item.secret ? credentials : config)[item.key] = values.get(item.key)!.value;
    if (await mutate(window.api.pluginsInstall({ catalogId: recipe.id, config, credentials }))) {
      box.close();
      if (remote) { const installed = snapshot.plugins.find(plugin => plugin.catalogId === recipe.id); if (installed) showPlugin(installed); }
    }
  }, true), button('플러그인 목록으로', showCatalog));
}
function showCustom(kind: PluginSource['kind'], path = ''): void {
  const { box, body } = dialog('직접 MCP 서버 연결'); const name = field(body, '표시 이름', '내 MCP 서버');
  const label = el('label', 'plugin-field'); label.append(el('span', '', '서버 유형')); const select = document.createElement('select');
  for (const [value, text] of [['npm','npm 패키지'],['python','Python 패키지 (uv)'],['command','직접 실행 파일'],['remote','원격 Streamable HTTP'],['github','GitHub 저장소'],['mcpb','MCPB 번들']]) { const option = document.createElement('option'); option.value = value!; option.textContent = text!; select.append(option); }
  select.value = kind; label.append(select); body.append(label);
  const location = field(body, '패키지·실행 파일·URL·번들 경로', path); const version = field(body, '버전 (npm / Python)', '', false, '재현 가능한 설치를 위해 공개된 버전을 지정하세요.');
  const args = field(body, '인수 (JSON 배열)', '[]', false, '예: ["--port", "9876"]. 셸을 거치지 않고 직접 전달합니다.');
  const key = field(body, '자격 증명 이름 (선택)', '', false, '로컬 서버의 환경 변수 또는 Authorization 같은 HTTP 헤더입니다.'); const credential = field(body, '자격 증명 값', '', true);
  body.append(el('p', 'hint', '원격 서버는 MCP Streamable HTTP를 지원해야 합니다. GitHub 링크는 알려진 설치 방법 또는 지원되는 manifest가 필요합니다. 로컬 서버에는 COS 폴더 제한이 적용되지 않습니다.'), button('설치 후 연결', async () => {
    const selected = select.value as PluginSource['kind']; const value = location.value.trim(); if (!value) throw new Error('먼저 서버 위치를 입력하세요.');
    const parsed: unknown = JSON.parse(args.value); if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error('인수는 문자열로 구성된 JSON 배열이어야 합니다.');
    const source: PluginSource = { kind: selected, args: parsed };
    if (selected === 'remote' || selected === 'github') source.url = value; else if (selected === 'mcpb') source.path = value; else if (selected === 'command') source.command = value; else { source.package = value; if (version.value.trim()) source.version = version.value.trim(); }
    if (await mutate(window.api.pluginsInstall({ name: name.value, source, credentials: key.value.trim() && credential.value ? { [key.value.trim()]: credential.value } : {} }))) box.close();
  }, true));
}
export function initPlugins(onState: (next: AppState) => void = () => {}): void {
  applyAppState = onState;
  $('pluginsAdd').addEventListener('click', showCatalog); $('pluginsRefresh').addEventListener('click', () => void refreshPlugins());
  $('pluginsSearch').addEventListener('input', renderInstalled);
  $('pluginsSetupLink').addEventListener('click', showConnection);
  $('pluginsOpenChatGPT').addEventListener('click', async () => { await run(window.api.openLink('https://chatgpt.com/#settings/Plugins')); });
  $('pluginsLegalOpen').addEventListener('click', async () => { await run(window.api.openLegalNotices()); });
  window.api.onPluginsChanged(() => { void refreshPlugins(); }); void refreshPlugins();
}
