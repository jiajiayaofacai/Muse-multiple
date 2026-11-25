// Production shell in isolated Edge, with local mock IPC and GitHub responses. No Tauri process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const config = require('../../src-tauri/tauri.conf.json');

const shell = 'http://tauri.localhost';
const latest = 'https://api.github.com/repos/jiajiayaofacai/Muse-multiple/releases/latest';
test('settings update and proxy form, and account-scoped dropdown', async t => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let requests = 0;
  let finishCheck;
  const waitForManualCheck = new Promise(resolve => { finishCheck = resolve; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === latest) {
      requests++;
      if (requests === 2) await waitForManualCheck;
      return route.fulfill({ status: requests === 1 ? 404 : 200, headers: { 'access-control-allow-origin': '*' }, ...(requests > 1 ? { json: { tag_name: 'v999.0.0', draft: false, prerelease: false } } : {}) });
    }
    if (url.origin !== shell || !/^\/(?:assets\/[\w.-]+)?$/.test(url.pathname)) return route.abort();
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return route.fulfill({ path: path.join(__dirname, '../../dist', name), headers: { 'content-security-policy': config.app.security.csp } });
  });
  await page.addInitScript(() => {
    const snapshot = { revision: 1, accounts: ['A', 'B'].map(id => ({ id, name: id, note: '', lastUsedAt: 0 })), tabs: [], runtimes: [], diagnostics: [], activeAccountId: null, gateStatus: 'synthetic', settings: { closeBehavior: 'exit', theme: 'light', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } } };
    window.isTauri = true;
    window.testActions = [];
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (command, args) => {
        if (command === 'workspace_snapshot') return snapshot;
        if (command === 'workspace_layout_begin') return 0;
        if (command === 'workspace_action') {
          window.testActions.push(args.action);
          if (args.action.type === 'updateSettings') snapshot.settings = args.action.settings;
          return { ...snapshot, revision: ++snapshot.revision };
        }
      },
    };
  });
  await page.goto(shell);
  const gear = page.getByRole('button', { name: 'B 的账号操作' });
  await gear.click();
  const menu = page.getByRole('menu', { name: 'B 的账号操作' });
  await expect(menu).toBeVisible();
  await expect(page.locator('dialog')).not.toHaveAttribute('open', '');
  assert.equal(await gear.locator('svg').evaluate(node => getComputedStyle(node).width), '14px');
  await page.keyboard.press('Escape');
  await expect(gear).toBeFocused();
  await expect(menu).toBeHidden();
  await gear.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#dialog-input')).toHaveValue('B');
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  await gear.click();
  await menu.getByRole('menuitem', { name: '删除此账号' }).click(); // Auto-dismiss confirmation.
  assert.deepEqual(await page.evaluate(() => window.testActions), []);
  await gear.click();
  await page.locator('.sidebar [data-action="settings"]').click();
  await expect(menu).toBeHidden();
  const status = page.locator('#update-status');
  await expect(status).toContainText('未找到公开的正式版本');
  assert.equal(requests, 1);
  const host = page.getByRole('textbox', { name: '代理主机或完整地址' });
  const protocol = page.getByRole('combobox', { name: '代理协议' });
  const left = page.locator('.proxy-fields strong');
  const fontSize = locator => locator.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert.ok(await fontSize(protocol) <= await fontSize(left));
  await host.fill('');
  const check = page.getByRole('button', { name: '立即检查' });
  await check.click();
  await expect(check).toBeDisabled();
  finishCheck();
  await expect(status).toContainText('发现新版本');
  await expect(host).toHaveValue('');
  await page.getByRole('checkbox', { name: '启用' }).check();
  const save = page.getByRole('button', { name: '保存设置' });
  await save.click();
  await expect(page.locator('.settings-save-status')).toContainText('请填写有效');
  await host.fill('127.0.0.1');
  await protocol.selectOption('socks5');
  await page.getByRole('spinbutton', { name: '代理端口' }).fill('1080');
  await save.click();
  await expect(page.locator('.settings-save-status')).toContainText('已保存');
  assert.deepEqual((await page.evaluate(() => window.testActions))[0].settings.proxy, { enabled: true, scheme: 'socks5', host: '127.0.0.1', port: 1080 });
  await host.fill('https://secure-proxy.example:7161');
  await save.click();
  await expect(page.locator('.settings-save-status')).toContainText('已保存');
  assert.deepEqual((await page.evaluate(() => window.testActions)).at(-1).settings.proxy,
    { enabled: true, scheme: 'https', host: 'secure-proxy.example', port: 7161 });
  await expect(host).toHaveValue('https://secure-proxy.example:7161');
  await expect(protocol).toHaveValue('https');
  await expect(page.getByRole('spinbutton', { name: '代理端口' })).toHaveValue('');
  assert.deepEqual(errors, []);
});
