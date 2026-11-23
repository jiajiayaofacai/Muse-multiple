import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { accountName, navigationUrl, acceptSnapshot, workspaceCounts } from './workspace-state';

const snapshot = (revision: number): WorkspaceSnapshot => ({
  revision, accounts: [], tabs: [], runtimes: [], diagnostics: [], activeAccountId: null,
  gateStatus: 'pending',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15 },
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
  it('允许显式 http/https 和 M0 双来源测试端口', () => {
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
