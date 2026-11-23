// Connect only to an explicitly launched M0 WebView2 instance with a scratch data root.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const dataRoot = process.env.MUSE_MULTIPLE_M0_DATA_DIR;
const endpoint = process.env.MUSE_M0_CDP;
if (!endpoint || !dataRoot || process.env.MUSE_M0_ALLOW_TEST_WRITES !== '1') {
  throw new Error('Set MUSE_M0_CDP and MUSE_M0_ALLOW_TEST_WRITES=1 only for a dedicated scratch-data M0 process.');
}
(async () => {
  const browser = await chromium.connectOverCDP(endpoint);
  console.log('Connected to dedicated M0 shell');
  const accountBrowsers = new Map();
  const pages = () => browser.contexts().flatMap(context => context.pages());
  const shell = pages().find(page => /^(http:\/\/(127\.0\.0\.1:1420|tauri\.localhost)|tauri:\/\/localhost)\//.test(page.url()));
  assert(shell, 'Dedicated M0 local shell must be open');
  shell.setDefaultTimeout(8000);
  await shell.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__));
  const invoke = (command, args) => shell.evaluate(([cmd, params]) => window.__TAURI_INTERNALS__.invoke(cmd, params), [command, args]);
  const snapshot = () => invoke('workspace_snapshot');
  const act = action => invoke('workspace_action', { action });
  const waitFor = async (condition, label) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await condition();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const site = 'http://127.0.0.1:4317/parent';
  const results = [];
  const passed = label => { results.push(label); console.log(`PASS ${label}`); };
  const accounts = [];
  for (const name of ['M0 合成 A', 'M0 合成 B']) {
    const created = await act({ type: 'createAccount', name });
    accounts.push(created.accounts.at(-1));
  }
  const [a, b] = accounts;
  const newTab = async account => {
    const state = await act({ type: 'createTab', accountId: account.id, url: site });
    const tab = state.tabs.at(-1);
    await shell.locator(`.sidebar [data-action="select-account"][data-id="${account.id}"]`).evaluate(button => button.click());
    await shell.waitForFunction(id => document.querySelector(`.sidebar [data-id="${id}"]`)?.getAttribute('aria-current') === 'page', account.id);
    if (!accountBrowsers.has(account.id)) {
      const findPort = async directory => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.name === 'DevToolsActivePort') return Number((await fs.readFile(file, 'utf8')).split('\n')[0]);
          if (entry.isDirectory() && ['EBWebView', 'Default'].includes(entry.name)) {
            const port = await findPort(file);
            if (port) return port;
          }
        }
        return null;
      };
      const port = await waitFor(async () => {
        try { return await findPort(path.join(dataRoot, 'profiles', account.id)); } catch { return null; }
      }, 'per-account debug port');
      accountBrowsers.set(account.id, await chromium.connectOverCDP(`http://127.0.0.1:${port}`));
    }
    const accountBrowser = accountBrowsers.get(account.id);
    const page = await waitFor(() => accountBrowser.contexts().flatMap(context => context.pages()).find(page => page.url() === site && !page.__probeUsed), 'native test site page');
    page.__probeUsed = true;
    page.setDefaultTimeout(8000);
    await page.getByTestId('page-status').filter({ hasText: 'ready' }).waitFor({ state: 'attached', timeout: 5000 });
    return { tab, page };
  };
  const first = await newTab(a);
  await first.page.getByTestId('account-select').selectOption('A');
  await first.page.getByTestId('write-storage').evaluate(button => button.click());
  await first.page.waitForFunction(() => document.querySelector('[data-testid="indexeddb-value"]').textContent === 'A');
  assert.equal(await first.page.getByTestId('local-value').textContent(), 'A');
  passed('native account A stores synthetic identity');
  const second = await newTab(b);
  await second.page.getByTestId('read-storage').evaluate(button => button.click());
  await second.page.waitForFunction(() => document.querySelector('[data-testid="storage-status"]').dataset.state === 'read');
  for (const key of ['cookie-value', 'local-value', 'indexeddb-value']) {
    assert.notEqual(await second.page.getByTestId(key).textContent(), 'A', `B must not see A ${key}`);
  }
  await second.page.getByTestId('account-select').selectOption('B');
  await second.page.getByTestId('write-storage').evaluate(button => button.click());
  await second.page.waitForFunction(() => document.querySelector('[data-testid="indexeddb-value"]').textContent === 'B');
  passed('native A/B profiles isolate Cookie, localStorage and IndexedDB');
  const same = await newTab(a);
  await same.page.getByTestId('read-storage').evaluate(button => button.click());
  await same.page.waitForFunction(() => document.querySelector('[data-testid="indexeddb-value"]').textContent === 'A');
  for (const key of ['cookie-value', 'local-value', 'indexeddb-value']) assert.equal(await same.page.getByTestId(key).textContent(), 'A');
  passed('same account tabs reuse the correct browsing profile');
  const denied = await same.page.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__) return 'bridge-unavailable';
    try { await window.__TAURI_INTERNALS__.invoke('workspace_snapshot'); return 'unexpected-success'; }
    catch { return 'denied'; }
  });
  assert.notEqual(denied, 'unexpected-success');
  passed(`remote management access: ${denied}`);
  const before = (await snapshot()).tabs.length;
  await same.page.getByTestId('open-popup').evaluate(button => button.click());
  const gate = await waitFor(async () => {
    const state = await snapshot();
    return state.diagnostics.some(entry => entry.code === 'new_window_blocked') && state;
  }, 'explicit authentication gate diagnostic');
  assert.equal(gate.tabs.length, before);
  assert.match(gate.gateStatus, /block|未|opener/i);
  passed('authentication gate explicitly BLOCKED; no false success or external fallback');
  await act({ type: 'closeTab', accountId: a.id, tabId: same.tab.id });
  await act({ type: 'closeTab', accountId: a.id, tabId: first.tab.id });
  const state = await snapshot();
  // First activation may have created an initial Muse tab: close it, too.
  for (const tab of state.tabs.filter(tab => tab.accountId === a.id)) await act({ type: 'closeTab', accountId: a.id, tabId: tab.id });
  await act({ type: 'activateAccount', accountId: b.id });
  await act({ type: 'activateAccount', accountId: a.id });
  assert.equal((await snapshot()).tabs.filter(tab => tab.accountId === a.id).length, 0);
  passed('closing the last native tab does not delete account or revive tabs');
  console.log(JSON.stringify({ results, nativeGate: 'blocked', realMuseAuthentication: 'not-tested' }, null, 2));
  for (const accountBrowser of accountBrowsers.values()) await accountBrowser.close();
  await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
