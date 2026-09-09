import { $, el, run } from './dom.js';
import { DEFAULT_USAGE_FORMULA, usageEstimate, usageModelGroups, usageRate, type UsageFormula, type UsageOverview } from '../shared/usage.js';
let snapshot: UsageOverview | null = null;
let loadGeneration = 0;
const FORMULA_KEY = 'usage-formula-v1';
let formula: UsageFormula = { ...DEFAULT_USAGE_FORMULA, rates: { ...DEFAULT_USAGE_FORMULA.rates } };
function saveFormula(): void {
  try { localStorage.setItem(FORMULA_KEY, JSON.stringify(formula)); } catch { /* Read-only storage still permits an in-memory comparison. */ }
}

const count = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const featureLabels: Record<string, string> = { deep_research: '심층 리서치', file_upload: '파일 업로드', paste_text_to_file: '붙여넣은 텍스트 파일', image_gen: '이미지 생성' };
function usageHint(node: HTMLElement, text: string): void {
  node.dataset.usageHint = text;
  node.setAttribute('tabindex', '0');
  const hide = () => document.getElementById('usageTooltip')?.remove();
  const show = () => {
    hide();
    const tip = el('div', 'session-tooltip', node.dataset.usageHint ?? ''); tip.id = 'usageTooltip'; tip.setAttribute('role', 'tooltip');
    const bounds = node.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 290))}px`;
    tip.style.top = `${Math.max(8, bounds.top - 64)}px`;
    document.body.append(tip);
  };
  node.addEventListener('pointerenter', show); node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show); node.addEventListener('blur', hide);
  node.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}
function dateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export async function refreshUsage(): Promise<void> {
  document.getElementById('usageTooltip')?.remove();
  const generation = ++loadGeneration;
  $('refreshUsage').setAttribute('disabled', '');
  const status = $('usageStatus');
  status.textContent = snapshot ? '갱신 중…' : '기록된 도구 사용량 계산 중…';
  status.setAttribute('role', 'status');
  try {
    const [value, catalog] = await Promise.all([run(window.api.getUsage()), run(window.api.getChatModels())]);
    if (generation !== loadGeneration) return;
    if (!value) { status.textContent = '사용량을 불러오지 못했습니다. 새로고침하세요.'; return; }
    snapshot = value;
    const summary = $('usageSummary'); summary.replaceChildren();
    for (const [label, number] of [['처리 토큰 · 추정', value.tokens], ['일일 최대 토큰', Math.max(0, ...value.days.map((day) => day.tokens))], ['대화 수', value.sessions], ['활동 일수', value.days.filter((day) => day.tokens > 0).length]] as const) {
      const item = el('div'); item.dataset.usageMetric = label; usageHint(item, `${Math.round(number).toLocaleString()} ${label.toLowerCase()}`); item.append(el('strong', '', count.format(number)), el('span', '', label)); summary.append(item);
    }
    const limits = $('modelUsage'); limits.replaceChildren();
    const modelRows = value.limits.filter((row) => row.scope === 'model');
    const knownModels = catalog?.models ?? [];
    for (const model of knownModels.filter((item) => !modelRows.some((row) => row.model === item.id))) {
      const row = el('div', 'usage-limit'); row.append(el('strong', '', model.label), el('span', 'muted', 'ChatGPT에서 보고되지 않음')); limits.append(row);
    }
    for (const entry of [...modelRows, ...value.limits.filter((row) => row.scope !== 'model')]) {
      const stale = Date.now() - entry.observedAt > 10 * 60000 || (entry.resetAt !== null && entry.resetAt <= Date.now());
      const row = el('div', 'usage-limit');
      const displayName = entry.scope === 'feature' ? featureLabels[entry.model] ?? entry.model : entry.model;
      const name = el('div'); name.append(el('strong', '', displayName));
      if (entry.scope !== 'model') name.append(el('small', 'muted', entry.scope === 'shared' ? '공유 사용량 한도' : '기능별 한도'));
      const detail = el('div');
      detail.append(el('b', '', stale ? '새로고침 필요' : entry.remaining !== null ? `${entry.remaining.toLocaleString()} 남음` : entry.remainingPercent !== null ? `${Math.round(entry.remainingPercent)}% 남음` : '보고되지 않음'));
      const window = entry.windowSeconds === 604800 ? '주간 · ' : entry.windowSeconds ? `${Math.round(entry.windowSeconds / 3600)}시간 구간 · ` : '';
      detail.append(el('small', 'muted', window + (entry.resetAt ? `초기화 ${new Date(entry.resetAt).toLocaleString()}` : '초기화 시각 미보고')));
      if (entry.remainingPercent !== null && !stale) { const progress = document.createElement('progress'); progress.max = 100; progress.value = entry.remainingPercent; progress.setAttribute('aria-label', `${displayName}: ${entry.remainingPercent}% 남음`); detail.append(progress); }
      row.append(name, detail); limits.append(row);
    }
    if (!modelRows.length) limits.append(el('p', 'muted', 'ChatGPT에서 모델별 남은 메시지 수를 보고하지 않았습니다. 공유 사용량·기능별 한도를 모델별 잔량으로 해석할 수 없습니다.'));
    const totalCost = el('div'); totalCost.append(el('strong', '', '—'), el('span', '', '환산 비용 추정 · USD')); totalCost.id = 'usageTotalCost'; usageHint(totalCost, ''); summary.prepend(totalCost);
    paintRates();
    paintCost();
    status.textContent = '기록된 모델 정보를 사용하며 누락된 기록은 GPT-5.6 High로 가정합니다. 바뀌지 않은 기록은 저장된 합계를 재사용합니다.';
  } finally { if (generation === loadGeneration) $('refreshUsage').removeAttribute('disabled'); }
}
function paintRates(): void {
  if (!snapshot) return;
  const host = $('usageRates'); host.replaceChildren();
  for (const model of [...new Set(snapshot.models.map(row => row.model))].sort()) {
    const label = el('label', 'setting'); const text = el('span', 'setting-text');
    text.append(el('b', '', model), el('em', '', usageRate(model, DEFAULT_USAGE_FORMULA) !== undefined ? '캐시 입력 100만 토큰당 USD · 편집 가능한 공식 기준 단가(2026-09-07 확인)' : '캐시 입력 100만 토큰당 USD · 확인한 비교 단가를 입력하세요'));
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '0.01'; input.placeholder = '단가 미확인'; input.value = usageRate(model, formula)?.toString() ?? '';
    input.setAttribute('aria-label', `${model} 캐시 입력 100만 토큰당 USD`);
    input.addEventListener('input', () => {
      if (input.value === '') formula.rates[model] = null;
      else if (input.validity.valid && Number.isFinite(input.valueAsNumber)) formula.rates[model] = input.valueAsNumber;
      else return;
      saveFormula(); paintCost();
    });
    label.append(text, input); host.append(label);
  }
}
function paintCost(): void {
  if (!snapshot) return;
  const total = usageEstimate(snapshot.models, formula);
  const costText = (estimate: ReturnType<typeof usageEstimate>) => estimate.unpricedTokens > 0 ? `${money.format(estimate.cost)} + 미산정` : money.format(estimate.cost);
  const costSummary = document.getElementById('usageTotalCost');
  if (costSummary) {
    costSummary.querySelector('strong')!.textContent = costText(total);
    costSummary.dataset.usageHint = `추정 토큰 ${Math.round(total.tokens).toLocaleString()}개 중 ${Math.round(total.unpricedTokens).toLocaleString()}개는 비교 단가가 없습니다. 캐시 입력 환산치이며 청구액이 아닙니다.`;
  }
  const daily = snapshot.days.map(day => ({ ...day, ...usageEstimate(day.models, formula) }));
  for (const [label, number] of [['처리 토큰 · 추정', total.tokens], ['일일 최대 토큰', Math.max(0, ...daily.map(day => day.tokens))]] as const) {
    const item = [...$('usageSummary').children].find(node => (node as HTMLElement).dataset.usageMetric === label) as HTMLElement | undefined;
    if (item) { item.querySelector('strong')!.textContent = count.format(number); item.dataset.usageHint = `${Math.round(number).toLocaleString()} ${label.toLowerCase()}`; }
  }
  const heat = $('usageHeatmap'); heat.replaceChildren();
  const byDay = new Map(daily.map(day => [day.date, day.tokens])); const peak = Math.max(1, ...daily.map(day => day.tokens));
  for (let ago = 363; ago >= 0; ago--) {
    const date = new Date(); date.setDate(date.getDate() - ago); const key = dateKey(date), tokens = byDay.get(key) ?? 0;
    const cell = el('span', 'heat-cell'); cell.dataset.level = String(tokens ? Math.max(1, Math.ceil(tokens / peak * 4)) : 0); const hint = `${key}: 추정 토큰 ${Math.round(tokens).toLocaleString()}개`; usageHint(cell, hint); cell.setAttribute('aria-label', hint); heat.append(cell);
  }
  $('usageFormula').textContent = `최종 대화 맥락 × 고유 도구 호출 수 ÷ ${formula.divisor} × 모델별 캐시 입력 단가 ÷ 100만 × ${formula.multiplier}.`;
  $('usageCost').textContent = `${costText(total)} 환산 비용 추정. ${total.unpricedTokens ? `${Math.round(total.unpricedTokens).toLocaleString()}토큰은 단가가 없습니다. ` : ''}비교용 추정치이며 청구액이 아닙니다.`;
  const modelTable = el('table', 'usage-table'); const modelHead = el('tr');
  for (const title of ['기록된 모델·추론 강도', '추정 토큰', '환산 비용 추정']) modelHead.append(el('th', '', title));
  modelTable.append(modelHead);
  for (const entry of usageModelGroups(snapshot.models)) {
    const estimate = usageEstimate(entry.sources, formula); const row = el('tr');
    const name = el('td', '', `${entry.model} · ${entry.reasoningEffort ?? '추론 강도 미확인'}${entry.assumed ? ' (가정)' : ''}`);
    usageHint(name, `기록된 ID: ${[...new Set(entry.sources.map(source => source.model))].join(', ')}`);
    row.append(name, el('td', '', Math.round(estimate.tokens).toLocaleString()), el('td', '', estimate.unpricedTokens > 0 && estimate.unpricedTokens === estimate.tokens ? '단가 미확인' : costText(estimate))); modelTable.append(row);
  }
  const table = el('table', 'usage-table'); const head = el('tr');
  head.append(el('th', '', '날짜'), el('th', '', '추정 토큰'), el('th', '', `캐시 입력 × ${formula.multiplier}`)); table.append(head);
  for (const day of [...daily].reverse()) { const row = el('tr'); row.append(el('td', '', day.date), el('td', '', Math.round(day.tokens).toLocaleString()), el('td', '', costText(day))); table.append(row); }
  if (!snapshot.days.length) { const row = el('tr'); const cell = el('td', 'muted', '기록된 도구 호출이 없습니다.'); cell.setAttribute('colspan', '3'); row.append(cell); table.append(row); }
  $('usageDays').replaceChildren(modelTable, table);
}
export function initUsage(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(FORMULA_KEY) ?? 'null');
    if (saved && Number.isFinite(saved.divisor) && saved.divisor > 0 && Number.isFinite(saved.multiplier) && saved.multiplier >= 0 && saved.rates && typeof saved.rates === 'object' && !Array.isArray(saved.rates)) {
      formula = { divisor: saved.divisor, multiplier: saved.multiplier, rates: { ...DEFAULT_USAGE_FORMULA.rates, ...Object.fromEntries(Object.entries(saved.rates).filter(([key, value]) => key.length <= 100 && (value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0))) } as UsageFormula['rates'] };
    }
  } catch { /* Invalid display preferences use the documented default. */ }
  for (const [key, id] of [['divisor', 'usageDivisor'], ['multiplier', 'usageMultiplier']] as const) {
    const input = $<HTMLInputElement>(id); input.value = String(formula[key]);
    input.addEventListener('input', () => { if (input.value !== '' && input.validity.valid && Number.isFinite(input.valueAsNumber)) { formula[key] = input.valueAsNumber; saveFormula(); paintCost(); } });
  }
  $('refreshUsage').addEventListener('click', () => void refreshUsage());
}
