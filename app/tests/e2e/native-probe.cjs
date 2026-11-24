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
  const waitFor = async (condition, label) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await condition();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const shell = await waitFor(() => pages().find(page => /^(http:\/\/(127\.0\.0\.1:1420|tauri\.localhost)|tauri:\/\/localhost)\//.test(page.url())), 'dedicated local shell page');
  assert(shell, 'Dedicated M0 local shell must be open');
  shell.setDefaultTimeout(8000);
  await shell.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__));
  const invoke = (command, args) => shell.evaluate(([cmd, params]) => window.__TAURI_INTERNALS__.invoke(cmd, params), [command, args]);
  const snapshot = () => invoke('workspace_snapshot');
  const act = action => invoke('workspace_action', { action });
  const site = 'http://127.0.0.1:4317/parent';
  const results = [];
  const passed = label => { results.push(label); console.log(`PASS ${label}`); };
  const initial = await snapshot();
  assert(initial.diagnostics.some(entry => entry.code === 'login_verification_pending'));
  assert(!initial.diagnostics.some(entry => entry.code === 'authentication_gate_blocked'));
  assert.doesNotMatch(initial.gateStatus, /^BLOCKED/);
  passed('ordinary inline login is pending verification, not globally blocked by connector support');
  const accounts = [];
  for (const name of ['M0 合成 A', 'M0 合成 B']) {
    const created = await act({ type: 'createAccount', name });
    accounts.push(created.accounts.at(-1));
  }
  const [a, b] = accounts;
  const newTab = async account => {
    const state = await act({ type: 'createTab', accountId: account.id, url: site });
    const tab = state.tabs.at(-1);
    await shell.locator(`.sidebar [data-action="select-account"][data-id="${account.id}"]`).click();
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
  const beforeBlankTab = await snapshot();
  await shell.locator('.tabbar [data-action="new-tab"]').click();
  const blankCreated = await waitFor(async () => {
    const state = await snapshot();
    const tab = state.tabs.find(item => item.accountId === a.id && !beforeBlankTab.tabs.some(old => old.id === item.id));
    return tab && state.tabs.length === beforeBlankTab.tabs.length + 1 ? { state, tab } : null;
  }, 'plus button creates one native blank tab');
  assert.equal(blankCreated.tab.displayUrl, 'about:blank');
  assert.equal(blankCreated.tab.purpose, 'normal');
  assert.equal(blankCreated.state.runtimes.find(runtime => runtime.accountId === a.id).activeTabId, blankCreated.tab.id);
  assert(await shell.locator('dialog').isHidden(), 'adding a tab must not show a URL prompt');
  const addressBar = shell.locator('.address-form input');
  await waitFor(async () => await addressBar.inputValue() === '', 'blank tab leaves the address field ready');
  const typedUrl = 'http://127.0.0.1:4317/parent?typed-navigation=1';
  await addressBar.fill(typedUrl);
  await addressBar.press('Enter');
  const accountBrowser = accountBrowsers.get(a.id);
  const typedPage = await waitFor(() => accountBrowser.contexts().flatMap(context => context.pages()).find(page => page.url() === typedUrl && !page.__typedProbeUsed), 'typed URL native target');
  typedPage.__typedProbeUsed = true;
  await waitFor(() => typedPage.evaluate(() => document.querySelector('[data-testid="page-status"]')?.dataset.state === 'ready'), 'typed page body rendered');
  assert.equal(await typedPage.getByTestId('page-status').textContent(), 'ready');
  const typedState = await waitFor(async () => {
    const state = await snapshot();
    const tab = state.tabs.find(item => item.id === blankCreated.tab.id);
    return tab?.loadState === 'ready' && tab.title === 'M0 合成父站' ? { state, tab } : null;
  }, 'native tab title and load state');
  assert.equal(typedState.tab.displayUrl, 'http://127.0.0.1:4317');
  assert.equal(await typedPage.locator('h1').textContent(), 'M0 合成父站：不是 Muse 登录');
  await waitFor(async () => {
    const slot = await shell.locator('.native-slot').boundingBox();
    const viewport = await typedPage.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const body = await typedPage.locator('body').boundingBox();
    return slot && body && body.height > 0 && Math.abs(slot.width - viewport.width) <= 1 && Math.abs(slot.height - viewport.height) <= 1;
  }, 'typed native page content has visible viewport bounds');
  assert(await shell.locator('.error-banner').isHidden());
  await act({ type: 'closeTab', accountId: a.id, tabId: blankCreated.tab.id });
  await waitFor(async () => !(await snapshot()).tabs.some(tab => tab.id === blankCreated.tab.id), 'typed navigation tab closes');
  passed('plus creates a prompt-free blank tab; typing a URL renders page content in the reserved native viewport');
  const denied = await same.page.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__) return 'bridge-unavailable';
    try { await window.__TAURI_INTERNALS__.invoke('workspace_snapshot'); return 'unexpected-success'; }
    catch { return 'denied'; }
  });
  assert.notEqual(denied, 'unexpected-success');
  passed(`remote management access: ${denied}`);
  const marker = await same.page.evaluate(() => { window.__nativeProbeRetained = crypto.randomUUID(); return window.__nativeProbeRetained; });
  const beforePopup = await snapshot();
  await shell.locator(`.sidebar [data-action="select-account"][data-id="${b.id}"]`).click();
  await shell.waitForFunction(id => document.querySelector(`.sidebar [data-id="${id}"]`)?.getAttribute('aria-current') === 'page', b.id);
  const accountEndpoint = async account => {
    const contents = await fs.readFile(path.join(dataRoot, 'profiles', account.id, 'EBWebView', 'DevToolsActivePort'), 'utf8');
    return `http://127.0.0.1:${Number(contents.split('\n')[0])}`;
  };
  const childConnections = [];
  const click = (page, id) => page.getByTestId(id).evaluate(button => button.click());
  const freshPage = async (account, matches) => {
    const endpoint = await accountEndpoint(account);
    await waitFor(async () => (await (await fetch(`${endpoint}/json/list`)).json()).some(target => target.type === 'page' && matches(target.url)), 'native child target');
    const connection = await chromium.connectOverCDP(endpoint);
    childConnections.push(connection);
    return waitFor(() => connection.contexts().flatMap(context => context.pages()).find(page => matches(page.url())), 'native child page');
  };
  const gone = async child => {
    await waitFor(async () => !(await snapshot()).tabs.some(tab => tab.id === child.tab.id), 'child registry cleanup');
    const endpoint = await accountEndpoint(child.account);
    await waitFor(async () => !(await (await fetch(`${endpoint}/json/list`)).json()).some(target => target.url === child.page.url()), 'native child target cleanup');
  };
  const open = async parent => {
    const old = await parent.page.getByTestId('popup-record').count();
    await click(parent.page, 'open-popup');
    await waitFor(async () => await parent.page.getByTestId('popup-record').count() === old + 1, 'real WindowProxy record');
    const row = parent.page.getByTestId('popup-record').nth(old);
    const request = await row.getAttribute('data-request-id');
    const page = await freshPage(parent.account, value => value.includes(`request=${request}`));
    await waitFor(() => page.evaluate(() => document.querySelector('[data-testid="page-status"]')?.dataset.state === 'ready'), 'child fixture ready');
    assert(await page.evaluate(() => Boolean(window.opener)));
    const tab = (await snapshot()).tabs.find(tab => tab.openerTabId === parent.tab.id && tab.accountId === parent.account.id);
    assert(tab, 'child belongs to real source account/tab');
    assert.equal(tab.purpose, 'normal', 'generic popup is not guessed to be authentication');
    return { account: parent.account, tab, page, row };
  };
  const complete = async (child, parent) => {
    await click(child.page, 'complete-auth');
    await waitFor(async () => await child.row.getAttribute('data-state') === 'closed-after-result', 'matched callback then native close');
    assert.equal(await child.row.getAttribute('data-source'), 'matched');
    assert.equal(await child.row.getAttribute('data-origin'), 'http://127.0.0.1:4318');
    await gone(child);
    const state = await snapshot();
    assert.equal(state.runtimes.find(runtime => runtime.accountId === parent.account.id).activeTabId, parent.tab.id);
    for (const runtime of state.runtimes) assert.equal(runtime.sessionStatus, 'unknown');
  };
  const parentA = { ...same, account: a };
  const parentB = { ...second, account: b };
  const child = await open(parentA);
  const opened = await snapshot();
  assert.equal(opened.activeAccountId, b.id, 'background A request must not switch active B');
  assert.equal(opened.tabs.length, beforePopup.tabs.length + 1);
  assert.equal(opened.gateStatus, beforePopup.gateStatus);
  assert.equal(await child.page.getByTestId('cookie-value').textContent(), 'A');
  assert.equal(await child.page.getByTestId('local-value').textContent(), 'missing', 'cross-origin storage is not copied');
  assert.notEqual(await same.page.getByTestId('connection-status').getAttribute('data-state'), 'connected-synthetic');
  const childAccess = await child.page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('workspace_snapshot'); return 'allowed'; } catch { return 'denied'; }
  });
  assert.equal(childAccess, 'denied');
  await complete(child, parentA);
  assert.equal((await snapshot()).activeAccountId, b.id);
  passed('background A true child preserves opener/profile, rejects remote management, and callbacks/self-close without switching B or fabricating login');
  const bChild = await open(parentB);
  assert.equal(await bChild.page.getByTestId('cookie-value').textContent(), 'B');
  await complete(bChild, parentB);
  passed('B authorization child reuses only B profile');
  const outer = await open(parentA);
  const inner = await open(outer);
  await complete(inner, outer);
  assert.equal(await outer.row.getAttribute('data-result'), 'pending');
  await complete(outer, parentA);
  passed('nested native child callback is delivered only to its immediate opener');
  const cancelled = await open(parentA);
  await click(cancelled.page, 'close-self');
  await waitFor(async () => await cancelled.row.getAttribute('data-state') === 'closed-without-result', 'cancel is not connection success');
  await gone(cancelled);
  assert.equal(await same.page.getByTestId('connection-status').getAttribute('data-state'), 'pending');
  passed('native cancellation cleans child and never produces synthetic connection success');
  await same.page.evaluate(() => { window.__blankProbe = window.open('about:blank', '_blank'); });
  const blankTab = await waitFor(async () => (await snapshot()).tabs.find(tab => tab.openerTabId === same.tab.id), 'about:blank tab');
  await same.page.evaluate(() => { window.__blankProbe.location = 'http://127.0.0.1:4318/popup'; });
  const blankPage = await freshPage(a, value => value === 'http://127.0.0.1:4318/popup');
  assert(await blankPage.evaluate(() => Boolean(window.opener)));
  await click(blankPage, 'close-self');
  await gone({ tab: blankTab, page: blankPage, account: a });
  assert(await same.page.evaluate(() => window.__blankProbe.closed));
  passed('about:blank true WindowProxy supports subsequent opener navigation and native close');
  const articleUrl = 'http://127.0.0.1:4317/parent?article=synthetic';
  await same.page.evaluate(value => { window.__articleProbe = window.open(value, '_blank'); }, articleUrl);
  const articleTab = await waitFor(async () => (await snapshot()).tabs.find(tab => tab.openerTabId === same.tab.id), 'ordinary article tab');
  const articlePage = await freshPage(a, value => value === articleUrl);
  await waitFor(() => articlePage.evaluate(() => document.querySelector('[data-testid="page-status"]')?.dataset.state === 'ready'), 'article fixture ready');
  assert.equal(articleTab.accountId, a.id);
  assert.equal(articleTab.purpose, 'normal');
  assert.equal(await articlePage.getByTestId('local-value').textContent(), 'A');
  await act({ type: 'closeTab', accountId: a.id, tabId: articleTab.id });
  await gone({ tab: articleTab, page: articlePage, account: a });
  passed('ordinary article window stays a normal source-account tab and shell close destroys it');
  const beforeDenied = await snapshot();
  const diagnosticBaseline = Math.max(0, ...beforeDenied.diagnostics.map(entry => entry.id));
  await same.page.evaluate(() => { window.open('ftp://127.0.0.1/synthetic-denied', '_blank'); });
  const deniedState = await waitFor(async () => {
    const state = await snapshot();
    return state.diagnostics.some(entry => entry.id > diagnosticBaseline && entry.code === 'new_window_blocked' && entry.accountId === a.id) && state;
  }, 'unsafe-scheme source diagnostic');
  assert.equal(deniedState.tabs.length, beforeDenied.tabs.length);
  assert.equal(deniedState.activeAccountId, b.id);
  assert.equal(deniedState.gateStatus, beforeDenied.gateStatus);
  assert(await shell.locator('.account-notice').isHidden(), 'B does not display A rejection history');
  passed('unsupported-scheme request is denied without tab creation or changing B/login state');
  await shell.locator(`.sidebar [data-action="select-account"][data-id="${a.id}"]`).click();
  await shell.locator('.account-notice').waitFor({ state: 'visible' });
  assert.match(await shell.locator('.account-notice').textContent(), /M0 合成 A/);
  await shell.locator('.top-actions [data-action="console"]').click();
  await shell.locator('#workspace-console').waitFor({ state: 'visible' });
  await waitFor(() => shell.evaluate(() => {
    const slot = document.querySelector('.native-slot').getBoundingClientRect();
    const notice = document.querySelector('.account-notice').getBoundingClientRect();
    const consolePanel = document.querySelector('#workspace-console').getBoundingClientRect();
    return slot.width > 0 && slot.height > 0 && notice.bottom <= slot.top + 0.01 && slot.bottom <= consolePanel.top + 0.01;
  }), 'notice/console DOM separation');
  await waitFor(async () => {
    const slot = await shell.locator('.native-slot').boundingBox();
    const viewport = await same.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return slot && Math.abs(slot.width - viewport.width) <= 1 && Math.abs(slot.height - viewport.height) <= 1;
  }, 'actual native viewport follows reserved slot');
  assert(await shell.locator('.error-banner').isHidden());
  assert.equal(await same.page.evaluate(() => window.__nativeProbeRetained), marker, 'popup/console must not reload source');
  await shell.locator('.top-actions [data-action="console"]').click();
  passed('popup lifecycle and console retain original page and native viewport layout');
  const orphan = await open(parentA);
  await click(orphan.page, 'close-opener');
  await waitFor(async () => !(await snapshot()).tabs.some(tab => tab.id === same.tab.id), 'source closes first');
  assert(await orphan.page.evaluate(() => !window.opener || window.opener.closed));
  await click(orphan.page, 'close-self');
  await gone(orphan);
  assert(!(await snapshot()).tabs.some(tab => tab.id === same.tab.id), 'closing orphan must not resurrect source');
  assert.equal(await second.page.getByTestId('local-value').textContent(), 'B');
  passed('source-first native close and orphan cleanup do not revive source or affect B');
  for (const connection of childConnections) await connection.close();
  await act({ type: 'closeTab', accountId: a.id, tabId: first.tab.id });
  const state = await snapshot();
  // First activation may have created an initial Muse tab: close it, too.
  for (const tab of state.tabs.filter(tab => tab.accountId === a.id)) await act({ type: 'closeTab', accountId: a.id, tabId: tab.id });
  await act({ type: 'activateAccount', accountId: b.id });
  await act({ type: 'activateAccount', accountId: a.id });
  assert.equal((await snapshot()).tabs.filter(tab => tab.accountId === a.id).length, 0);
  passed('closing the last native tab does not delete account or revive tabs');
  console.log(JSON.stringify({ results, inlineLogin: 'pending-real-user-verification', connectorNewWindows: 'native-synthetic-verified', realMuseAuthentication: 'not-tested', realConnector: 'not-tested' }, null, 2));
  for (const accountBrowser of accountBrowsers.values()) await accountBrowser.close();
  await browser.close();
})().catch(error => { console.error(error.stack); process.exit(1); });
