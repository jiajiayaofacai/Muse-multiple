import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { accountMenuModel } from './account-menu';

const snapshot: WorkspaceSnapshot = {
  revision: 1,
  accounts: [{ id: 'a', name: 'A', note: '', lastUsedAt: 0 }, { id: 'b', name: 'B', note: '', lastUsedAt: 0 }],
  tabs: [{ id: 'tab-a', accountId: 'a', openerTabId: null, purpose: 'normal', title: 'Muse', displayUrl: 'https://muse.ai/', loadState: 'ready', canGoBack: false, canGoForward: false }],
  runtimes: [
    { accountId: 'a', lifecycle: 'active', sessionStatus: 'unknown', activeTabId: 'tab-a', protectionReasons: [] },
    { accountId: 'b', lifecycle: 'sleeping', sessionStatus: 'unknown', activeTabId: null, protectionReasons: [] },
  ],
  diagnostics: [], activeAccountId: 'a', gateStatus: 'synthetic',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } },
};

describe('账号菜单操作模型', () => {
  it('按稳定账号 ID 列出该账号操作，不依赖当前选择来定位目标', () => {
    const model = accountMenuModel(snapshot, 'a');
    expect(model?.account.id).toBe('a');
    expect(model?.tab?.id).toBe('tab-a');
    expect(model?.items.find(item => item.action === 'refresh-account')?.enabled).toBe(true);
    expect(model?.items.find(item => item.action === 'sleep-account')?.enabled).toBe(false);
  });
  it('休眠账号提供唤醒入口且不能误用其他账号标签', () => {
    const model = accountMenuModel(snapshot, 'b');
    expect(model?.items[0].label).toBe('唤醒并打开账号');
    expect(model?.tab).toBeUndefined();
    expect(model?.items.find(item => item.action === 'refresh-account')?.enabled).toBe(false);
  });
  it('不存在的账号不生成菜单', () => expect(accountMenuModel(snapshot, 'missing')).toBeNull());
});
