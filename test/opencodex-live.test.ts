/** Opt-in probe: only disposable authored text reaches the user's local OpenCodex server. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '', getVersion: () => '0.0.0' },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value: string) => Buffer.from(value, 'utf8'),
    decryptStringAsync: async (buffer: Buffer) => ({ result: buffer.toString('utf8'), shouldReEncrypt: false })
  }
}));

describe.skipIf(process.env.COS_LIVE_OPENCODEX !== '1')('local OpenCodex through the upstream Goal engine', () => {
  let dir: string;
  const realFetch = globalThis.fetch;
  const requests: Array<{ url: string; auth: boolean; model: unknown; effort: unknown; vendorReasoning: boolean }> = [];

  beforeAll(async () => {
    const { makeTempDir } = await import('./helpers.js');
    const config = await import('../src/main/config.js');
    const secrets = await import('../src/main/secrets.js');
    const { initDurableStore } = await import('../src/main/durable.js');
    const { initSessionStore } = await import('../src/main/session/store.js');
    dir = await makeTempDir('cos-opencodex-live-');
    config.initConfigPath(dir);
    secrets.initSecretsPath(dir);
    initDurableStore(dir);
    initSessionStore(dir);
    const defaults = config.defaultConfig();
    await config.saveConfig({ ...defaults, goal: { ...defaults.goal, enabled: true,
      backend: 'api', loopBackend: 'api', model: 'gpt-6-astra', reasoning: 'high',
      provider: { kind: 'custom', baseUrl: 'http://127.0.0.1:10100/v1' } } });
    await secrets.setSecret('openRouterApiKey', 'test-only-must-not-leave-this-fixture');
    await secrets.setSecret('customProviderApiKey', '');
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url !== 'http://127.0.0.1:10100/v1/chat/completions') throw new Error('Unexpected probe destination');
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      const auth = headers.has('authorization');
      // Refuse before transmission, rather than detecting a leaked key after sending it.
      if (auth) throw new Error('A keyless OpenCodex probe must not transmit authorization');
      requests.push({ url, auth, model: body.model, effort: body.reasoning_effort, vendorReasoning: 'reasoning' in body });
      return realFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    const { resetGoalStateForTests } = await import('../src/main/goal.js');
    const { resetSessionStoreForTests } = await import('../src/main/session/store.js');
    const { flushDurable } = await import('../src/main/durable.js');
    const { removeTempDir } = await import('./helpers.js');
    resetGoalStateForTests();
    resetSessionStoreForTests();
    await flushDurable();
    if (dir) await removeTempDir(dir);
  });

  it('generates a High follow-up without a key using the real completion and parser', async () => {
    const goal = await import('../src/main/goal.js');
    const { createSession, appendEvent } = await import('../src/main/session/store.js');
    const conversationId = 'opencodex-disposable-probe';
    const session = await createSession({ conversationId, title: 'Disposable OpenCodex probe' });
    const text = 'Write the integers one through three in order. No files, tools, research or external actions are needed.';
    await appendEvent(session.id, { time: Date.now(), source: 'extension', kind: 'user_message',
      message: { text, chars: text.length, truncated: false } });
    const unfinished = 'I have not written the requested integers yet. I stopped before doing the task.';
    await appendEvent(session.id, { time: Date.now(), source: 'extension', kind: 'assistant_message', final: true,
      message: { text: unfinished, chars: unfinished.length, truncated: false } });
    goal.startGoalDraft({ conversationId, sessionId: session.id, turnId: 'probe-turn' });
    const until = Date.now() + 180_000;
    let view = goal.goalViewFor(conversationId);
    while (view && (view.stage === 'sending' || view.stage === 'answering') && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 100));
      view = goal.goalViewFor(conversationId);
    }
    expect(view?.stage).toBe('ready');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ auth: false, model: 'gpt-6-astra', effort: 'high', vendorReasoning: false });
  }, 190_000);
});
