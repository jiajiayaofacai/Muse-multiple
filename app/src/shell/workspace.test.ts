// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAction, WorkspaceSnapshot } from '../../contracts/workspace';

const runtime = vi.hoisted(() => ({
  available: false,
  snapshot: null as WorkspaceSnapshot | null,
  receive: null as ((snapshot: WorkspaceSnapshot) => void) | null,
  actions: [] as WorkspaceAction[],
  actionError: null as unknown,
  layoutError: null as unknown,
  connectError: null as unknown,
  updates: '已是最新正式版（0.1.0）。',
  checkLatestRelease: vi.fn(),
}));
vi.mock('../bridge/native', () => ({
  NativeBridge: class {
    available = runtime.available;
    action = async (action: WorkspaceAction) => {
      runtime.actions.push(action);
      if (runtime.actionError) throw runtime.actionError;
      const next = { ...runtime.snapshot!, revision: runtime.snapshot!.revision + 1 };
      runtime.snapshot = next;
      return next;
    };
    beginLayout = async () => 10;
    connect = async (receive: (snapshot: WorkspaceSnapshot) => void) => {
      runtime.receive = receive;
      if (runtime.connectError) throw runtime.connectError;
      if (runtime.snapshot) receive(runtime.snapshot);
    };
    layout = async () => {
      if (runtime.layoutError) throw runtime.layoutError;
    };
    dispose = vi.fn();
  },
  safeError: (error: unknown) => error && typeof error === 'object' && 'safeMessage' in error ? String((error as { safeMessage: unknown }).safeMessage) : '安全错误',
}));

vi.mock('../bridge/layout', () => ({
  NativeLayout: class {
    setVisible = async () => { if (runtime.layoutError) throw runtime.layoutError; };
    schedule = vi.fn();
    initialize = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('../features/update', () => ({ checkLatestRelease: runtime.checkLatestRelease }));

import { mountWorkspace } from './workspace';

const baseSnapshot = (): WorkspaceSnapshot => ({
  revision: 1,
  accounts: [
    { id: 'a', name: 'A', note: '', lastUsedAt: 2 },
    { id: 'b', name: 'B', note: 'work', lastUsedAt: 1 },
  ],
  tabs: [],
  runtimes: [
    { accountId: 'a', lifecycle: 'unopened', sessionStatus: 'unknown', activeTabId: null, protectionReasons: [] },
    { accountId: 'b', lifecycle: 'unopened', sessionStatus: 'unknown', activeTabId: null, protectionReasons: [] },
  ],
  diagnostics: [],
  activeAccountId: null,
  gateStatus: 'login_verification_pending',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } },
});
const snapshotWithActiveTab = (): WorkspaceSnapshot => {
  const snapshot = baseSnapshot();
  snapshot.activeAccountId = 'a';
  snapshot.tabs = [{ id: 'tab-a', accountId: 'a', openerTabId: null, purpose: 'normal', title: 'Muse', displayUrl: 'https://muse.ai/', loadState: 'ready', canGoBack: true, canGoForward: true }];
  snapshot.runtimes[0] = { accountId: 'a', lifecycle: 'active', sessionStatus: 'unknown', activeTabId: 'tab-a', protectionReasons: [] };
  return snapshot;
};

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function click(root: HTMLElement, selector: string) {
  root.querySelector<HTMLButtonElement>(selector)?.click();
}
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

let root: HTMLElement;
let disposers: Array<() => void> = [];
beforeEach(() => {
  runtime.available = false;
  runtime.snapshot = null;
  runtime.receive = null;
  runtime.actions = [];
  runtime.actionError = null;
  runtime.layoutError = null;
  runtime.connectError = null;
  runtime.updates = '已是最新正式版（0.1.0）。';
  runtime.checkLatestRelease.mockReset().mockImplementation(async () => runtime.updates);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('sidebar')) return { x: 0, y: 0, top: 0, right: 220, bottom: 800, left: 0, width: 220, height: 800, toJSON: () => ({}) } as DOMRect;
    if (this.classList.contains('accounts')) return { x: 0, y: 0, top: 0, right: 220, bottom: 700, left: 0, width: 220, height: 700, toJSON: () => ({}) } as DOMRect;
    if (this.classList.contains('account-menu-trigger')) return { x: 0, y: 20, top: 20, right: 200, bottom: 60, left: 0, width: 200, height: 40, toJSON: () => ({}) } as DOMRect;
    return { x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  });
  window.matchMedia = (() => ({ matches: false, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  root = document.createElement('div');
  document.body.append(root);
  disposers = [];
  window.confirm = (() => true) as typeof window.confirm;
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(() => {
  for (const dispose of disposers) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  root?.remove();
});

async function mount(available = false) {
  runtime.available = available;
  runtime.snapshot = available ? baseSnapshot() : null;
  const dispose = await mountWorkspace(root);
  disposers.push(dispose);
  await settle();
  return dispose;
}

describe('工作台壳状态与路由', () => {
  it('浏览器模式显示空壳、可切换本地页和控制台，原生操作保持禁用', async () => {
    await mount(false);
    expect(root.querySelector('.connection-banner')?.textContent).toContain('未连接原生运行时');
    expect(root.querySelector('.page-view h1')?.textContent).toBe('首页');
    click(root, '.top-actions [data-action="dashboard"]');
    await settle();
    expect(root.querySelector('.page-view h1')?.textContent).toBe('仪表盘');
    click(root, '.top-actions [data-action="console"]');
    expect(root.querySelector<HTMLElement>('.console')?.hidden).toBe(false);
    click(root, '.console [data-action="console"]');
    expect(root.querySelector<HTMLElement>('.console')?.hidden).toBe(true);
    click(root, '.sidebar [data-action="collapse-sidebar"]');
    expect(root.querySelector('.workspace-shell')?.classList.contains('compact')).toBe(true);
    click(root, '.sidebar [data-action="toggle-accounts"]');
    expect(root.querySelector('.sidebar [data-action="toggle-accounts"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector<HTMLButtonElement>('.sidebar [data-action="add-account"]')?.disabled).toBe(true);
  });

  it('原生快照冷启动仍进首页，账号切换后仅展示当前账号标签', async () => {
    await mount(true);
    expect(root.querySelector('.page-view h1')?.textContent).toBe('首页');
    expect(root.querySelectorAll('.account-row')).toHaveLength(2);
    click(root, '.account-row[data-id="a"]');
    await settle();
    expect(runtime.actions[0]).toEqual({ type: 'activateAccount', accountId: 'a' });
    expect(root.querySelector<HTMLElement>('.browser-view')?.hidden).toBe(false);
    expect(root.querySelector('.slot-placeholder')?.textContent).toContain('这里还没有网页标签');
    click(root, '.top-actions [data-action="home"]');
    await settle();
    expect(root.querySelector('.page-view h1')?.textContent).toBe('首页');
    runtime.receive?.({ ...runtime.snapshot!, revision: 10, accounts: runtime.snapshot!.accounts.filter(account => account.id !== 'a') });
    expect(root.querySelector('.page-view h1')?.textContent).toBe('首页');
    expect(root.querySelector('.account-row[data-id="a"]')).toBeNull();
  });

  it('原生连接失败时停用操作并显示安全错误', async () => {
    runtime.available = true;
    runtime.connectError = { safeMessage: '模拟连接失败' };
    runtime.snapshot = baseSnapshot();
    const bridge = await mountWorkspace(root);
    disposers.push(bridge);
    await settle();
    expect(root.querySelector('.connection-banner')?.textContent).toContain('原生连接失败');
    expect(root.querySelector('.error-banner')?.textContent).toContain('模拟连接失败');
    expect(root.querySelector<HTMLButtonElement>('.sidebar [data-action="add-account"]')?.disabled).toBe(true);
  });
});

describe('工作台操作与输入校验', () => {
  it('拒绝不安全地址；有效地址会按活动标签导航或创建标签', async () => {
    await mount(true);
    click(root, '.account-row[data-id="a"]');
    await settle();
    const form = root.querySelector<HTMLFormElement>('.address-form')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    input.value = 'javascript:alert(1)';
    submit(form);
    await settle();
    expect(root.querySelector('.error-banner')?.textContent).toContain('完整的 http://');
    input.value = 'https://muse.ai/';
    submit(form);
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'createTab', accountId: 'a', url: 'https://muse.ai/' });
  });

  it('设置页拒绝无效代理，保存有效设置并显示完成反馈', async () => {
    await mount(true);
    click(root, '.sidebar [data-action="settings"]');
    await settle();
    const form = root.querySelector<HTMLFormElement>('.settings-form')!;
    (form.elements.namedItem('proxyEnabled') as HTMLInputElement).checked = true;
    submit(form);
    await settle();
    expect(root.querySelector('.settings-save-status')?.textContent).toContain('有效的代理');
    (form.elements.namedItem('proxyHost') as HTMLInputElement).value = 'proxy.example';
    (form.elements.namedItem('proxyPort') as HTMLInputElement).value = '8443';
    submit(form);
    await settle();
    expect(runtime.actions.at(-1)?.type).toBe('updateSettings');
    expect(root.querySelector('.settings-save-status')?.textContent).toContain('已保存');
  });

  it('账号创建先验证名称，成功后提交修剪后的元数据；编辑同名提示可关闭', async () => {
    await mount(true);
    click(root, '.sidebar [data-action="add-account"]');
    await settle();
    const form = root.querySelector<HTMLFormElement>('.dialog-form')!;
    const input = form.querySelector<HTMLInputElement>('#dialog-input')!;
    submit(form);
    await settle();
    expect(root.querySelector('#dialog-error')?.textContent).toContain('填写账号名称');
    input.value = '  New Account  ';
    (form.querySelector<HTMLTextAreaElement>('#dialog-note')!).value = ' note ';
    submit(form);
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'createAccount', name: 'New Account', note: 'note' });
    expect(root.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('控制台级别筛选、清空视图与更新检查反馈不修改网页', async () => {
    await mount(true);
    runtime.snapshot = { ...runtime.snapshot!, revision: 2, diagnostics: [
      { id: 1, timestamp: 1, level: 'info', accountId: null, code: 'info_event', safeMessage: 'info' },
      { id: 2, timestamp: 2, level: 'error', accountId: null, code: 'error_event', safeMessage: 'error' },
    ] };
    runtime.receive?.(runtime.snapshot);
    click(root, '.top-actions [data-action="console"]');
    const filter = root.querySelector<HTMLSelectElement>('.console select')!;
    filter.value = 'error';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('.logs')?.textContent).toContain('error_event');
    expect(root.querySelector('.logs')?.textContent).not.toContain('info_event');
    click(root, '.console [data-action="clear-console"]');
    expect(root.querySelector('.logs')?.textContent).toContain('暂无符合条件');
    click(root, '.sidebar [data-action="settings"]');
    await settle();
    click(root, '.settings-page [data-action="check-updates"]');
    await settle();
    expect(root.querySelector('#update-status')?.textContent).toContain('已是最新');
    expect(runtime.actions).toEqual([]);
  });

  it('dispose 后忽略快照事件并释放挂载节点', async () => {
    const dispose = await mount(true);
    const content = root.innerHTML;
    dispose();
    runtime.receive?.({ ...runtime.snapshot!, revision: 99 });
    expect(root.innerHTML).toBe(content);
  });
});
describe('工作台活动标签与账号菜单', () => {
  it('历史、刷新、新建与导航都绑定活动账号和活动标签', async () => {
    await mount(true);
    runtime.snapshot = { ...snapshotWithActiveTab(), revision: 2 };
    runtime.receive?.(runtime.snapshot);
    click(root, '.account-row[data-id="a"]');
    await settle();

    for (const action of ['back', 'forward', 'reload']) {
      click(root, `.browser-toolbar [data-action="${action}"]`);
      await settle();
      expect(runtime.actions.at(-1)).toEqual({ type: action, accountId: 'a', tabId: 'tab-a' });
    }
    runtime.snapshot = { ...runtime.snapshot!, revision: runtime.snapshot!.revision + 1, tabs: runtime.snapshot!.tabs.map(tab => ({ ...tab, loadState: 'loading' as const })) };
    runtime.receive?.(runtime.snapshot);
    click(root, '.browser-toolbar [data-action="stop"]');
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'stop', accountId: 'a', tabId: 'tab-a' });
    click(root, '.new-tab');
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'createTab', accountId: 'a', url: 'about:blank' });

    const form = root.querySelector<HTMLFormElement>('.address-form')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    input.value = 'https://muse.ai/settings';
    submit(form);
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'navigate', accountId: 'a', tabId: 'tab-a', url: 'https://muse.ai/settings' });

    const trigger = root.querySelector<HTMLButtonElement>('.account-menu-trigger[data-id="a"]')!;
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('#account-menu')?.textContent).toContain('刷新此账号当前标签');
    root.querySelector<HTMLButtonElement>('#account-menu [data-action="refresh-account"]')!.click();
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'reload', accountId: 'a', tabId: 'tab-a' });
    root.querySelector<HTMLButtonElement>('.account-menu-trigger[data-id="a"]')!.click();
    root.querySelector<HTMLButtonElement>('#account-menu [data-action="close-account-tabs"]')!.click();
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'closeAllTabs', accountId: 'a' });
  });

  it('搜索和中文输入法组合期间不重建账号列表，组合结束后应用过滤', async () => {
    await mount(true);
    const search = root.querySelector<HTMLInputElement>('.account-search')!;
    search.focus();
    search.value = 'B';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelectorAll('.account-row')).toHaveLength(1);
    expect(root.querySelector('.account-name')?.textContent).toBe('B');

    const composition = root.querySelector<HTMLInputElement>('.account-search')!;
    composition.focus();
    composition.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    composition.value = 'A';
    composition.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.account-name')?.textContent).toBe('B');
    composition.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(root.querySelector('.account-name')?.textContent).toBe('A');
    composition.value = 'missing';
    composition.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.sidebar-empty')?.textContent).toContain('没有匹配的账号');
  });
});
describe('工作台错误与确认分支', () => {
  it('invalid_layout 写入控制台；普通布局错误显示横幅', async () => {
    await mount(true);
    runtime.layoutError = { code: 'invalid_layout' };
    click(root, '.top-actions [data-action="dashboard"]');
    await settle();
    expect(root.querySelector<HTMLElement>('.error-banner')?.hidden).toBe(true);
    click(root, '.top-actions [data-action="console"]');
    expect(root.querySelector('.logs')?.textContent).toContain('layout_rejected');

    runtime.layoutError = { safeMessage: '一般布局错误' };
    click(root, '.sidebar [data-action="settings"]');
    await settle();
    expect(root.querySelector<HTMLElement>('.error-banner')?.hidden).toBe(false);
    expect(root.querySelector('.error-banner')?.textContent).toContain('一般布局错误');
  });

  it('管理操作尊重取消确认，操作错误使用安全摘要，固定外链走受限命令', async () => {
    await mount(true);
    runtime.snapshot = { ...snapshotWithActiveTab(), revision: 2 };
    runtime.receive?.(runtime.snapshot);
    click(root, '.account-row[data-id="a"]');
    await settle();

    window.confirm = (() => false) as typeof window.confirm;
    const before = runtime.actions.length;
    click(root, '[data-action="close-all-tabs"]');
    await settle();
    expect(runtime.actions).toHaveLength(before);

    window.confirm = (() => true) as typeof window.confirm;
    runtime.actionError = { safeMessage: '合成管理操作失败' };
    click(root, '.top-actions [data-action="github"]');
    await settle();
    expect(root.querySelector('.error-banner')?.textContent).toContain('合成管理操作失败');

    runtime.actionError = null;
    click(root, '.error-banner [data-action="dismiss-error"]');
    expect(root.querySelector<HTMLElement>('.error-banner')?.hidden).toBe(true);
    click(root, '.top-actions [data-action="docs"]');
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'openProjectLink', kind: 'docs' });
  });
});
describe('工作台编辑与清理路径', () => {
  it('编辑账号展示备注、提示同名并保存修剪后的名称', async () => {
    await mount(true);
    const snapshot = baseSnapshot();
    snapshot.revision = 2;
    snapshot.activeAccountId = 'a';
    snapshot.runtimes[1] = { accountId: 'b', lifecycle: 'background', sessionStatus: 'unknown', activeTabId: null, protectionReasons: [] };
    runtime.snapshot = snapshot;
    runtime.receive?.(snapshot);

    root.querySelector<HTMLButtonElement>('.account-menu-trigger[data-id="b"]')!.click();
    root.querySelector<HTMLButtonElement>('#account-menu [data-action="edit-account"]')!.click();
    await settle();
    const form = root.querySelector<HTMLFormElement>('.dialog-form')!;
    const name = form.querySelector<HTMLInputElement>('#dialog-input')!;
    expect(name.value).toBe('B');
    expect(form.querySelector<HTMLTextAreaElement>('#dialog-note')?.value).toBe('work');
    name.value = 'A';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('#dialog-hint')?.textContent).toContain('已有同名账号');
    name.value = ' Renamed ';
    (form.querySelector<HTMLTextAreaElement>('#dialog-note')!).value = ' note ';
    submit(form);
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'updateAccount', accountId: 'b', name: 'Renamed', note: 'note' });
  });

  it('清理确认取消不执行命令，确认后重试且移除提示', async () => {
    await mount(true);
    const snapshot = { ...runtime.snapshot!, revision: 2, diagnostics: [
      { id: 1, timestamp: 1, level: 'warn' as const, accountId: null, code: 'profile_cleanup_pending', safeMessage: 'pending' },
    ] };
    runtime.snapshot = snapshot;
    runtime.receive?.(snapshot);
    click(root, '.sidebar [data-action="settings"]');
    await settle();
    expect(root.querySelector('.settings-page')?.textContent).toContain('重试资料清理');
    window.confirm = (() => false) as typeof window.confirm;
    const count = runtime.actions.length;
    click(root, '[data-action="retry-profile-cleanup"]');
    await settle();
    expect(runtime.actions).toHaveLength(count);
    window.confirm = (() => true) as typeof window.confirm;
    click(root, '[data-action="retry-profile-cleanup"]');
    await settle();
    expect(runtime.actions.at(-1)).toEqual({ type: 'retryProfileCleanup' });
  });
});
