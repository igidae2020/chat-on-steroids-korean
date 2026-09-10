import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

let domSource = '';
beforeAll(async () => {
  domSource = await readFile(path.join(process.cwd(), 'extension/chatgpt-dom.js'), 'utf8');
});

describe('DOM recorder ownership during extension reinjection', () => {
  it('retires the replaced section cache observer instead of accumulating transcript work', async () => {
    const dom = new JSDOM(`<!doctype html><body>
      <section data-testid="conversation-turn-0" data-turn="user" data-turn-id="turn-user">
        <div data-message-id="message-user" data-message-author-role="user">
          <div class="whitespace-pre-wrap">Before</div>
        </div>
      </section>
    </body>`, { url: 'https://chatgpt.com/c/test-conversation', runScripts: 'outside-only' });
    const window = dom.window as unknown as Window & typeof globalThis & Record<string, any>;
    const NativeObserver = window.MutationObserver;
    const connected = new Set<MutationObserver>();
    let deliveries = 0;
    window.MutationObserver = class extends NativeObserver {
      constructor(callback: MutationCallback) {
        super((records, observer) => {
          deliveries++;
          callback(records, observer);
        });
      }
      override observe(target: Node, options?: MutationObserverInit): void {
        super.observe(target, options);
        connected.add(this);
      }
      override disconnect(): void {
        super.disconnect();
        connected.delete(this);
      }
    };
    try {
      const retiredHelpers: Array<{ messages(): Array<{ text: string }> }> = [];
      // restoreChatgptTab injects the DOM helper again into the surviving isolated
      // world. Prime each lazily-created section cache as the live recorder does.
      for (let reload = 0; reload < 5; reload++) {
        window.eval(domSource);
        expect(window.CLF_DOM.messages()[0].text).toBe('Before');
        if (reload < 4) retiredHelpers.push(window.CLF_DOM);
      }
      // An async consumer retaining the previous API must not resurrect its
      // observer after the successor has taken ownership.
      for (const helper of retiredHelpers) expect(helper.messages()[0]?.text).toBe('Before');
      window.document.querySelector('.whitespace-pre-wrap')!.textContent = 'After';
      await Promise.resolve();

      // Count work rather than elapsed milliseconds: a single provider mutation
      // must have one current cache owner even after repeated recovery injection.
      expect({ observers: connected.size, deliveries }).toEqual({ observers: 1, deliveries: 1 });
      expect(window.CLF_DOM.messages()[0].text).toBe('After');
    } finally {
      for (const observer of connected) observer.disconnect();
      dom.window.close();
    }
  });
});
