import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { dashboardPage, homePage } from './pages';

const snapshot: WorkspaceSnapshot = {
  revision: 1, accounts: [], tabs: [], runtimes: [], diagnostics: [], activeAccountId: null,
  gateStatus: '任意后端说明，不是登录或连接成功信号',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } },
};

describe('登录与外部授权基线文案', () => {
  it('首页区分原页电话/邮箱、验证码、两步验证与连接应用的新标签', () => {
    const html = homePage(snapshot, true);
    expect(html).toContain('电话/邮箱');
    expect(html).toContain('验证码');
    expect(html).toContain('两步验证');
    expect(html).toContain('原标签');
    expect(html).toContain('连接第三方应用');
    expect(html).toContain('新标签');
    expect(html).toContain('普通外链');
    expect(html).toContain('来源账号内的新标签');
    expect(html).toContain('可能自动关闭');
    expect(html).toContain('结果以 Muse 原页为准');
    expect(html).toContain('普通外链也在来源账号内打开标签');
    expect(html).not.toMatch(/当前仍受限|尚不支持|一律阻止|预期自动关闭/);
    expect(html).not.toContain('同窗认证');
  });

  it('仪表盘保留原始 gateStatus 说明但不解析为成功，明确普通登录不以前置弹窗为条件', () => {
    const html = dashboardPage(snapshot);
    expect(html).toContain(snapshot.gateStatus);
    expect(html).toContain('原标签');
    expect(html).toContain('外部授权');
    expect(html).toContain('不以弹窗能力为前置条件');
    expect(html).toContain('不代表连接成功');
    expect(html).toContain('来源账号内的新标签');
    expect(html).toContain('可能自动关闭');
    expect(html).toContain('结果以 Muse 原页为准');
    expect(html).toContain('普通外链也在来源账号内打开标签');
    expect(html).not.toMatch(/当前仍受限|尚不支持|一律阻止|预期自动关闭/);
    expect(html).not.toContain('包含正常页和认证页');
  });

  it('未连接原生时仍保留原页登录说明，不显示假账号或成功状态', () => {
    const html = homePage(null, false);
    expect(html).toContain('原标签');
    expect(html).toContain('等待原生工作区连接');
    expect(html).not.toContain('>已登录<');
  });
});
describe('阶段标记文案', () => {
  it('首页和仪表盘不显示内部阶段编号，保留真实验证说明', () => {
    const home = homePage(snapshot, true);
    const dashboard = dashboardPage(snapshot);
    expect(home + dashboard).not.toMatch(/M0/i);
    expect(home).toContain('真实登录、第三方授权、账号隔离与重启恢复仍需实测');
    expect(dashboard).toContain('不代表真实 Muse 认证与免重复登录已验证');
  });
});
