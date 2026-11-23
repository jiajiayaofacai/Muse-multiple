// Synthetic browser fixture checks only; these do not prove Tauri or real Muse authorization.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { createTestServers } = require('../sites/server.cjs');

test('connector callback and close semantics in a dedicated browser', { timeout: 60000 }, async t => {
  const sites = await createTestServers({ ports: { parent: 0, popup: 0 } });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await sites.close(); } });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function withParent(run) {
    const context = await browser.newContext();
    try {
      const parent = await context.newPage();
      parent.setDefaultTimeout(8000);
      await parent.goto(`${sites.origins.parent}/parent`);
      await parent.waitForFunction(() => document.querySelector('[data-testid="page-status"]')?.dataset.state === 'ready');
      const open = async () => {
        const [popup] = await Promise.all([context.waitForEvent('page'), parent.getByTestId('open-popup').click()]);
        popup.setDefaultTimeout(8000);
        await popup.waitForFunction(() => document.querySelector('[data-testid="page-status"]')?.dataset.state === 'ready');
        await popup.waitForFunction(() => document.querySelector('[data-testid="opener-status"]')?.dataset.state === 'present');
        return popup;
      };
      await run(parent, open);
    } finally { await context.close(); }
  }
  await t.test('valid origin/source callback updates parent then child closes', async () => withParent(async (parent, open) => {
    assert.equal(await parent.getByTestId('connection-status').getAttribute('data-state'), 'not-connected');
    const popup = await open();
    assert.equal(await parent.getByTestId('connection-status').getAttribute('data-state'), 'pending');
    const closed = popup.waitForEvent('close');
    await popup.getByTestId('complete-auth').click();
    await closed;
    await parent.waitForFunction(() => document.querySelector('[data-testid="popup-record"]')?.dataset.state === 'closed-after-result');
    assert.equal(await parent.getByTestId('connection-status').getAttribute('data-state'), 'connected-synthetic');
    assert.equal(await parent.getByTestId('popup-record').getAttribute('data-source'), 'matched');
    assert.equal(await parent.getByTestId('popup-record').getAttribute('data-origin'), sites.origins.popup);
    assert(!parent.isClosed());
  }));
  await t.test('closing without a callback never reports connected', async () => withParent(async (parent, open) => {
    const popup = await open();
    const closed = popup.waitForEvent('close');
    await popup.getByTestId('close-self').click();
    await closed;
    await parent.waitForFunction(() => document.querySelector('[data-testid="popup-record"]')?.dataset.state === 'closed-without-result');
    assert.notEqual(await parent.getByTestId('connection-status').getAttribute('data-state'), 'connected-synthetic');
    assert.equal(await parent.getByTestId('popup-record').getAttribute('data-result'), 'pending');
  }));
  await t.test('wrong origin, sibling source, wrong account and replay are rejected', async () => withParent(async (parent, open) => {
    const first = await open();
    const request = await parent.getByTestId('popup-record').first().getAttribute('data-request-id');
    const sibling = await open();
    const payload = { type: 'muse-m0-synthetic-result', request, account: 'A', result: 'synthetic-ok' };
    let rejected = 0;
    const expectRejected = async send => {
      await send();
      await parent.waitForFunction(value => Number(document.querySelector('[data-testid="rejected-count"]').textContent) > value, rejected);
      rejected = Number(await parent.getByTestId('rejected-count').textContent());
    };
    await expectRejected(() => parent.evaluate(data => window.postMessage(data, location.origin), payload));
    await expectRejected(() => sibling.evaluate(({ data, origin }) => window.opener.postMessage(data, origin), { data: payload, origin: sites.origins.parent }));
    await expectRejected(() => first.evaluate(({ data, origin }) => window.opener.postMessage(data, origin), { data: { ...payload, account: 'B' }, origin: sites.origins.parent }));
    for (const row of await parent.getByTestId('popup-record').all()) assert.equal(await row.getAttribute('data-result'), 'pending');
    assert.notEqual(await parent.getByTestId('connection-status').getAttribute('data-state'), 'connected-synthetic');
    await first.evaluate(({ data, origin }) => window.opener.postMessage(data, origin), { data: payload, origin: sites.origins.parent });
    await parent.waitForFunction(() => document.querySelector('[data-testid="popup-record"]')?.dataset.result === 'success');
    await expectRejected(() => first.evaluate(({ data, origin }) => window.opener.postMessage(data, origin), { data: payload, origin: sites.origins.parent }));
    assert.equal(await parent.getByTestId('popup-record').first().getAttribute('data-result'), 'success');
    assert.equal(await parent.getByTestId('popup-record').last().getAttribute('data-result'), 'pending');
  }));
});
