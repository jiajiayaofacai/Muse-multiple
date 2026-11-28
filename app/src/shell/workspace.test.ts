// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAction, WorkspaceSnapshot } from '../../contracts/workspace';
import type { CreativeMode, CreativeTask } from '../../contracts/creative';

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
  creativeStatus: vi.fn(),
  creativeConnect: vi.fn(),
  creativeDisconnect: vi.fn(),
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
  creativeTask: vi.fn(),
  saveCreativeResult: vi.fn(),
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
    creativeStatus = () => runtime.creativeStatus();
    connectCreative = (baseUrl: string, apiKey: string) => runtime.creativeConnect(baseUrl, apiKey);
    disconnectCreative = () => runtime.creativeDisconnect();
    generateImage = runtime.generateImage;
    generateVideo = runtime.generateVideo;
    saveCreativeResult = runtime.saveCreativeResult;
    creativeTask = (mode: string, taskId: string) => runtime.creativeTask(mode, taskId);
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
  runtime.creativeStatus.mockReset().mockResolvedValue({ connected: false, baseUrl: null });
  runtime.creativeConnect.mockReset().mockImplementation(async (baseUrl: string) => ({ connected: true, baseUrl }));
  runtime.creativeDisconnect.mockReset().mockResolvedValue(undefined);
  runtime.generateImage.mockReset().mockResolvedValue({ id: 'image-1', mode: 'image', status: 'completed', progress: 100, mediaUrl: 'http://127.0.0.1:18610/v1/media/result.png' });
  runtime.generateVideo.mockReset().mockResolvedValue({ id: 'video-1', mode: 'video', status: 'queued', progress: 0, mediaUrl: null });
  runtime.creativeTask.mockReset().mockResolvedValue({ id: 'image-1', mode: 'image', status: 'completed', progress: 100, mediaUrl: 'http://127.0.0.1:18610/v1/media/result.png' });
  runtime.saveCreativeResult.mockReset().mockResolvedValue('fixture-1.png');
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

describe('创意台导航与生成流程', () => {
  it('出现在账号列表下方，展开后分别切换图片和视频工作台', async () => {
    await mount(true);
    const accountList = root.querySelector('#account-list')!;
    const studio = root.querySelector('.creative-group')!;
    expect(accountList.compareDocumentPosition(studio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    click(root, '[data-action="toggle-creative"]');
    expect((root.querySelector<HTMLElement>('.creative-subnav'))?.hidden).toBe(false);
    click(root, '[data-action="creative-image"]');
    await settle();
    expect(root.querySelector('.creative-page')?.getAttribute('data-creative-mode')).toBe('image');
    expect((root.querySelector<HTMLElement>('.browser-view'))?.hidden).toBe(true);
    click(root, '[data-action="creative-video"]');
    await settle();
    expect(root.querySelector('.creative-page h1')?.textContent).toBe('视频工作台');
  });

  it('用内存中的连接配置提交图片任务并显示已完成预览', async () => {
    await mount(true);
    click(root, '[data-action="toggle-creative"]');
    click(root, '[data-action="creative-image"]');
    await settle();
    const connectForm = root.querySelector<HTMLFormElement>('.creative-connect-form')!;
    (connectForm.elements.namedItem('baseUrl') as HTMLInputElement).value = 'http://127.0.0.1:18610';
    (connectForm.elements.namedItem('apiKey') as HTMLInputElement).value = 'm2a-test-only';
    submit(connectForm);
    await settle();
    expect(runtime.creativeConnect).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:18610', 'm2a-test-only');
    expect((root.querySelector('[name="apiKey"]') as HTMLInputElement).value).toBe('');
    expect(root.textContent).not.toContain('m2a-test-only');

    const form = root.querySelector<HTMLFormElement>('.creative-generate-form')!;
    (form.elements.namedItem('prompt') as HTMLTextAreaElement).value = '合成提示词';
    (form.elements.namedItem('size') as HTMLSelectElement).value = '1024x1024';
    submit(form);
    await settle();
    expect(runtime.generateImage).toHaveBeenCalledExactlyOnceWith('合成提示词', '1024x1024');
    expect(root.querySelector('.creative-image-result')?.getAttribute('src')).toBe('http://127.0.0.1:18610/v1/media/result.png');
  });

  it('无关快照不会替换提示词、密码输入框或夺走焦点', async () => {
    await mount(true);
    click(root, '[data-action="creative-image"]');
    await settle();
    const prompt = root.querySelector<HTMLTextAreaElement>('#creative-prompt')!;
    const key = root.querySelector<HTMLInputElement>('#creative-api-key')!;
    prompt.value = '未完成的输入';
    key.focus();
    key.value = 'fixture-in-memory';
    runtime.receive?.({ ...runtime.snapshot!, revision: 10 });
    expect(root.querySelector('#creative-prompt')).toBe(prompt);
    expect(prompt.value).toBe('未完成的输入');
    expect(document.activeElement).toBe(key);
    expect(key.value).toBe('fixture-in-memory');
    expect(root.innerHTML).not.toContain('fixture-in-memory');
  });
});

describe('创意台任务、草稿和连接隔离', () => {
  const service = { connected: true, baseUrl: 'http://127.0.0.1:18610' };
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = () => get<HTMLFormElement>('.creative-generate-form');
  const submitTask = (prompt: string) => { get<HTMLTextAreaElement>('#creative-prompt').value = prompt; submit(form()); };
  const routeTo = async (mode: CreativeMode) => { click(root, `[data-action="creative-${mode}"]`); await Promise.resolve(); };
  const task = (mode: CreativeMode, id: string, status: CreativeTask['status']): CreativeTask => ({ mode, id, status, progress: status === 'processing' ? 35 : 0, mediaUrl: status === 'completed' ? `${service.baseUrl}/v1/media/${id}.${mode === 'image' ? 'png' : 'mp4'}` : null });
  const start = async (mode: CreativeMode) => { runtime.creativeStatus.mockResolvedValue(service); const dispose = await mount(true); await routeTo(mode); await settle(); return dispose; };
  function pick(file: File) {
    const dt = new DataTransfer(); dt.items.add(file);
    const input = get<HTMLInputElement>('#creative-reference');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  afterEach(() => { vi.useRealTimers(); });

  it('参考图和首帧保留在各自草稿中；折叠和账号往返后仍可提交，只在提交时读取', async () => {
    await start('image');
    runtime.snapshot = { ...snapshotWithActiveTab(), revision: 2 }; runtime.receive!(runtime.snapshot);
    const slot = get('.native-slot');
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const imgPrompt = get<HTMLTextAreaElement>('#creative-prompt');
    imgPrompt.value = '  图片草稿  ';
    get<HTMLSelectElement>('#creative-size').value = '1024x1536';
    pick(new File([new Uint8Array([137, 80, 78, 71])], 'fixture.png', { type: 'image/png' }));
    expect(get('.creative-reference-name').textContent).toContain('fixture.png');
    click(root, '[data-action="toggle-creative"]');
    expect(get('.creative-subnav').hidden).toBe(true);
    expect(get('.creative-page h1').textContent).toBe('图片工作台');
    click(root, '[data-action="toggle-creative"]');
    await routeTo('video');
    expect(get<HTMLTextAreaElement>('#creative-prompt').value).toBe('');
    expect(get('.creative-reference-name').textContent).toBe('');
    get<HTMLSelectElement>('#creative-ratio').value = '9:16';
    pick(new File([new Uint8Array([255, 216, 255])], 'frame.jpg', { type: 'image/jpeg' }));
    expect(read).not.toHaveBeenCalled();
    submitTask('视频草稿'); submit(form());
    await vi.waitFor(() => expect(runtime.generateVideo).toHaveBeenCalledExactlyOnceWith('视频草稿', '9:16', 'data:image/jpeg;base64,/9j/'));
    expect(root.innerHTML).not.toContain('data:image/');
    click(root, '.account-row[data-id="a"]'); await settle();
    expect(get('.browser-view').hidden).toBe(false);
    expect(get('.native-slot')).toBe(slot);
    expect(get('.tabs').textContent).toContain('Muse');
    expect(runtime.actions).toEqual([{ type: 'activateAccount', accountId: 'a' }]);
    await routeTo('image');
    expect(get('#creative-prompt')).toBe(imgPrompt);
    expect(imgPrompt.value).toBe('  图片草稿  ');
    expect(get<HTMLSelectElement>('#creative-size').value).toBe('1024x1536');
    expect(get('.creative-reference-name').textContent).toContain('fixture.png');
    expect(get('.creative-active-count').textContent).toContain('0 项');
    submit(form());
    await vi.waitFor(() => expect(runtime.generateImage).toHaveBeenCalledExactlyOnceWith('图片草稿', '1024x1536', 'data:image/png;base64,iVBORw=='));
    click(root, '[data-action="creative-remove-reference"]');
    expect(get<HTMLInputElement>('#creative-reference').files).toHaveLength(0);
    expect(get('.creative-reference-name').textContent).toBe('');
    await routeTo('video');
    expect(get('.creative-active-count').textContent).toContain('1 项');
    expect(get('.creative-reference-name').textContent).toContain('frame.jpg');
    expect(get<HTMLSelectElement>('#creative-ratio').value).toBe('9:16');
    expect(get<HTMLTextAreaElement>('#creative-prompt').value).toBe('视频草稿');
    expect(get('.creative-results').textContent).not.toContain('图片草稿');
  });

  it('无效文件及空白提示词无法提交，移除后恢复纯文本生成；桥接失败不阻断后续提交', async () => {
    await start('image');
    const button = get<HTMLButtonElement>('.creative-submit');
    pick(new File(['fixture'], 'not-an-image.svg', { type: 'image/svg+xml' }));
    expect(button.disabled).toBe(true);
    expect(get('#creative-file-error').textContent).toContain('PNG');
    submitTask('不能提交');
    expect(runtime.generateImage).not.toHaveBeenCalled();
    click(root, '[data-action="creative-remove-reference"]');
    expect(button.disabled).toBe(false);
    submitTask('  ');
    expect(get('#creative-submit-error').textContent).toContain('提示词');
    expect(runtime.generateImage).not.toHaveBeenCalled();
    runtime.generateImage.mockRejectedValueOnce({ safeMessage: '合成提交失败' });
    submitTask('合成重试'); await settle();
    expect(get('#creative-submit-error').textContent).toBe('合成提交失败');
    expect(button.disabled).toBe(false);
    submit(form()); await settle();
    expect(runtime.generateImage.mock.lastCall).toEqual(['合成重试', '1024x1024']);
    expect(get('#creative-submit-error').textContent).toBe('');
    expect(get('.creative-image-result')).toBeTruthy();
  });

  it('跨路由轮询互不覆盖；提示词和已完成的视频不受快照、其他任务和保存影响', async () => {
    await start('image'); vi.useFakeTimers();
    runtime.generateImage.mockResolvedValue(task('image', 'i', 'queued'));
    submitTask('后台图片'); await vi.advanceTimersByTimeAsync(0);
    await routeTo('video');
    runtime.generateVideo.mockResolvedValueOnce(task('video', 'v', 'completed')).mockResolvedValueOnce(task('video', 'v2', 'queued'));
    submitTask('可播放视频'); await vi.advanceTimersByTimeAsync(0);
    const video = get<HTMLVideoElement>('video');
    video.currentTime = 2;
    submitTask('第二个视频'); await vi.advanceTimersByTimeAsync(0);
    const prompt = get<HTMLTextAreaElement>('#creative-prompt');
    prompt.focus(); prompt.value = '下一个草稿'; prompt.setSelectionRange(1, 3);
    runtime.receive!({ ...runtime.snapshot!, revision: 10 });
    runtime.creativeTask.mockImplementation(async (mode: CreativeMode, id: string) => task(mode, id, 'completed'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(runtime.creativeTask.mock.calls).toEqual([['image', 'i'], ['video', 'v2']]);
    expect(get('[data-task-id="v"] video')).toBe(video);
    expect(video.currentTime).toBe(2);
    expect(document.activeElement).toBe(prompt);
    expect([prompt.value, prompt.selectionStart, prompt.selectionEnd]).toEqual(['下一个草稿', 1, 3]);
    expect(get('.creative-active-count').textContent).toContain('0 项');
    expect(get('.creative-results').textContent).not.toContain('后台图片');
    const saveButton = get<HTMLButtonElement>('[data-task-id="v"] [data-action="creative-save"]');
    runtime.saveCreativeResult.mockRejectedValueOnce({ safeMessage: '合成写入失败' });
    saveButton.click(); await vi.advanceTimersByTimeAsync(0);
    expect(get('[data-task-id="v"] .creative-save-status').textContent).toContain('合成写入失败');
    expect(saveButton.disabled).toBe(false);
    const saving = deferred<string>(); runtime.saveCreativeResult.mockReturnValueOnce(saving.promise);
    saveButton.click(); saveButton.click();
    expect(saveButton.disabled).toBe(true);
    expect(get('[data-task-id="v"] .creative-save-status').textContent).toContain('正在保存');
    saving.resolve('fixture-video-2.mp4'); await vi.advanceTimersByTimeAsync(0);
    expect(runtime.saveCreativeResult.mock.calls).toEqual([['video', 'v'], ['video', 'v']]);
    expect(get('[data-task-id="v"] .creative-save-status').textContent).toContain('fixture-video-2.mp4');
    expect(saveButton.disabled).toBe(true);
    expect(get('[data-task-id="v"] video')).toBe(video);
    await routeTo('image');
    expect(get('.creative-image-result')).toBeTruthy();
    click(root, '[data-action="creative-save"]'); await vi.advanceTimersByTimeAsync(10000);
    expect(runtime.saveCreativeResult.mock.lastCall).toEqual(['image', 'i']);
    expect(get('.creative-save-status').textContent).toContain('fixture-1.png');
    expect(runtime.creativeTask).toHaveBeenCalledTimes(2);
  });

  it('临时查询错误有界重试并可手动恢复；不存在、权限错误及服务端失败停止轮询', async () => {
    await start('video'); vi.useFakeTimers();
    runtime.generateVideo.mockImplementation(async (id: string) => task('video', id, 'queued'));
    for (const id of ['transient', 'missing', 'denied', 'failed']) { submitTask(id); await vi.advanceTimersByTimeAsync(0); }
    runtime.creativeTask.mockImplementation(async (mode: CreativeMode, id: string) => {
      if (id === 'transient') throw { safeMessage: '本机服务暂时离线', retryable: true };
      if (id === 'missing') throw { safeMessage: '任务不存在', code: 'creative_task_not_found', retryable: true };
      if (id === 'denied') throw { safeMessage: '访问被拒绝', retryable: false };
      return task(mode, id, 'failed');
    });
    await vi.advanceTimersByTimeAsync(2500);
    expect(get('[data-task-id="missing"]').textContent).toContain('已停止查询');
    expect(get('[data-task-id="denied"]').textContent).toContain('访问被拒绝');
    expect(get('[data-task-id="failed"]').textContent).toContain('生成失败');
    expect(get('[data-task-id="transient"]').textContent).toContain('自动重试');
    await vi.advanceTimersByTimeAsync(15000);
    expect(runtime.creativeTask).toHaveBeenCalledTimes(6);
    expect(get('.creative-active-count').textContent).toContain('0 项');
    expect(get('[data-task-id="transient"]').textContent).toContain('已暂停查询');
    runtime.creativeTask.mockResolvedValue(task('video', 'transient', 'completed'));
    click(root, '[data-action="creative-retry"]');
    expect(get('.creative-active-count').textContent).toContain('1 项');
    await vi.advanceTimersByTimeAsync(12000);
    expect(runtime.creativeTask).toHaveBeenCalledTimes(7);
    expect(get('[data-task-id="transient"] video')).toBeTruthy();
  });

  it('连接操作中阻止重复和交叉请求；失败保留旧连接，取消确认时不清除任务', async () => {
    await mount(true);
    const checking = deferred<typeof service>(); runtime.creativeStatus.mockReturnValueOnce(checking.promise);
    await routeTo('image');
    const connectionForm = get<HTMLFormElement>('.creative-connect-form');
    const key = get<HTMLInputElement>('#creative-api-key');
    const disconnect = get<HTMLButtonElement>('[data-action="creative-disconnect"]');
    expect(key.disabled).toBe(true);
    submit(connectionForm); submitTask('被阻止');
    expect(runtime.creativeConnect).not.toHaveBeenCalled();
    expect(runtime.generateImage).not.toHaveBeenCalled();
    checking.resolve(service); await settle();
    submit(connectionForm);
    expect(get('#creative-connection-error').textContent).toContain('Key');
    const connecting = deferred<typeof service>(); runtime.creativeConnect.mockReturnValueOnce(connecting.promise);
    key.value = 'fixture-only'; submit(connectionForm); submit(connectionForm); disconnect.click(); submitTask('被阻止');
    expect(disconnect.disabled).toBe(true);
    expect(get('.creative-connect-status').textContent).toContain('验证');
    expect(runtime.creativeConnect).toHaveBeenCalledTimes(1);
    expect(key.value).toBe('');
    expect(runtime.creativeDisconnect).not.toHaveBeenCalled();
    connecting.resolve(service); await settle();
    submitTask('保留这个任务'); await settle();
    window.confirm = vi.fn(() => false); disconnect.click();
    expect(runtime.creativeDisconnect).not.toHaveBeenCalled();
    expect(get('.creative-task')).toBeTruthy();
    window.confirm = vi.fn(() => true);
    runtime.creativeDisconnect.mockRejectedValueOnce({ safeMessage: '合成断开失败' });
    disconnect.click(); await settle();
    expect(get('#creative-connection-error').textContent).toBe('合成断开失败');
    expect(get<HTMLButtonElement>('.creative-submit').disabled).toBe(false);
    const disconnecting = deferred<void>(); runtime.creativeDisconnect.mockReturnValueOnce(disconnecting.promise);
    disconnect.click(); disconnect.click(); submit(connectionForm); submitTask('尚未断开');
    expect(get('.creative-connect-status').textContent).toContain('正在断开');
    expect(get<HTMLButtonElement>('[data-action="creative-save"]').disabled).toBe(true);
    expect(runtime.creativeDisconnect).toHaveBeenCalledTimes(2);
    disconnecting.resolve(); await settle();
    expect(get('.creative-connect-status').textContent).toBe('尚未连接');
    expect(root.querySelector('.creative-task')).toBeNull();
    expect(get<HTMLButtonElement>('.creative-submit').disabled).toBe(true);
  });

  it('重连后旧提交、查询、保存的迟到响应不进入新服务，即使任务编号相同', async () => {
    const dispose = await start('image'); vi.useFakeTimers();
    const submitted = deferred<CreativeTask>(), queried = deferred<CreativeTask>(), saved = deferred<string>();
    runtime.generateImage.mockResolvedValueOnce(task('image', 'same', 'queued')).mockResolvedValueOnce(task('image', 'old-media', 'completed')).mockReturnValueOnce(submitted.promise);
    submitTask('旧任务'); await vi.advanceTimersByTimeAsync(0);
    submitTask('旧成品'); await vi.advanceTimersByTimeAsync(0);
    runtime.saveCreativeResult.mockReturnValueOnce(saved.promise); click(root, '[data-action="creative-save"]');
    runtime.creativeTask.mockReturnValueOnce(queried.promise); await vi.advanceTimersByTimeAsync(2500);
    submitTask('旧提交'); submit(form());
    expect(runtime.generateImage).toHaveBeenCalledTimes(3);
    get<HTMLInputElement>('#creative-service-url').value = 'http://127.0.0.1:19999';
    get<HTMLInputElement>('#creative-api-key').value = 'fixture-different';
    submit(get<HTMLFormElement>('.creative-connect-form')); await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll('.creative-task')).toHaveLength(0);
    runtime.generateImage.mockResolvedValueOnce(task('image', 'same', 'queued'));
    submitTask('新服务的任务'); await vi.advanceTimersByTimeAsync(0);
    submitted.resolve(task('image', 'old-submit', 'queued')); saved.resolve('private-old.png'); queried.resolve(task('image', 'same', 'completed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelectorAll('.creative-task')).toHaveLength(1);
    expect(get('.creative-task').textContent).toContain('新服务的任务');
    expect(get('.creative-task').textContent).toContain('排队中');
    expect(root.textContent).not.toContain('private-old');
    dispose(); await vi.advanceTimersByTimeAsync(10000);
    expect(runtime.creativeTask).toHaveBeenCalledTimes(1);
  });

  it('超过 20 个任务仍全部跟踪；在账号页也继续轮询，重复任务编号只出现一次', async () => {
    await start('image'); vi.useFakeTimers();
    const ids = Array.from({ length: 21 }, (_, index) => `fixture-${index}`);
    runtime.generateImage.mockImplementation(async (id: string) => task('image', id, 'queued'));
    for (const id of [...ids, ids[0]]) { submitTask(id); await vi.advanceTimersByTimeAsync(0); }
    expect(root.querySelectorAll('.creative-task')).toHaveLength(ids.length);
    expect(get('.creative-active-count').textContent).toContain('21 项');
    click(root, '[data-action="toggle-creative"]');
    click(root, '.account-row[data-id="a"]'); await vi.advanceTimersByTimeAsync(0);
    expect(get('.browser-view').hidden).toBe(false);
    runtime.creativeTask.mockImplementation(async (mode: CreativeMode, id: string) => task(mode, id, 'completed'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(runtime.creativeTask.mock.calls).toEqual(ids.map(id => ['image', id]));
    expect(root.querySelector('.creative-page')).toBeNull();
    click(root, '[data-action="toggle-creative"]'); await routeTo('image');
    expect(root.querySelectorAll('[data-action="creative-save"]')).toHaveLength(ids.length);
    expect(get('.creative-active-count').textContent).toContain('0 项');
  });
});
