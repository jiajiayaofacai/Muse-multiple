import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { accountName, navigationUrl, acceptSnapshot, workspaceCounts, accountNewWindowDiagnostic } from './workspace-state';

const snapshot = (revision: number): WorkspaceSnapshot => ({
  revision, accounts: [], tabs: [], runtimes: [], diagnostics: [], activeAccountId: null,
  gateStatus: 'pending',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } },
});

describe('账号名称', () => {
  it('去除首尾空白，保留中文与内部空格', () => {
    expect(accountName('  我的 Muse 账号 \n')).toEqual({ ok: true, value: '我的 Muse 账号' });
  });
  it('拒绝空名称，不用默认名称偷偷创建', () => {
    expect(accountName(' \n\t').ok).toBe(false);
    expect(accountName('').ok).toBe(false);
  });
  it('允许同名；名称不作为存储身份', () => {
    expect(accountName('同名')).toEqual(accountName(' 同名 '));
  });
});

describe('地址输入', () => {
  it('允许显式 http/https 和双来源测试端口', () => {
    expect(navigationUrl(' https://muse.ai ')).toEqual({ ok: true, value: 'https://muse.ai/' });
    expect(navigationUrl('http://127.0.0.1:4317').ok).toBe(true);
    expect(navigationUrl('http://127.0.0.1:4318').ok).toBe(true);
  });
  it.each(['', 'muse.ai', 'https:example.com', 'http:/example.com', 'javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test', 'tauri://localhost', 'ftp://example.com', 'https://', 'http://user:secret@example.com'])('拒绝非网页地址或含凭据地址：%s', value => {
    expect(navigationUrl(value).ok).toBe(false);
  });
});

describe('完整快照 revision', () => {
  it('接收首次快照（包括 revision 0）', () => {
    const first = snapshot(0);
    expect(acceptSnapshot(null, first)).toBe(first);
  });
  it('丢弃迟到和相同 revision，事件先于 snapshot 响应也不回退', () => {
    const current = snapshot(4);
    expect(acceptSnapshot(current, snapshot(3))).toBe(current);
    expect(acceptSnapshot(current, snapshot(4))).toBe(current);
    expect(acceptSnapshot(current, snapshot(5)).revision).toBe(5);
  });
  it('新快照替换而非合并，删除的账号/标签不会复活', () => {
    const old = snapshot(1);
    old.accounts.push({ id: 'a', name: 'A', note: '', lastUsedAt: 0 });
    const next = snapshot(2);
    expect(acceptSnapshot(old, next).accounts).toEqual([]);
  });
  it('离线无快照时计数未知，不冒充真实零账号', () => {
    expect(workspaceCounts(null)).toBeNull();
    expect(workspaceCounts(snapshot(0))).toEqual({ accounts: 0, resident: 0, sleeping: 0, tabs: 0 });
  });
  it('驻留只计算 active/background，不把未打开账号计入', () => {
    const state = snapshot(1);
    state.runtimes = ['active', 'background', 'sleeping', 'unopened'].map((lifecycle, index) => ({
      accountId: String(index), lifecycle: lifecycle as WorkspaceSnapshot['runtimes'][number]['lifecycle'],
      sessionStatus: 'unknown', activeTabId: null, protectionReasons: [],
    }));
    expect(workspaceCounts(state)?.resident).toBe(2);
    expect(workspaceCounts(state)?.sleeping).toBe(1);
  });
});

describe('账号新窗口受限诊断', () => {
  const withAccounts = (): WorkspaceSnapshot => ({
    ...snapshot(5),
    accounts: ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), note: '', lastUsedAt: 0 })),
    diagnostics: [
      { id: 3, timestamp: 30, level: 'warn', accountId: 'b', code: 'new_window_blocked', safeMessage: 'B 请求受限' },
      { id: 1, timestamp: 10, level: 'warn', accountId: 'a', code: 'new_window_blocked', safeMessage: 'A 较早请求受限' },
      { id: 4, timestamp: 40, level: 'info', accountId: 'a', code: 'login_verification_pending', safeMessage: '待验证' },
      { id: 2, timestamp: 20, level: 'warn', accountId: 'a', code: 'new_window_blocked', safeMessage: 'A 最近请求受限' },
      { id: 5, timestamp: 50, level: 'warn', accountId: null, code: 'new_window_blocked', safeMessage: '无来源记录' },
    ],
  });

  it('仅按来源账号选择最新受限事件，不把 B 的事件显示给 A', () => {
    const state = withAccounts();
    expect(accountNewWindowDiagnostic(state, 'a')?.id).toBe(2);
    expect(accountNewWindowDiagnostic(state, 'b')?.id).toBe(3);
    expect(state.diagnostics.map(item => item.id)).toEqual([3, 1, 4, 2, 5]);
  });

  it('混合历史拒绝与创建失败时按事件编号选最新，隔离后台账号与无来源事件', () => {
    const state = withAccounts();
    state.diagnostics.push(
      { id: 6, timestamp: 60, level: 'error', accountId: 'a', code: 'new_window_failed', safeMessage: 'A 创建失败' },
      { id: 8, timestamp: 80, level: 'error', accountId: 'b', code: 'new_window_failed', safeMessage: 'B 创建失败' },
      { id: 9, timestamp: 90, level: 'error', accountId: null, code: 'new_window_failed', safeMessage: '无来源失败' },
      { id: 10, timestamp: 100, level: 'info', accountId: 'a', code: 'page_ready', safeMessage: '页面就绪' },
    );
    state.activeAccountId = 'b';
    expect(accountNewWindowDiagnostic(state, 'a')?.id).toBe(6);
    expect(accountNewWindowDiagnostic(state, 'b')?.id).toBe(8);
    state.diagnostics.unshift({ id: 7, timestamp: 5, level: 'warn', accountId: 'a', code: 'new_window_blocked', safeMessage: 'A 最近拒绝' });
    expect(accountNewWindowDiagnostic(state, 'a')?.id).toBe(7);
  });

  it('新标签 ready 和关闭后的完整快照只更新标签，不合成会话或成功通知', () => {
    const current = withAccounts();
    current.runtimes = [{ accountId: 'a', lifecycle: 'active', sessionStatus: 'reauthRequired', activeTabId: 'popup', protectionReasons: [] }];
    const ready = { ...current, revision: 6, tabs: [{
      id: 'popup', accountId: 'a', openerTabId: 'parent', purpose: 'normal' as const,
      title: '外部页面', displayUrl: 'https://example.test/oauth', loadState: 'ready' as const, canGoBack: false, canGoForward: false,
    }] };
    const accepted = acceptSnapshot(current, ready);
    expect(accepted.runtimes[0].sessionStatus).toBe('reauthRequired');
    expect(accepted.diagnostics).toEqual(current.diagnostics);
    const closed = acceptSnapshot(accepted, { ...ready, revision: 7, tabs: [], runtimes: [{ ...ready.runtimes[0], activeTabId: null }] });
    expect(closed.tabs).toEqual([]);
    expect(closed.runtimes[0].sessionStatus).toBe('reauthRequired');
    expect(closed.diagnostics).toEqual(current.diagnostics);
  });

  it('无快照、无选择、无归属事件或已移除来源账号时不展示', () => {
    const state = withAccounts();
    expect(accountNewWindowDiagnostic(null, 'a')).toBeNull();
    expect(accountNewWindowDiagnostic(state, null)).toBeNull();
    expect(accountNewWindowDiagnostic(state, 'removed')).toBeNull();
    state.accounts = state.accounts.filter(account => account.id !== 'a');
    expect(accountNewWindowDiagnostic(state, 'a')).toBeNull();
    state.diagnostics = state.diagnostics.filter(item => item.accountId !== 'b');
    expect(accountNewWindowDiagnostic(state, 'b')).toBeNull();
  });

  it('来源标签已关闭或视图未驻留时仍是该账号的历史事件，而非连接成功', () => {
    const state = withAccounts();
    state.tabs = [];
    state.runtimes = [{ accountId: 'a', lifecycle: 'sleeping', sessionStatus: 'unknown', activeTabId: null, protectionReasons: [] }];
    expect(accountNewWindowDiagnostic(state, 'a')?.safeMessage).toBe('A 最近请求受限');
    expect(state.runtimes[0].sessionStatus).toBe('unknown');
  });

  it('迟到和相同 revision 只由 acceptSnapshot 拒绝，不回滚受限提示', () => {
    const current = withAccounts();
    for (const revision of [4, 5]) {
      const incoming = { ...withAccounts(), revision, diagnostics: [] };
      const accepted = acceptSnapshot(current, incoming);
      expect(accepted).toBe(current);
      expect(accountNewWindowDiagnostic(accepted, 'a')?.id).toBe(2);
    }
    expect(accountNewWindowDiagnostic(acceptSnapshot(current, snapshot(6)), 'a')).toBeNull();
  });
});
