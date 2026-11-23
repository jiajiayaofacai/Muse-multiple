import { describe, expect, it } from 'vitest';
import type { TabDto, WorkspaceSnapshot } from '../../contracts/workspace';
import { accountRequestNotice, accountTabStrip, browserEmptyState, tabLabel } from './browser-content';

const state = (): WorkspaceSnapshot => ({
  revision: 7,
  accounts: ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), note: '', lastUsedAt: 0 })),
  tabs: [], runtimes: [], diagnostics: [], activeAccountId: 'a', gateStatus: 'connected',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15 },
});
const tab: TabDto = {
  id: 'tab-a', accountId: 'a', openerTabId: null, purpose: 'normal', title: 'Muse',
  displayUrl: 'https://example.test/oauth', loadState: 'ready', canGoBack: false, canGoForward: false,
};

describe('账号网页区域外的受限提示内容', () => {
  it('没有归属事件时不显示，也不按 gateStatus、页面 ready 或授权 URL 推断成功', () => {
    const snapshot = state();
    snapshot.tabs = [tab];
    expect(accountRequestNotice(snapshot, 'a')).toBe('');
    expect(accountRequestNotice(null, 'a')).toBe('');
    expect(tabLabel(tab)).toBe('Muse');
  });

  it('展示来源账号的具体安全消息和事件编号，不把普通外链猜成授权或登录失败', () => {
    const snapshot = state();
    snapshot.accounts[1].name = 'B <工作>';
    snapshot.diagnostics = [{ id: 8, timestamp: 80, level: 'warn', accountId: 'b', code: 'new_window_blocked', safeMessage: '原生拒绝 <新窗口>' }];
    expect(accountRequestNotice(snapshot, 'a')).toBe('');
    const html = accountRequestNotice(snapshot, 'b');
    expect(html).toContain('B &lt;工作&gt;');
    expect(html).toContain('原生拒绝 &lt;新窗口&gt;');
    expect(html).toContain('new_window_blocked #8');
    expect(html).toContain('普通外链');
    expect(html).toContain('未判断为授权请求');
    expect(html).toContain('不代表原页登录失败');
    expect(html).toContain('历史记录');
  });

  it('渲染最新创建失败并转义，不依赖成功事件来清除历史拒绝', () => {
    const snapshot = state();
    snapshot.diagnostics = [
      { id: 10, timestamp: 100, level: 'error', accountId: 'a', code: 'new_window_failed', safeMessage: '创建 <失败>' },
      { id: 9, timestamp: 90, level: 'warn', accountId: 'a', code: 'new_window_blocked', safeMessage: '旧拒绝' },
      { id: 11, timestamp: 110, level: 'error', accountId: 'b', code: 'new_window_failed', safeMessage: 'B 的失败' },
    ];
    const html = accountRequestNotice(snapshot, 'a');
    expect(html).toContain('新标签创建失败');
    expect(html).toContain('new_window_failed #10');
    expect(html).toContain('创建 &lt;失败&gt;');
    expect(html).toContain('历史记录');
    expect(html).not.toContain('旧拒绝');
    expect(html).not.toContain('B 的失败');
    expect(html).not.toContain('data-action=');
  });

  it('关闭全部标签仍只展示历史受限记录，移除账号后清除提示', () => {
    const snapshot = state();
    snapshot.diagnostics = [{ id: 8, timestamp: 80, level: 'warn', accountId: 'a', code: 'new_window_blocked', safeMessage: '原生拒绝新窗口' }];
    const before = JSON.stringify(snapshot);
    expect(accountRequestNotice(snapshot, 'a')).toContain('标签关闭不代表连接成功');
    expect(JSON.stringify(snapshot)).toBe(before);
    snapshot.accounts = [];
    expect(accountRequestNotice(snapshot, 'a')).toBe('');
  });
});

describe('标签与空态仅渲染快照，不合成认证结果', () => {
  it('只有现有 authentication 标签标识外部授权，不按 URL 判断', () => {
    expect(tabLabel(tab)).toBe('Muse');
    expect(tabLabel({ ...tab, purpose: 'authentication' })).toBe('Muse · 外部授权');
    expect(tabLabel({ ...tab, purpose: 'authentication', title: '', loadState: 'loading' })).toBe('正在加载… · 外部授权');
    expect(tabLabel({ ...tab, title: '' })).toBe('未命名网页');
  });

  it.each([true, false])('空态区分原页登录与账号内新标签，无标签不等于授权成功（hasTabs=%s）', hasTabs => {
    const html = browserEmptyState(hasTabs, true);
    expect(html).toContain('原标签');
    expect(html).toContain('电话/邮箱');
    expect(html).toContain('验证码');
    expect(html).toContain('两步验证');
    expect(html).toContain('连接第三方应用');
    expect(html).toContain('来源账号内的新标签');
    expect(html).toContain('可能自动关闭');
    expect(html).toContain('结果以 Muse 原页为准');
    expect(html).toContain('普通外链也在来源账号内打开标签');
    expect(html).not.toMatch(/当前仍受限|尚不支持|一律阻止|预期自动关闭/);
    expect(html).toContain('普通外链');
    expect(html).toContain('不代表连接成功');
    expect(html).toContain('data-action="open-muse"');
    expect(html).not.toContain('data-action="connected"');
  });

  it('未连接原生时空态按钮禁用，不创建假标签', () => {
    expect(browserEmptyState(false, false)).toMatch(/data-action="open-muse" disabled/);
  });
});

describe('账号标签条渲染', () => {
  it('仅渲染来源账号快照标签，不根据 opener 或 URL 猜认证用途，转义原生标题', () => {
    const snapshot = state();
    snapshot.tabs = [
      tab,
      { ...tab, id: 'popup-a', openerTabId: tab.id, title: '<外部页面>' },
      { ...tab, id: 'popup-b', accountId: 'b', openerTabId: 'parent-b', title: 'B 专属页面' },
    ];
    snapshot.runtimes = [{ accountId: 'a', lifecycle: 'active', sessionStatus: 'unknown', activeTabId: 'popup-a', protectionReasons: [] }];
    const before = JSON.stringify(snapshot);
    const html = accountTabStrip(snapshot, 'a');
    expect(html.match(/data-action="activate-tab"/g)).toHaveLength(2);
    expect(html).toContain('&lt;外部页面&gt;');
    expect(html).toMatch(/data-id="popup-a" aria-current="page"/);
    expect(html).not.toContain('popup-b');
    expect(html).not.toContain('B 专属页面');
    expect(html).not.toContain('· 外部授权');
    expect(accountTabStrip(snapshot, 'b')).toContain('B 专属页面');
    expect(accountTabStrip(snapshot, 'b')).not.toContain('popup-a');
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('标签自关闭后的空快照不渲染假标签，不把其他账号的 activeTabId 当作当前页', () => {
    const snapshot = state();
    snapshot.tabs = [{ ...tab, accountId: 'b' }];
    snapshot.runtimes = [{ accountId: 'a', lifecycle: 'active', sessionStatus: 'unknown', activeTabId: tab.id, protectionReasons: [] }];
    expect(accountTabStrip(snapshot, 'a')).toBe('');
    expect(accountTabStrip(snapshot, 'b')).not.toContain('aria-current="page"');
    snapshot.tabs = [];
    expect(accountTabStrip(snapshot, 'b')).toBe('');
    expect(accountTabStrip(null, 'a')).toBe('');
    expect(accountTabStrip(snapshot, null)).toBe('');
  });
});
