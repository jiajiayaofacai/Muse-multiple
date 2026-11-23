import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { escapeHtml as esc, icon } from '../ui/markup';
import { lifecycleLabels, sessionLabels, workspaceCounts } from './workspace-state';

const heading = (eyebrow: string, title: string, note: string) => `<header class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div><span class="quiet-pill">${icon('shield')}${note}</span></header>`;

export function homePage(snapshot: WorkspaceSnapshot | null, ready: boolean): string {
  const accounts = [...(snapshot?.accounts ?? [])].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 6);
  return `<div class="page home-page">${heading('YOUR WORKSPACE', '首页', '本地档案 · 独立浏览资料')}
    <section class="hero"><div class="hero-copy"><span class="eyebrow">MUSE-MULTIPLE / M0</span><h2>不同账号，各自的工作空间。</h2><p>从一个账号开始，按需打开网页。<br>账号资料独立管理，登录有效性仍由服务端决定。</p><button class="primary" data-action="add-account" ${ready ? '' : 'disabled'}>${icon('plus')}添加 Muse 账号</button></div><div class="hero-art" aria-hidden="true"><div class="art-card back"></div><div class="art-card front"><span class="art-avatar">M</span><i></i><i></i><small>独立档案 ${icon('shield')}</small></div></div></section>
    <div class="section-heading"><h2>最近使用</h2><span>不会在启动时自动加载网页</span></div>
    ${accounts.length ? `<div class="card-grid">${accounts.map(account => {
      const runtime = snapshot?.runtimes.find(item => item.accountId === account.id);
      return `<button class="recent-card" data-action="select-account" data-id="${esc(account.id)}" ${ready ? '' : 'disabled'}><span class="card-top"><span class="avatar">${esc(Array.from(account.name)[0] ?? 'M')}</span><small>${runtime ? lifecycleLabels[runtime.lifecycle] : '未打开'}</small></span><strong>${esc(account.name)}</strong><p>${runtime ? sessionLabels[runtime.sessionStatus] : '登录状态未验证'}</p><span class="card-footer">打开工作空间 ${icon('forward')}</span></button>`;
    }).join('')}</div>` : `<div class="home-empty">${icon('plus')}<strong>${snapshot ? '还没有账号档案' : '等待原生工作区连接'}</strong><p>${snapshot ? '点击上方按钮，为第一个账号填写名称。此处没有预置演示账号。' : '普通浏览器只展示应用壳；请通过 Tauri 桌面应用管理账号。'}</p></div>`}
    <div class="section-heading"><h2>当前阶段</h2><span>M0 · 工程与关键验证</span></div>
    <div class="notice-row"><span class="notice-icon">${icon('shield')}</span><div><strong>原页登录与外部授权分开验证</strong><p>Muse 电话/邮箱 → 验证码 → 可选两步验证，在该账号原标签完成；页面就绪不等于已登录。连接第三方应用会打开外部授权新标签，完成后预期自动关闭并由 Muse 原页显示连接结果。外部授权或普通外链的新窗口请求当前仍受限；新窗口能力不是普通登录的前置条件，账号隔离与重启恢复仍需实测。</p></div><button class="text-button" data-action="dashboard">查看仪表盘 ${icon('forward')}</button></div>
    <p class="home-foot">${icon('shield')}首次登录和安全验证由你完成。密码、验证码与会话凭据不进入工作台日志。</p></div>`;
}

export function dashboardPage(snapshot: WorkspaceSnapshot | null): string {
  const counts = workspaceCounts(snapshot);
  const metrics = [
    ['账号档案', counts?.accounts, '原生快照中的本地账号'],
    ['驻留账号', counts?.resident, '活跃 + 后台，不代表已登录'],
    ['休眠账号', counts?.sleeping, '仅依据原生生命周期'],
    ['网页标签', counts?.tabs, '普通网页 + 已有外部授权标签'],
  ];
  return `<div class="page">${heading('WORKSPACE OVERVIEW', '仪表盘', '真实状态 · 不推断登录')}
    <p class="page-intro">${snapshot ? `来自原生完整快照 · revision ${esc(snapshot.revision)}。` : '未连接原生快照，计数未知。'} 不虚构在线状态、额度或内存测量。Muse 电话/邮箱、验证码与可选两步验证在原标签完成，不以弹窗能力为前置条件。连接第三方应用使用外部授权新标签，完成后预期自动关闭，由 Muse 原页显示连接结果；外部授权或普通外链的新窗口请求当前仍受限，标签关闭不代表连接成功。</p>
    <div class="metric-grid">${metrics.map(([label, value, detail]) => `<article class="metric-card"><span>${label}</span><strong>${value ?? '—'}</strong><small>${detail}</small></article>`).join('')}</div>
    <div class="section-heading"><h2>账号运行状态</h2><span>会话与生命周期分别呈现</span></div>
    <div class="overview-table"><table><thead><tr><th>账号档案</th><th>生命周期</th><th>会话状态</th><th>标签</th></tr></thead><tbody>${snapshot?.accounts.length ? snapshot.accounts.map(account => {
      const runtime = snapshot.runtimes.find(item => item.accountId === account.id);
      return `<tr><td>${esc(account.name)}</td><td>${runtime ? lifecycleLabels[runtime.lifecycle] : '未打开'}</td><td>${runtime ? sessionLabels[runtime.sessionStatus] : '登录状态未验证'}</td><td>${snapshot.tabs.filter(tab => tab.accountId === account.id).length}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="table-empty">暂无可显示的账号状态</td></tr>'}</tbody></table></div>
    <div class="notice-row gate-status"><span class="notice-icon">${icon('shield')}</span><div><strong>M0 技术闸门</strong><p>${snapshot ? esc(snapshot.gateStatus) : '尚未收到原生状态。'} · 不代表真实 Muse 认证与免重复登录已验证。</p></div></div></div>`;
}

export function settingsPage(snapshot: WorkspaceSnapshot | null): string {
  return `<div class="page settings-page">${heading('PREFERENCES', '设置', '后续阶段接入')}
    <p class="page-intro">以下是执行计划中的默认值与候选项。M0 不提供设置保存，也不会据此自动休眠或隐藏到托盘。</p>
    <section class="settings-card"><div class="setting-row"><div><strong>自动休眠</strong><p>计划默认 15 分钟；候选：关闭 / 5 / 15 / 30 分钟。活跃账号不自动休眠。</p></div><span class="setting-value">15 分钟 · 计划默认</span></div>
    <div class="setting-row"><div><strong>关闭窗口</strong><p>默认退出；最小化到系统托盘为候选能力，后续阶段接入。</p></div><span class="setting-value">退出 / 托盘（候选）</span></div>
    <div class="setting-row"><div><strong>主题与独立缩放</strong><p>计划支持跟随系统、浅色、深色；界面和网页缩放分开控制。</p></div><span class="setting-value">后续阶段接入</span></div></section>
    <p class="settings-note">${icon('shield')}此页为只读说明，不存在“保存成功”的模拟行为。${snapshot ? ` 原生快照报告的 autoSleepMinutes：${esc(snapshot.settings.autoSleepMinutes)}（不据此承诺休眠能力）。` : ''}</p>
    <div class="section-heading"><h2>M0 功能边界</h2></div><section class="settings-card"><p class="boundary-copy">本阶段提供命名创建账号、原生网页标签与导航、完整状态快照和安全诊断。改名、删除、托盘、自动休眠与设置持久化均留待后续阶段；认证与资料隔离必须单独验收。</p></section></div>`;
}
