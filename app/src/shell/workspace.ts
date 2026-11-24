import type { TabDto, WorkspaceAction, WorkspaceSnapshot } from '../../contracts/workspace';
import { NativeBridge, safeError } from '../bridge/native';
import { NativeLayout } from '../bridge/layout';
import { accountName, acceptSnapshot, navigationUrl, sessionLabels } from '../features/workspace-state';
import { dashboardPage, homePage, settingsPage } from '../features/pages';
import { accountRequestNotice, accountTabStrip, browserEmptyState } from '../features/browser-content';
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
  let dialogKind: 'account' | 'tab' = 'account';

  root.innerHTML = `<div class="workspace-shell">
    <header class="topbar"><button class="brand" data-action="home" aria-label="Muse-multiple 首页"><span class="brand-mark">M</span><span>Muse<span class="brand-light">-multiple</span></span></button>
      <nav class="top-actions" aria-label="工作台工具"><button data-action="dashboard" class="top-link">${icon('dashboard')}仪表盘</button><button data-action="console" class="top-link" aria-expanded="false" aria-controls="workspace-console">${icon('terminal')}控制台</button><span class="top-divider"></span><button data-action="docs" class="top-link" disabled>${icon('book')}使用文档</button><button data-action="github" class="top-link" disabled>GitHub ${icon('external')}</button></nav></header>
    <aside class="sidebar" aria-label="主导航"></aside>
    <main class="workspace"><div class="connection-banner" role="status"></div><div class="error-banner" role="alert" hidden><span></span><button data-action="dismiss-error" class="icon-button" aria-label="关闭错误提示">${icon('close')}</button></div>
      <section class="page-view" aria-label="工作区"></section>
      <section class="browser-view" aria-label="原生网页工作区" hidden>
        <div class="tabbar"><div class="tabs" aria-label="网页标签"></div><button class="icon-button new-tab" data-action="new-tab" aria-label="新建标签" title="新建标签">${icon('plus')}</button></div>
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

  function renderSidebar(): void {
    const selected = route === 'account' ? selectedAccountId : null;
    const accounts = snapshot?.accounts ?? [];
    const visibleAccounts = accountsExpanded ? accounts : accounts.filter(account => account.id === selected);
    sidebar.innerHTML = `<button class="nav-button ${route === 'home' ? 'active' : ''}" data-action="home" ${route === 'home' ? 'aria-current="page"' : ''} title="首页">${icon('home')}<span class="nav-label">首页</span></button>
      <div class="account-group"><button class="group-toggle" data-action="toggle-accounts" aria-expanded="${accountsExpanded}" aria-controls="account-list"><span class="group-chevron ${accountsExpanded ? 'expanded' : ''}">${icon('chevron')}</span><span class="nav-label">对话 / 账号</span><span class="nav-count">${snapshot ? accounts.length : '—'}</span></button>
      <div id="account-list" class="accounts">${visibleAccounts.map(account => {
        const isSelected = account.id === selected;
        const runtime = snapshot?.runtimes.find(item => item.accountId === account.id);
        return `<button class="account-row ${isSelected ? 'active' : ''}" data-action="select-account" data-id="${esc(account.id)}" title="${esc(account.name)}${isSelected ? ' · 当前账号' : ''}" ${ready ? '' : 'disabled'} ${isSelected ? 'aria-current="page"' : ''}><span class="avatar">${esc(Array.from(account.name)[0] ?? 'M')}</span><span class="account-copy"><span class="account-name">${esc(account.name)}</span>${isSelected ? `<small>${runtime ? sessionLabels[runtime.sessionStatus] : '登录状态未验证'}</small>` : ''}</span>${isSelected ? '<span class="current-label">当前</span>' : ''}</button>`;
      }).join('')}${!accounts.length ? `<p class="sidebar-empty">${snapshot ? '尚无账号档案' : '等待原生连接'}</p>` : ''}</div></div>
      <button class="nav-button add-nav" data-action="add-account" title="添加 Muse 账号${ready ? '' : '（需连接原生运行时）'}" ${ready ? '' : 'disabled'}>${icon('plus')}<span class="nav-label">添加 Muse 账号</span></button>
      <div class="sidebar-bottom"><button class="nav-button ${route === 'settings' ? 'active' : ''}" data-action="settings" ${route === 'settings' ? 'aria-current="page"' : ''} title="设置">${icon('settings')}<span class="nav-label">设置</span></button><button class="nav-button collapse-button" data-action="collapse-sidebar" title="展开或收起侧栏" aria-label="展开或收起侧栏" aria-expanded="${!shell.classList.contains('compact')}">${icon('panel')}<span class="nav-label">收起侧栏</span></button></div>`;
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
    find<HTMLButtonElement>('[data-action="back"]').disabled = !ready || !active?.canGoBack;
    find<HTMLButtonElement>('[data-action="forward"]').disabled = !ready || !active?.canGoForward;
    find<HTMLButtonElement>('[data-action="reload"]').disabled = !ready || !active;
    find<HTMLButtonElement>('[data-action="stop"]').disabled = !ready || active?.loadState !== 'loading';
    find<HTMLButtonElement>('[data-action="new-tab"]').disabled = !ready || !selectedAccountId;
    find('.load-status').textContent = active ? ({ loading: '加载中', ready: '页面就绪', error: '加载失败' })[active.loadState] : '无网页';
    placeholder.hidden = !!active && snapshot?.activeAccountId === selectedAccountId;
    if (!placeholder.hidden) {
      placeholder.innerHTML = browserEmptyState(accountTabs.length > 0, ready);
    }
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
    page.hidden = route === 'account';
    browser.hidden = route !== 'account';
    if (route === 'home') page.innerHTML = homePage(snapshot, ready);
    if (route === 'dashboard') page.innerHTML = dashboardPage(snapshot);
    if (route === 'settings') page.innerHTML = settingsPage(snapshot);
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

  async function openDialog(kind: 'account' | 'tab'): Promise<void> {
    if (!ready || busy || dialog.open || openingDialog) return;
    openingDialog = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      // Await native acknowledgement, then show the modal. CSS z-index cannot cover a child WebView.
      await layout.setVisible(false);
      if (disposed) return;
      dialogKind = kind;
      dialog.innerHTML = `<form class="dialog-form" novalidate><header><span class="eyebrow">${kind === 'account' ? 'LOCAL ACCOUNT' : 'NEW TAB'}</span><button type="button" class="icon-button" data-action="close-dialog" aria-label="取消">${icon('close')}</button></header><h2 id="dialog-title">${kind === 'account' ? '添加 Muse 账号' : '新建网页标签'}</h2><p>${kind === 'account' ? '名称用于在本地辨认账号，不是登录凭据。首次登录在原生网页中完成。' : '网页在当前账号的原生浏览资料中打开，仅支持 HTTP / HTTPS。'}</p><label for="dialog-input">${kind === 'account' ? '账号名称（必填）' : '网页地址（必填）'}</label><input id="dialog-input" name="value" ${kind === 'account' ? 'placeholder="例如：工作账号"' : 'value="https://muse.ai/"'} autocomplete="off" spellcheck="false" aria-describedby="dialog-hint dialog-error" required><small id="dialog-hint">${kind === 'account' ? '同名允许；名称不影响独立资料的存储身份。' : '也可使用 http://127.0.0.1:4317 验证本地合成站点。'}</small><p id="dialog-error" class="input-error" role="alert"></p><footer><button type="button" class="secondary" data-action="close-dialog">取消</button><button class="primary" type="submit">${kind === 'account' ? '创建账号档案' : '打开标签'}</button></footer></form>`;
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
    if (action === 'select-account') return selectAccount(button.dataset.id ?? '');
    if (action === 'add-account') return openDialog('account');
    if (action === 'new-tab') {
      await openUrl('about:blank');
      address.focus();
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
    if (!form.matches('.dialog-form') || busy) return;
    const input = find<HTMLInputElement>('#dialog-input');
    const result = dialogKind === 'account' ? accountName(input.value) : navigationUrl(input.value);
    const error = find('#dialog-error');
    if (!result.ok) {
      error.textContent = result.message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.disabled = true;
    const action: WorkspaceAction | null = dialogKind === 'account'
      ? { type: 'createAccount', name: result.value }
      : selectedAccountId ? { type: 'createTab', accountId: selectedAccountId, url: result.value } : null;
    const success = action ? await perform(action) : false;
    submit.disabled = false;
    if (success) dialog.close();
    else error.textContent = '操作未完成，未确认创建成功。请查看工作区错误提示后重试。';
  }

  const clickHandler = (event: MouseEvent) => { void onClick(event).catch(showError); };
  const submitHandler = (event: SubmitEvent) => { void onSubmit(event).catch(showError); };
  root.addEventListener('click', clickHandler);
  root.addEventListener('submit', submitHandler);
  find<HTMLSelectElement>('.console select').addEventListener('change', event => {
    consoleLevel = (event.target as HTMLSelectElement).value;
    renderConsole();
  });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    syncLayout();
    if (returnFocus?.isConnected) returnFocus.focus();
    else find<HTMLButtonElement>('.brand').focus();
  });
  dialog.addEventListener('input', () => {
    if (dialogKind !== 'account') return;
    const value = find<HTMLInputElement>('#dialog-input').value.trim();
    const duplicate = snapshot?.accounts.some(account => account.name === value);
    find('#dialog-hint').textContent = duplicate ? '已有同名账号；仍可创建，新的档案拥有独立身份。' : '同名允许；名称不影响独立资料的存储身份。';
  });

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
    window.removeEventListener('pagehide', dispose);
    bridge.dispose();
    layout.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
