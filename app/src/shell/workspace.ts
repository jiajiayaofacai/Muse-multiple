import type { SettingsDto, TabDto, WorkspaceAction, WorkspaceSnapshot } from '../../contracts/workspace';
import { NativeBridge, safeError } from '../bridge/native';
import { NativeLayout } from '../bridge/layout';
import { accountMetadata, acceptSnapshot, navigationUrl } from '../features/workspace-state';
import { dashboardPage, homePage, settingsPage } from '../features/pages';
import { accountRequestNotice, accountTabStrip, browserEmptyState } from '../features/browser-content';
import { parseProxyEndpoint } from '../features/proxy-settings';
import { checkLatestRelease } from '../features/update';
import { accountMenuModel, attachAccountMenu } from './account-menu';
import { escapeHtml as esc, icon } from '../ui/markup';
import './workspace.css';

type Route = 'home' | 'dashboard' | 'settings' | 'account';

export async function mountWorkspace(root: HTMLElement): Promise<() => void> {
  const bridge = new NativeBridge();
  let snapshot: WorkspaceSnapshot | null = null;
  // Deliberately not restored from activeAccountId or browser storage on cold start.
  let route: Route = 'home';
  let selectedAccountId: string | null = null;
  let ready = false;
  let busy = false;
  let disposed = false;
  let accountsExpanded = true;
  let consoleOpen = false;
  let layoutNotice: string | null = null;
  let clearedThrough = -1;
  let consoleLevel = 'all';
  let lastAddressTab: string | null = null;
  let openingDialog = false;
  let returnFocus: HTMLElement | null = null;
  let accountSearch = '';
  let dialogKind: 'account' | 'tab' | 'edit-account' = 'account';
  let editingAccountId: string | null = null;
  let updateStatus = '等待检查';
  let checkingUpdates = false;

  root.innerHTML = `<div class="workspace-shell">
    <header class="topbar"><button class="brand" data-action="home" aria-label="Muse-multiple 首页"><span class="brand-mark">M</span><span>Muse<span class="brand-light">-multiple</span></span></button>
      <nav class="top-actions" aria-label="工作台工具"><button data-action="dashboard" class="top-link" title="查看工作台运行快照">${icon('dashboard')}仪表盘</button><button data-action="console" class="top-link" aria-expanded="false" aria-controls="workspace-console" title="查看脱敏原生诊断">${icon('terminal')}控制台</button><span class="top-divider"></span><button data-action="docs" class="top-link" disabled title="通过受限原生接口打开项目使用文档">${icon('book')}使用文档</button><button data-action="github" class="top-link" disabled title="通过受限原生接口打开项目 GitHub">GitHub ${icon('external')}</button></nav></header>
    <aside class="sidebar" aria-label="主导航"><div id="account-menu" class="account-menu" role="menu" hidden></div></aside>
    <main class="workspace"><div class="connection-banner" role="status"></div><div class="error-banner" role="alert" hidden><span></span><button data-action="dismiss-error" class="icon-button" aria-label="关闭错误提示">${icon('close')}</button></div>
      <section class="page-view" aria-label="工作区"></section>
      <section class="browser-view" aria-label="原生网页工作区" hidden>
        <div class="tabbar"><div class="tabs" aria-label="网页标签"></div><button class="icon-button new-tab" data-action="new-tab" aria-label="新建标签" title="新建标签">${icon('plus')}</button><button class="text-button close-all-tabs" data-action="close-all-tabs" title="关闭当前账号全部标签">关闭全部</button></div>
        <div class="browser-toolbar"><button class="icon-button" data-action="back" aria-label="返回" title="返回">${icon('back')}</button><button class="icon-button" data-action="forward" aria-label="前进" title="前进">${icon('forward')}</button><button class="icon-button" data-action="reload" aria-label="刷新" title="刷新">${icon('reload')}</button><button class="icon-button" data-action="stop" aria-label="停止加载" title="停止加载">${icon('stop')}</button>
          <form class="address-form"><span>${icon('globe')}</span><input name="address" aria-label="网页地址" placeholder="输入 http:// 或 https:// 地址" autocomplete="off" spellcheck="false"><button type="submit" aria-label="前往地址">${icon('forward')}</button></form><span class="load-status" aria-live="polite"></span></div>
        <div class="account-notice connection-banner" role="status" aria-live="polite" hidden></div>
        <div class="native-slot" data-testid="native-slot"><div class="slot-placeholder"></div></div>
      </section>
      <section id="workspace-console" class="console" aria-label="工作台控制台" hidden><header class="console-head"><strong>${icon('terminal')}控制台</strong><span>仅显示原生安全诊断</span><div class="console-tools"><label>级别 <select aria-label="筛选诊断级别"><option value="all">全部</option><option value="error">错误</option><option value="warn">警告</option><option value="info">信息</option></select></label><button class="text-button" data-action="clear-console">清空视图</button><button class="icon-button" data-action="console" aria-label="收起控制台">${icon('close')}</button></div></header><div class="logs" role="log" aria-live="off"></div><footer>最多显示最近 200 条 · 清空仅影响当前视图，不删除原生记录</footer></section>
    </main></div><dialog class="workspace-dialog" aria-labelledby="dialog-title"></dialog>`;

  const find = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`工作台静态节点缺失：${selector}`);
    return element;
  };
  const shell = find('.workspace-shell');
  const sidebar = find('.sidebar');
  const page = find('.page-view');
  const browser = find('.browser-view');
  const slot = find('.native-slot');
  const placeholder = find('.slot-placeholder');
  const accountNotice = find('.account-notice');
  const tabs = find('.tabs');
  const address = find<HTMLInputElement>('.address-form input');
  const consolePanel = find('.console');
  const logs = find('.logs');
  const dialog = find<HTMLDialogElement>('dialog');
  const connection = find('.connection-banner');
  const errorBanner = find('.error-banner');
  const layout = new NativeLayout(slot, bounds => bridge.layout(bounds), showLayoutError);
  const accountMenu = attachAccountMenu(sidebar, id => accountMenuModel(snapshot, id));

  function showError(error: unknown): void {
    if (disposed) return;
    errorBanner.querySelector('span')!.textContent = safeError(error);
    errorBanner.hidden = false;
  }
  function showLayoutError(error: unknown): void {
    if (disposed) return;
    if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid_layout') {
      layoutNotice = '原生网页布局校验未通过；请查看控制台诊断。未读取页面内容。';
      errorBanner.hidden = true;
      if (consoleOpen) renderConsole();
      return;
    }
    showError(error);
  }
  function currentTab(): TabDto | undefined {
    const runtime = snapshot?.runtimes.find(item => item.accountId === selectedAccountId);
    return snapshot?.tabs.find(tab => tab.id === runtime?.activeTabId && tab.accountId === selectedAccountId);
  }

  function syncLayout(): void {
    const visible = ready && route === 'account' && snapshot?.activeAccountId === selectedAccountId
      && !!currentTab() && !dialog.open && !openingDialog;
    void layout.setVisible(visible).catch(showLayoutError);
  }

  function receive(incoming: WorkspaceSnapshot): void {
    if (disposed) return;
    const next = acceptSnapshot(snapshot, incoming);
    if (next === snapshot) return;
    snapshot = next;
    if (selectedAccountId && !snapshot.accounts.some(account => account.id === selectedAccountId)) {
      selectedAccountId = null;
      route = 'home';
    }
    render();
  }


  let composingAccountSearch = false;

  function accountRowsMarkup(): string {
    const selected = route === 'account' ? selectedAccountId : null;
    const accounts = snapshot?.accounts ?? [];
    const search = accountSearch.trim().toLocaleLowerCase();
    const visibleAccounts = (accountsExpanded ? accounts : accounts.filter(account => account.id === selected))
      .filter(account => !search || `${account.name}\n${account.note}`.toLocaleLowerCase().includes(search));
    return `${visibleAccounts.map(account => {
      const isSelected = account.id === selected;
      return `<div class="account-item"><button class="account-row ${isSelected ? 'active' : ''}" data-action="select-account" data-id="${esc(account.id)}" title="${esc(account.name)}${isSelected ? ' · 当前账号' : ''}" ${ready ? '' : 'disabled'} ${isSelected ? 'aria-current="page"' : ''}><span class="avatar">${esc(Array.from(account.name)[0] ?? 'M')}</span><span class="account-copy"><span class="account-name">${esc(account.name)}</span>${account.note ? `<small class="account-note">${esc(account.note)}</small>` : ''}</span>${isSelected ? '<span class="current-label">当前</span>' : ''}</button><button class="icon-button account-menu-trigger" data-action="account-menu" data-id="${esc(account.id)}" aria-label="${esc(account.name)} 的账号操作" aria-haspopup="menu" aria-expanded="false" title="更多账号操作" ${ready ? '' : 'disabled'}>${icon('more')}</button></div>`;
    }).join('')}${accounts.length && !visibleAccounts.length ? '<p class="sidebar-empty">没有匹配的账号</p>' : ''}${!accounts.length ? `<p class="sidebar-empty">${snapshot ? '尚无账号档案' : '等待原生连接'}</p>` : ''}`;
  }

  function renderSidebar(): void {
    if (composingAccountSearch && document.activeElement === sidebar.querySelector('.account-search')) return;
    const accounts = snapshot?.accounts ?? [];
    const menu = find<HTMLElement>('#account-menu');
    sidebar.innerHTML = `<button class="nav-button ${route === 'home' ? 'active' : ''}" data-action="home" ${route === 'home' ? 'aria-current="page"' : ''} title="首页">${icon('home')}<span class="nav-label">首页</span></button>
      <div class="account-group"><button class="group-toggle" data-action="toggle-accounts" aria-expanded="${accountsExpanded}" aria-controls="account-list"><span class="group-chevron ${accountsExpanded ? 'expanded' : ''}">${icon('chevron')}</span><span class="nav-label">对话 / 账号</span><span class="nav-count">${snapshot ? accounts.length : '—'}</span></button>
      ${accounts.length ? `<input class="account-search" aria-label="搜索账号名称或备注" placeholder="搜索账号" value="${esc(accountSearch)}">` : ''}
      <div id="account-list" class="accounts">${accountRowsMarkup()}</div></div>
      <button class="nav-button add-nav" data-action="add-account" title="添加 Muse 账号${ready ? '' : '（需连接原生运行时）'}" ${ready ? '' : 'disabled'}>${icon('plus')}<span class="nav-label">添加 Muse 账号</span></button>
      <div class="sidebar-bottom"><button class="nav-button ${route === 'settings' ? 'active' : ''}" data-action="settings" ${route === 'settings' ? 'aria-current="page"' : ''} title="设置：管理工作台偏好">${icon('settings')}<span class="nav-label">设置</span></button><button class="nav-button collapse-button" data-action="collapse-sidebar" title="展开或收起侧栏" aria-label="展开或收起侧栏" aria-expanded="${!shell.classList.contains('compact')}">${icon('panel')}<span class="nav-label">收起侧栏</span></button></div>`;
    sidebar.append(menu);
    accountMenu.refresh();
  }

  function renderBrowser(): void {
    const accountTabs = snapshot?.tabs.filter(tab => tab.accountId === selectedAccountId) ?? [];
    const active = currentTab();
    tabs.innerHTML = accountTabStrip(snapshot, selectedAccountId);
    const notice = accountRequestNotice(snapshot, selectedAccountId);
    if (accountNotice.innerHTML !== notice) accountNotice.innerHTML = notice;
    accountNotice.hidden = !notice;
    if (lastAddressTab !== (active?.id ?? null) || document.activeElement !== address) {
      address.value = active?.displayUrl === 'about:blank' ? '' : active?.displayUrl ?? '';
    }
    lastAddressTab = active?.id ?? null;
    address.disabled = !ready || !selectedAccountId;
    find<HTMLButtonElement>('.address-form button[type="submit"]').disabled = address.disabled;
    find<HTMLButtonElement>('[data-action="close-all-tabs"]').disabled = !ready || !selectedAccountId || !accountTabs.length;
    find<HTMLButtonElement>('[data-action="back"]').disabled = !ready || !active;
    find<HTMLButtonElement>('[data-action="forward"]').disabled = !ready || !active;
    find<HTMLButtonElement>('[data-action="reload"]').disabled = !ready || !active;
    find<HTMLButtonElement>('[data-action="stop"]').disabled = !ready || active?.loadState !== 'loading';
    find<HTMLButtonElement>('[data-action="new-tab"]').disabled = !ready || !selectedAccountId;
    find('.load-status').textContent = active ? ({ loading: '加载中', ready: '页面就绪', error: '加载失败' })[active.loadState] : '无网页';
    placeholder.hidden = !!active && snapshot?.activeAccountId === selectedAccountId;
    if (!placeholder.hidden) placeholder.innerHTML = browserEmptyState(accountTabs.length > 0, ready);
  }


  function renderConsole(): void {
    const diagnostics = (snapshot?.diagnostics ?? []).filter(item => item.id > clearedThrough && (consoleLevel === 'all' || item.level === consoleLevel)).slice(-200);
    const rows = diagnostics.map(item => `<div class="log-row ${esc(item.level)}"><time>${esc(new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour12: false }))}</time><span class="log-level">${esc(item.level.toUpperCase())}</span><code>${esc(item.code)}</code><span>${esc(item.safeMessage)}</span></div>`);
    if (layoutNotice) rows.push(`<div class="log-row warn"><time>—</time><span class="log-level">WARN</span><code>layout_rejected</code><span>${esc(layoutNotice)}</span></div>`);
    logs.innerHTML = rows.length ? rows.join('') : '<p class="logs-empty">暂无符合条件的原生安全诊断。不会记录输入的地址、密码或验证码。</p>';
  }

  function render(): void {
    if (disposed) return;
    renderSidebar();
    const preferences = snapshot?.settings;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const theme = preferences?.theme === 'system' || !preferences ? (prefersDark ? 'dark' : 'light') : preferences.theme;
    shell.dataset.theme = theme;
    shell.style.colorScheme = theme;
    shell.style.zoom = preferences ? `${preferences.uiZoomPercent}%` : '100%';
    page.hidden = route === 'account';
    browser.hidden = route !== 'account';
    if (route === 'home') page.innerHTML = homePage(snapshot, ready);
    if (route === 'dashboard') page.innerHTML = dashboardPage(snapshot);
    if (route === 'settings') {
      page.innerHTML = settingsPage(snapshot, updateStatus);
      page.querySelector('.update-status')?.setAttribute('id', 'update-status');
      const check = page.querySelector<HTMLButtonElement>('[data-action="check-updates"]');
      if (check) check.disabled = !snapshot || checkingUpdates;
    }
    renderBrowser();
    find<HTMLButtonElement>('.top-actions [data-action="dashboard"]').classList.toggle('active', route === 'dashboard');
    for (const kind of ['docs', 'github']) {
      const button = find<HTMLButtonElement>(`.top-actions [data-action="${kind}"]`);
      button.disabled = !ready;
      button.title = ready ? '通过原生固定链接在系统浏览器打开' : '需连接原生运行时；不使用浏览器外链替代';
    }
    renderConsole();
    syncLayout();
  }

  async function perform(action: WorkspaceAction): Promise<boolean> {
    if (!ready || busy || disposed) return false;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    try {
      receive(await bridge.action(action));
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      busy = false;
      root.setAttribute('aria-busy', 'false');
    }
  }

  async function checkForUpdates(): Promise<void> {
    if (checkingUpdates) return;
    checkingUpdates = true;
    updateStatus = '正在检查 GitHub Releases…';
    const statusNode = updateStatusNode();
    if (statusNode) statusNode.textContent = updateStatus;
    updateButton()?.setAttribute('disabled', '');
    try {
      updateStatus = await checkLatestRelease();
    } catch {
      updateStatus = '检查更新失败，请稍后重试。';
    } finally {
      checkingUpdates = false;
      if (!disposed) {
        const statusNode = updateStatusNode();
        if (statusNode) statusNode.textContent = updateStatus;
        updateButton()?.removeAttribute('disabled');
      }
    }
  }

  function updateStatusNode(): HTMLElement | null { return page.querySelector('#update-status'); }
  function updateButton(): HTMLButtonElement | null { return page.querySelector<HTMLButtonElement>('[data-action="check-updates"]'); }

  async function navigatePage(next: Route): Promise<void> {
    if (busy || openingDialog) return;
    // Hide before local UI replaces the content area; a child WebView is not a DOM layer.
    try {
      await layout.setVisible(false);
      route = next;
      render();
    } catch (error) { showLayoutError(error); }
  }

  async function selectAccount(accountId: string): Promise<void> {
    if (!ready || busy || !snapshot?.accounts.some(account => account.id === accountId)) return;
    try {
      await layout.setVisible(false);
      if (await perform({ type: 'activateAccount', accountId })) {
        selectedAccountId = accountId;
        route = 'account';
      }
      render();
    } catch (error) { showLayoutError(error); }
  }
  async function openDialog(kind: 'account' | 'tab' | 'edit-account', accountId?: string): Promise<void> {
    if (!ready || busy || dialog.open || openingDialog) return;
    openingDialog = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      await layout.setVisible(false);
      if (disposed) return;
      editingAccountId = kind === 'edit-account' ? accountId ?? null : null;
      const editing = kind === 'edit-account';
      const account = editing ? snapshot?.accounts.find(item => item.id === editingAccountId) : undefined;
      const runtime = editing ? snapshot?.runtimes.find(item => item.accountId === editingAccountId) : undefined;
      if (editing && !account) return;
      dialogKind = kind;
      const initialName = editing ? account!.name : '';
      const initialNote = editing ? account!.note : '';
      const accountDialog = kind !== 'tab';
      dialog.innerHTML = `<form class="dialog-form" novalidate><header><span class="eyebrow">${accountDialog ? 'LOCAL ACCOUNT' : 'NEW TAB'}</span><button type="button" class="icon-button" data-action="close-dialog" aria-label="取消">${icon('close')}</button></header><h2 id="dialog-title">${editing ? '编辑账号' : accountDialog ? '添加 Muse 账号' : '新建网页标签'}</h2><p>${accountDialog ? '名称和备注保存在本地；修改不会更换此账号的浏览资料。' : '网页在当前账号的原生浏览资料中打开，仅支持 HTTP / HTTPS。'}</p><label for="dialog-input">${accountDialog ? '账号名称（必填）' : '网页地址（必填）'}</label><input id="dialog-input" name="value" ${accountDialog ? `value="${esc(initialName)}" placeholder="例如：工作账号"` : 'value="https://muse.ai/"'} autocomplete="off" spellcheck="false" aria-describedby="dialog-hint dialog-error" required>${accountDialog ? `<label for="dialog-note">备注（可选）</label><textarea id="dialog-note" name="note" maxlength="2000" rows="3" placeholder="仅用于本地辨认账号">${esc(initialNote)}</textarea>` : ''}<small id="dialog-hint">${accountDialog ? '同名允许；名称不影响独立资料的存储身份。' : '也可使用 http://127.0.0.1:4317 验证本地合成站点。'}</small><p id="dialog-error" class="input-error" role="alert"></p><footer>${editing && runtime?.lifecycle === 'background' ? '<button type="button" class="secondary" data-action="sleep-account">休眠账号</button>' : ''}${editing ? '<button type="button" class="danger-button" data-action="delete-account">删除此账号</button>' : ''}<button type="button" class="secondary" data-action="close-dialog">取消</button><button class="primary" type="submit">${editing ? '保存修改' : accountDialog ? '创建账号档案' : '打开标签'}</button></footer></form>`;
      dialog.showModal();
      find<HTMLInputElement>('#dialog-input').focus();
    } catch (error) { showLayoutError(error); }
    finally {
      openingDialog = false;
      syncLayout();
    }
  }

  async function openUrl(url: string): Promise<void> {
    if (!selectedAccountId) return;
    await perform({ type: 'createTab', accountId: selectedAccountId, url });
  }

  async function onClick(event: MouseEvent): Promise<void> {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled || !root.contains(button)) return;
    const action = button.dataset.action;
    if (action === 'home' || action === 'dashboard' || action === 'settings') return navigatePage(action);
    if (action === 'edit-account') return openDialog('edit-account', button.dataset.id ?? '');
    if (action === 'select-account') return selectAccount(button.dataset.id ?? '');
    if (action === 'retry-profile-cleanup') {
      if (!window.confirm('重试清理已从账号列表移除的暂存浏览资料？仍登记的账号资料不会被清理。')) return;
      await perform({ type: 'retryProfileCleanup' });
      return;
    }
    if (action === 'account-menu') return;
    if (button.closest('#account-menu') && button.dataset.action) {
      const id = button.dataset.id;
      const model = id ? accountMenuModel(snapshot, id) : null;
      accountMenu.close();
      if (!model || !id) return;
      if (action === 'open-account') return selectAccount(id);
      if (action === 'edit-account') return openDialog('edit-account', id);
      if (action === 'refresh-account' && model.tab) { await perform({ type: 'reload', accountId: id, tabId: model.tab.id }); return; }
      if (action === 'close-account-tabs' && window.confirm(`关闭「${model.account.name}」的全部网页标签？账号及浏览资料会保留。`)) { await perform({ type: 'closeAllTabs', accountId: id }); return; }
      if (action === 'sleep-account' && window.confirm(`休眠后台账号「${model.account.name}」会关闭它的全部网页标签，登录资料保留。继续？`)) { await perform({ type: 'sleepAccount', accountId: id, automatic: false }); return; }
      if (action === 'delete-account' && window.confirm(`永久删除账号「${model.account.name}」及其本地浏览资料？此操作不可撤销，其他账号不会受影响。`)) { await perform({ type: 'deleteAccount', accountId: id }); return; }
      return;
    }
    if (action === 'sleep-account' && editingAccountId) {
      const account = snapshot?.accounts.find(item => item.id === editingAccountId);
      if (!account) return;
      if (!window.confirm(`休眠账号「${account.name}」会关闭它的全部网页标签，未保存内容可能丢失。登录资料会保留；请仅在已切换到其他账号后操作。继续？`)) return;
      const slept = await perform({ type: 'sleepAccount', accountId: editingAccountId, automatic: false });
      if (slept) dialog.close();
      return;
    }
    if (action === 'delete-account' && editingAccountId) {
      if (!window.confirm(`永久删除账号「${snapshot?.accounts.find(account => account.id === editingAccountId)?.name ?? '当前账号'}」及其本地浏览资料？此操作不可撤销，其他账号不会受影响。`)) return;
      const removed = await perform({ type: 'deleteAccount', accountId: editingAccountId });
      if (removed) dialog.close();
      return;
    }
    if (action === 'add-account') return openDialog('account');
    if (action === 'new-tab') {
      await openUrl('about:blank');
      address.focus();
      return;
    }
    if (action === 'close-all-tabs' && selectedAccountId) {
      if (!window.confirm('关闭当前账号的所有网页标签？未保存的网页内容可能丢失。账号及其浏览资料不会删除。')) return;
      await layout.setVisible(false);
      await perform({ type: 'closeAllTabs', accountId: selectedAccountId });
      render();
      return;
    }
    if (action === 'close-dialog') { if (!busy) dialog.close(); return; }
    if (action === 'dismiss-error') { errorBanner.hidden = true; layout.schedule(); return; }
    if (action === 'console') {
      consoleOpen = !consoleOpen;
      consolePanel.hidden = !consoleOpen;
      const toggle = find<HTMLButtonElement>('.top-actions [data-action="console"]');
      toggle.setAttribute('aria-expanded', String(consoleOpen));
      toggle.classList.toggle('active', consoleOpen);
      // Never render/recreate the browser or native slot when toggling the console.
      layout.schedule();
      return;
    }
    if (action === 'clear-console') {
      clearedThrough = Math.max(clearedThrough, ...(snapshot?.diagnostics.map(item => item.id) ?? []));
      layoutNotice = null;
      renderConsole();
      return;
    }
    if (action === 'toggle-accounts') { accountsExpanded = !accountsExpanded; renderSidebar(); return; }
    if (action === 'collapse-sidebar') { shell.classList.toggle('compact'); renderSidebar(); layout.schedule(); return; }
    if (action === 'docs' || action === 'github') { await perform({ type: 'openProjectLink', kind: action }); return; }
    if (action === 'open-muse') return openUrl('https://muse.ai/');
    if (action === 'check-updates') { await checkForUpdates(); return; }
    if (action === 'open-releases') { await perform({ type: 'openProjectLink', kind: 'releases' }); return; }
    if (action === 'test-parent') return openUrl('http://127.0.0.1:4317');
    if (action === 'test-auth') return openUrl('http://127.0.0.1:4318');
    if (!selectedAccountId) return;
    if (action === 'activate-tab' || action === 'close-tab') {
      const tabId = button.dataset.id;
      if (!snapshot?.tabs.some(tab => tab.id === tabId && tab.accountId === selectedAccountId)) return;
      await perform({ type: action === 'activate-tab' ? 'activateTab' : 'closeTab', accountId: selectedAccountId, tabId: tabId! });
      return;
    }
    const tab = currentTab();
    if (tab && (action === 'back' || action === 'forward' || action === 'reload' || action === 'stop')) {
      await perform({ type: action, accountId: selectedAccountId, tabId: tab.id });
    }
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (form.matches('.address-form')) {
      if (!ready || busy || !selectedAccountId) return;
      const result = navigationUrl(address.value);
      if (!result.ok) { showError({ safeMessage: result.message }); return; }
      const tab = currentTab();
      if (tab) await perform({ type: 'navigate', accountId: selectedAccountId, tabId: tab.id, url: result.value });
      else await openUrl(result.value);
      return;
    }
    if (form.matches('.settings-form')) {
      if (!ready || busy) return;
      const field = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
      const proxyEnabled = (form.elements.namedItem('proxyEnabled') as HTMLInputElement).checked;
      const scheme = field('proxyScheme').value as SettingsDto['proxy']['scheme'];
      const host = field('proxyHost').value.trim();
      const port = (form.elements.namedItem('proxyPort') as HTMLInputElement).value.trim();
      const parsedProxy = proxyEnabled || host || port ? parseProxyEndpoint(scheme, host, port) : null;
      if (parsedProxy?.ok && host.includes('://')) {
        field('proxyScheme').value = parsedProxy.value.scheme;
        (form.elements.namedItem('proxyPort') as HTMLInputElement).value = '';
      }
      if (parsedProxy && !parsedProxy.ok) {
        find('.settings-save-status').textContent = parsedProxy.message;
        return;
      }
      const settings: SettingsDto = {
        closeBehavior: field('closeBehavior').value as SettingsDto['closeBehavior'],
        theme: field('theme').value as SettingsDto['theme'],
        uiZoomPercent: Number(field('uiZoomPercent').value),
        webZoomPercent: Number(field('webZoomPercent').value),
        autoSleepMinutes: Number(field('autoSleepMinutes').value),
        proxy: parsedProxy?.ok ? { ...parsedProxy.value, enabled: proxyEnabled } : { enabled: false, scheme, host: '', port: 0 },
      };
      if (await perform({ type: 'updateSettings', settings })) {
        find('.settings-save-status').textContent = '设置已保存到本机。';
      }
      return;
    }
    if (!form.matches('.dialog-form') || busy) return;
    const input = find<HTMLInputElement>('#dialog-input');
    const accountDialog = dialogKind !== 'tab';
    const metadata = accountDialog ? accountMetadata(input.value, find<HTMLTextAreaElement>('#dialog-note').value) : null;
    const navigation = dialogKind === 'tab' ? navigationUrl(input.value) : null;
    const error = find('#dialog-error');
    const invalid = metadata && !metadata.ok ? metadata : navigation && !navigation.ok ? navigation : null;
    if (invalid) {
      error.textContent = invalid.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.disabled = true;
    const action: WorkspaceAction | null = dialogKind === 'account' && metadata?.ok
      ? { type: 'createAccount', name: metadata.name, note: metadata.note }
      : dialogKind === 'edit-account' && metadata?.ok && editingAccountId
        ? { type: 'updateAccount', accountId: editingAccountId, name: metadata.name, note: metadata.note }
        : dialogKind === 'tab' && navigation?.ok && selectedAccountId
          ? { type: 'createTab', accountId: selectedAccountId, url: navigation.value }
          : null;
    const success = action ? await perform(action) : false;
    submit.disabled = false;
    if (success) dialog.close();
    else error.textContent = '操作未完成，未确认创建成功。请查看工作区错误提示后重试。';
  }

  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  const systemThemeChanged = () => { if (!snapshot || snapshot.settings.theme === 'system') render(); };
  systemTheme?.addEventListener('change', systemThemeChanged);
  const clickHandler = (event: MouseEvent) => { void onClick(event).catch(showError); };
  const submitHandler = (event: SubmitEvent) => { void onSubmit(event).catch(showError); };
  const consoleChangeHandler = (event: Event) => {
    consoleLevel = (event.target as HTMLSelectElement).value;
    renderConsole();
  };
  const inputHandler = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('.account-search')) {
      accountSearch = target.value;
      if (!composingAccountSearch) find('.accounts').innerHTML = accountRowsMarkup();
      return;
    }
    if (!(target instanceof HTMLInputElement) || target.id !== 'dialog-input' || dialogKind === 'tab') return;
    const value = target.value.trim();
    const duplicate = snapshot?.accounts.some(account => account.id !== editingAccountId && account.name === value);
    find('#dialog-hint').textContent = duplicate ? '已有同名账号；仍可保存，浏览资料仍按稳定 ID 独立存储。' : '同名允许；名称不影响独立资料的存储身份。';
  };
  const compositionStartHandler = (event: CompositionEvent) => {
    if ((event.target as Element).matches('.account-search')) composingAccountSearch = true;
  };
  const compositionEndHandler = (event: CompositionEvent) => {
    if ((event.target as Element).matches('.account-search')) {
      composingAccountSearch = false;
      accountSearch = (event.target as HTMLInputElement).value;
      find('.accounts').innerHTML = accountRowsMarkup();
    }
  };
  root.addEventListener('click', clickHandler);
  root.addEventListener('submit', submitHandler);
  find<HTMLSelectElement>('.console select').addEventListener('change', consoleChangeHandler);
  root.addEventListener('input', inputHandler);
  root.addEventListener('compositionstart', compositionStartHandler);
  root.addEventListener('compositionend', compositionEndHandler);
  const dialogCancelHandler = (event: Event) => { if (busy) event.preventDefault(); };
  const dialogCloseHandler = () => {
    syncLayout();
    if (returnFocus?.isConnected) returnFocus.focus();
    else find<HTMLButtonElement>('.brand').focus();
  };
  dialog.addEventListener('cancel', dialogCancelHandler);
  dialog.addEventListener('close', dialogCloseHandler);

  connection.textContent = bridge.available ? '正在连接原生运行时…' : '未连接原生运行时 · 浏览器仅展示应用壳。账号管理、网页导航和固定外链需在 Tauri 桌面应用中使用。';
  render();
  try {
    if (bridge.available) {
      layout.initialize(await bridge.beginLayout());
      await layout.setVisible(false);
      await bridge.connect(receive);
      ready = true;
      connection.hidden = true;
      connection.classList.add('connected');
      render();
      void checkForUpdates();
    }
  } catch (error) {
    ready = false;
    layout.dispose();
    connection.textContent = '原生连接失败 · 管理操作已禁用。请重新启动桌面应用后重试。';
    showLayoutError(error);
    render();
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.removeEventListener('click', clickHandler);
    root.removeEventListener('submit', submitHandler);
    root.removeEventListener('input', inputHandler);
    root.removeEventListener('compositionstart', compositionStartHandler);
    root.removeEventListener('compositionend', compositionEndHandler);
    find<HTMLSelectElement>('.console select').removeEventListener('change', consoleChangeHandler);
    dialog.removeEventListener('cancel', dialogCancelHandler);
    dialog.removeEventListener('close', dialogCloseHandler);
    window.removeEventListener('pagehide', dispose);
    bridge.dispose();
    systemTheme?.removeEventListener('change', systemThemeChanged);
    layout.dispose();
    accountMenu.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
