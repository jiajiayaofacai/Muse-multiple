import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { escapeHtml as esc, icon } from '../ui/markup';
import { lifecycleLabels, sessionLabels, workspaceCounts } from './workspace-state';

const heading = (eyebrow: string, title: string, note: string) => `<header class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div><span class="quiet-pill">${icon('shield')}${note}</span></header>`;

export function homePage(snapshot: WorkspaceSnapshot | null, ready: boolean): string {
  const accounts = [...(snapshot?.accounts ?? [])].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 6);
  return `<div class="page home-page">${heading('YOUR WORKSPACE', '首页', '本地档案 · 独立浏览资料')}
    <section class="hero"><div class="hero-copy"><span class="eyebrow">MUSE-MULTIPLE</span><h2>不同账号，各自的工作空间。</h2><p>从一个账号开始，按需打开网页。<br>账号资料独立管理，登录有效性仍由服务端决定。</p><button class="primary" data-action="add-account" ${ready ? '' : 'disabled'}>${icon('plus')}添加 Muse 账号</button></div><div class="hero-art" aria-hidden="true"><div class="art-card back"></div><div class="art-card front"><span class="art-avatar">M</span><i></i><i></i><small>独立档案 ${icon('shield')}</small></div></div></section>
    <div class="section-heading"><h2>最近使用</h2><span>不会在启动时自动加载网页</span></div>
    ${accounts.length ? `<div class="card-grid">${accounts.map(account => {
      const runtime = snapshot?.runtimes.find(item => item.accountId === account.id);
      return `<button class="recent-card" data-action="select-account" data-id="${esc(account.id)}" ${ready ? '' : 'disabled'}><span class="card-top"><span class="avatar">${esc(Array.from(account.name)[0] ?? 'M')}</span><small>${runtime ? lifecycleLabels[runtime.lifecycle] : '未打开'}</small></span><strong>${esc(account.name)}</strong><p>${runtime ? sessionLabels[runtime.sessionStatus] : '登录状态未验证'}</p><span class="card-footer">打开工作空间 ${icon('forward')}</span></button>`;
    }).join('')}</div>` : `<div class="home-empty">${icon('plus')}<strong>${snapshot ? '还没有账号档案' : '等待原生工作区连接'}</strong><p>${snapshot ? '点击上方按钮，为第一个账号填写名称。此处没有预置演示账号。' : '普通浏览器只展示应用壳；请通过 Tauri 桌面应用管理账号。'}</p></div>`}
    <div class="section-heading"><h2>工作台说明</h2></div>
    <div class="notice-row"><span class="notice-icon">${icon('shield')}</span><div><strong>原页登录与外部授权分开验证</strong><p>Muse 电话/邮箱 → 验证码 → 可选两步验证，在该账号原标签完成；页面就绪不等于已登录。连接第三方应用的外部授权使用来源账号内的新标签；授权后标签可能自动关闭，结果以 Muse 原页为准，标签关闭不代表连接成功。普通外链也在来源账号内打开标签，不自动转到系统浏览器。新窗口能力不是普通登录的前置条件，真实登录、第三方授权、账号隔离与重启恢复仍需实测。</p></div><button class="text-button" data-action="dashboard">查看仪表盘 ${icon('forward')}</button></div>
    <p class="home-foot">${icon('shield')}首次登录和安全验证由你完成。密码、验证码与会话凭据不进入工作台日志。</p></div>`;
}

export function dashboardPage(snapshot: WorkspaceSnapshot | null): string {
  const counts = workspaceCounts(snapshot);
  const metrics = [
    ['账号档案', counts?.accounts, '原生快照中的本地账号'],
    ['驻留账号', counts?.resident, '活跃 + 后台，不代表已登录'],
    ['休眠账号', counts?.sleeping, '仅依据原生生命周期'],
    ['网页标签', counts?.tabs, '原生快照中的账号内标签，不推断用途'],
  ];
  return `<div class="page">${heading('WORKSPACE OVERVIEW', '仪表盘', '真实状态 · 不推断登录')}
    <p class="page-intro">${snapshot ? `来自原生完整快照 · revision ${esc(snapshot.revision)}。` : '未连接原生快照，计数未知。'} 不虚构在线状态、额度或内存测量。Muse 电话/邮箱、验证码与可选两步验证在原标签完成，不以弹窗能力为前置条件。连接第三方应用的外部授权使用来源账号内的新标签；授权后标签可能自动关闭，结果以 Muse 原页为准，页面就绪或标签关闭不代表连接成功。普通外链也在来源账号内打开标签，不自动转到系统浏览器。真实登录、第三方授权与重启恢复仍需实测。</p>
    <div class="metric-grid">${metrics.map(([label, value, detail]) => `<article class="metric-card"><span>${label}</span><strong>${value ?? '—'}</strong><small>${detail}</small></article>`).join('')}</div>
    <div class="section-heading"><h2>账号运行状态</h2><span>会话与生命周期分别呈现</span></div>
    <div class="overview-table"><table><thead><tr><th>账号档案</th><th>生命周期</th><th>会话状态</th><th>标签</th></tr></thead><tbody>${snapshot?.accounts.length ? snapshot.accounts.map(account => {
      const runtime = snapshot.runtimes.find(item => item.accountId === account.id);
      return `<tr><td>${esc(account.name)}</td><td>${runtime ? lifecycleLabels[runtime.lifecycle] : '未打开'}</td><td>${runtime ? sessionLabels[runtime.sessionStatus] : '登录状态未验证'}</td><td>${snapshot.tabs.filter(tab => tab.accountId === account.id).length}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="table-empty">暂无可显示的账号状态</td></tr>'}</tbody></table></div>
    <div class="notice-row gate-status"><span class="notice-icon">${icon('shield')}</span><div><strong>原生状态</strong><p>${snapshot ? esc(snapshot.gateStatus) : '尚未收到原生状态。'} · 不代表真实 Muse 认证与免重复登录已验证。</p></div></div></div>`;
}

export function settingsPage(snapshot: WorkspaceSnapshot | null, updateStatus = '正在检查更新…'): string {
  const settings = snapshot?.settings ?? { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } };
  const cleanupPending = snapshot?.diagnostics.some(item => item.code === 'profile_cleanup_pending' && !snapshot.diagnostics.some(done => done.code === 'profile_cleanup_completed' && done.id > item.id)) ?? false;
  return `<div class="page settings-page">${heading('PREFERENCES', '设置', '保存于本机账号工作区')}
    <form class="settings-form settings-card">
      <div class="setting-row"><div><strong>关闭窗口</strong><p>退出窗口时直接退出；选择托盘时隐藏窗口并可从托盘恢复。</p></div><select name="closeBehavior" aria-label="关闭窗口行为"><option value="exit" ${settings.closeBehavior === 'exit' ? 'selected' : ''}>退出</option><option value="tray" ${settings.closeBehavior === 'tray' ? 'selected' : ''}>最小化到托盘</option></select></div>
      <div class="setting-row"><div><strong>主题</strong><p>界面外观偏好。</p></div><select name="theme" aria-label="主题"><option value="system" ${settings.theme === 'system' ? 'selected' : ''}>跟随系统</option><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>浅色</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>深色</option></select></div>
      <div class="setting-row"><div><strong>界面缩放</strong><p>工作台壳的显示比例。</p></div><select name="uiZoomPercent" aria-label="界面缩放">${[75, 80, 90, 100, 110, 125, 150, 175, 200].map(value => `<option value="${value}" ${settings.uiZoomPercent === value ? 'selected' : ''}>${value}%</option>`).join('')}</select></div>
      <div class="setting-row"><div><strong>网页缩放</strong><p>网页视图显示比例。</p></div><select name="webZoomPercent" aria-label="网页缩放">${[50, 75, 80, 90, 100, 110, 125, 150, 175, 200].map(value => `<option value="${value}" ${settings.webZoomPercent === value ? 'selected' : ''}>${value}%</option>`).join('')}</select></div>
      <div class="setting-row"><div><strong>账号网页代理</strong><p>仅用于账号网页，不修改系统代理，也不影响更新检查。保存后请完全退出并重启工作台，以便所有账号采用新设置；不会主动关闭标签。</p></div><label><input type="checkbox" name="proxyEnabled" ${settings.proxy.enabled ? 'checked' : ''}> 启用</label></div>
      <div class="setting-row proxy-fields"><div><strong>代理地址</strong><p>填写主机和端口，或粘贴完整的 http://、https:// 或 socks5:// 地址。HTTPS 表示到代理服务器使用 TLS；不支持代理账号密码。</p></div><div class="proxy-controls"><select name="proxyScheme" aria-label="代理协议"><option value="http" ${settings.proxy.scheme === 'http' ? 'selected' : ''}>HTTP CONNECT</option><option value="https" ${settings.proxy.scheme === 'https' ? 'selected' : ''}>HTTPS（TLS代理）</option><option value="socks5" ${settings.proxy.scheme === 'socks5' ? 'selected' : ''}>SOCKS5</option></select><input name="proxyHost" aria-label="代理主机或完整地址" placeholder="https://proxy.example.com:443" autocomplete="off" spellcheck="false" value="${esc(settings.proxy.host)}"><input name="proxyPort" aria-label="代理端口" type="number" min="1" max="65535" placeholder="端口" value="${settings.proxy.port || ''}"></div></div>
      <div class="setting-row"><div><strong>后台自动休眠</strong><p>仅无打开标签的后台账号可自动休眠；有网页时保守保留。</p></div><select name="autoSleepMinutes" aria-label="后台自动休眠"><option value="0" ${settings.autoSleepMinutes === 0 ? 'selected' : ''}>关闭</option><option value="5" ${settings.autoSleepMinutes === 5 ? 'selected' : ''}>5 分钟</option><option value="15" ${settings.autoSleepMinutes === 15 ? 'selected' : ''}>15 分钟</option><option value="30" ${settings.autoSleepMinutes === 30 ? 'selected' : ''}>30 分钟</option></select></div>
      <div class="setting-row"><div><strong>自动检查更新</strong><p>每次启动时检查 GitHub 正式版；不会自动下载或安装。</p><small id="update-status" class="update-status" role="status">${esc(updateStatus)}</small></div><div class="update-actions"><button type="button" class="secondary" data-action="check-updates" ${snapshot ? '' : 'disabled'}>立即检查</button><button type="button" class="text-button" data-action="open-releases" ${snapshot ? '' : 'disabled'}>查看发布页</button></div></div>
      <footer class="settings-actions"><span class="settings-save-status" role="status"></span><button class="primary" type="submit">保存设置</button></footer>
    </form>
    ${cleanupPending ? '<section class="settings-card"><p>有账号浏览资料清理未完成；相关账号元数据已提交。可重试清理已移出账号列表的暂存资料。</p><button class="secondary" data-action="retry-profile-cleanup">重试资料清理</button></section>' : ''}
    <div class="section-heading"><h2>当前功能边界</h2></div><section class="settings-card"><p class="boundary-copy">账号创建、名称与备注编辑、名称/备注搜索、原生网页标签、固定项目外链、本机设置保存、安全诊断和单账号资料删除已接入。历史按钮提交页面前进/后退请求，不显示可靠的引擎历史可用性。页面就绪不代表认证成功，真实账号隔离、第三方授权与会话恢复须单独验收。</p></section></div>`;
}
