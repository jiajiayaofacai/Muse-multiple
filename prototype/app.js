'use strict';

// 仅模拟界面状态：没有 WebView、网络请求、真实账号或会话凭据。
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const STORAGE_KEY = 'muse-multiple.prototype.v1';
const defaults = { close: 'exit', theme: 'system', uiZoom: '100', sleep: '15', webZoom: '100' };
const choices = {
  close: [['exit', '退出工作台'], ['tray', '最小化到系统托盘']],
  theme: [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']],
  uiZoom: [['90', '90%'], ['100', '100%（默认）'], ['110', '110%'], ['125', '125%']],
  sleep: [['0', '关闭'], ['5', '5 分钟'], ['15', '15 分钟（默认）'], ['30', '30 分钟']],
  webZoom: [['90', '90%'], ['100', '100%（默认）'], ['110', '110%'], ['125', '125%']]
};
let storageNotice = '';
let stored;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    stored = JSON.parse(raw);
    if (!stored || !Array.isArray(stored.accounts) || !stored.accounts.every((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && a.name.trim() && typeof a.note === 'string') || new Set(stored.accounts.map((a) => a.id)).size !== stored.accounts.length) throw new Error('invalid prototype data');
  }
} catch {
  stored = null;
  storageNotice = '原型本地记录不可用，已载入演示数据；可继续体验。';
}
const settings = { ...defaults };
for (const key of Object.keys(defaults)) {
  if (choices[key].some(([v]) => v === stored?.settings?.[key])) settings[key] = stored.settings[key];
}
const samples = [
  { id: 'demo-work', name: '工作账号', note: '日常工作与项目讨论', tone: '', usedAt: 3 },
  { id: 'demo-ideas', name: '灵感手记', note: '记录想法，留住灵感', tone: 'ochre', usedAt: 2 },
  { id: 'demo-spare', name: '备用账号', note: '一个待登录的演示账号', tone: 'sage', usedAt: 1 }
];
const accounts = (stored?.accounts ?? samples).map((a) => ({
  id: a.id, name: a.name, note: a.note, tone: ['', 'ochre', 'sage'].includes(a.tone) ? a.tone : '',
  usedAt: Number.isFinite(a.usedAt) ? a.usedAt : 0,
  ready: a.id === 'demo-work' || a.id === 'demo-ideas',
  sleeping: a.id === 'demo-ideas', initialized: false, tabs: [], activeTab: null, leftAt: null
}));
let view = 'home';
let activeId = null;
let tabSequence = 0;
let groupExpanded = true;
let sidebarCollapsed = false;
let accountDrawer = false;
let search = '';
let consoleOpen = false;
let consoleScope = 'all';
let consoleLevel = 'all';
let settingsTab = 'general';
let saveStatus = '更改自动保存';
let logs = [];
let toastTimer;
let lastMenuButton;
const dialog = $('#dialog');
const accountMenu = $('#account-menu');
const current = () => accounts.find((a) => a.id === activeId);
const selectedTab = (a = current()) => a?.tabs.find((t) => t.id === a.activeTab);
const isProtected = (a) => a.tabs.some((t) => t.kind === 'auth' || t.draft.trim());

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, accounts: accounts.map(({ id, name, note, tone, usedAt }) => ({ id, name, note, tone, usedAt })) }));
    saveStatus = '已保存到此浏览器';
    return true;
  } catch {
    saveStatus = '保存失败';
    toast('本地保存失败；本次操作仍可使用，但关闭后可能丢失。');
    return false;
  }
}
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}
function log(text, account = null, level = 'info') {
  logs.push({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, account, text });
  logs = logs.slice(-100);
  if (consoleOpen) renderConsole();
}
function applySettings() {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--web-scale', Number(settings.webZoom) / 100);
  const scale = Number(settings.uiZoom) / 100;
  $('#app').style.zoom = scale;
  $('#app').style.width = `${100 / scale}vw`;
  $('#app').style.height = `${100 / scale}dvh`;
}
function avatar(a) {
  return `<span class="avatar ${a.tone}">${esc(Array.from(a.name)[0])}</span>`;
}
function badge(a) {
  if (a.tabs.some((t) => t.kind === 'auth')) return `<span class="state-chip warning">${icon('lock')}认证中 · 演示</span>`;
  if (a.sleeping) return `<span class="state-chip">${icon('moon')}已休眠 · 演示</span>`;
  if (!a.ready) return `<span class="state-chip warning">待登录 · 演示</span>`;
  return '<span class="state-chip">演示账号</span>';
}
function renderSidebar() {
  const active = view === 'account' ? current() : null;
  $('#sidebar').innerHTML = `
    <button class="nav-button ${view === 'home' ? 'active' : ''}" data-action="home" ${view === 'home' ? 'aria-current="page"' : ''} title="首页">${icon('home')}<span class="nav-label">首页</span></button>
    <div class="chat-group">
      <button class="nav-button compact-only" data-action="account-list" aria-label="打开账号列表" title="打开账号列表">${icon('chat')}</button>
      <div class="group-row"><button class="group-toggle" data-action="group" aria-expanded="${groupExpanded}" aria-controls="account-list">${icon('chevron')}<span>对话${!groupExpanded && active ? ` · ${esc(active.name)}` : ''}</span><small class="nav-count">${accounts.length}</small></button><button class="icon-button" data-action="add" title="添加 Muse 账号" aria-label="添加 Muse 账号">${icon('plus')}</button></div>
      <div id="account-list" ${!groupExpanded ? 'hidden' : ''}>
        ${accounts.length > 3 ? `<label class="search-box">${icon('search')}<input id="account-search" aria-label="搜索账号" placeholder="搜索账号…" value="${esc(search)}"></label>` : ''}
        <div class="accounts">${accounts.map((a) => `<div class="account-row ${active?.id === a.id ? 'active' : ''}" data-account-row="${esc(a.id)}" ${!`${a.name} ${a.note}`.toLowerCase().includes(search.toLowerCase()) ? 'hidden' : ''}>
          <button class="account-select" data-action="account" data-id="${esc(a.id)}" title="${esc(a.name)}${a.note ? ` · ${esc(a.note)}` : ''}" ${active?.id === a.id ? 'aria-current="page"' : ''}>${avatar(a)}<span class="account-name">${esc(a.name)}</span>${active?.id === a.id ? '<span class="current-label">当前</span>' : a.sleeping ? `<span class="account-state" title="已休眠">${icon('moon')}</span>` : !a.ready ? `<span class="account-state" title="待登录（演示）">${icon('info')}</span>` : ''}</button>
          <button class="icon-button" data-action="menu" data-id="${esc(a.id)}" aria-label="${esc(a.name)}的更多操作" title="更多操作">${icon('more')}</button>
        </div>`).join('')}${!accounts.length ? '<div class="no-match">还没有账号，添加一个吧。</div>' : ''}<div id="no-matches" class="no-match" hidden>没有匹配的账号</div></div>
      </div>
    </div>
    <button class="nav-button add-nav" data-action="add" title="添加 Muse 账号">${icon('plus')}<span class="nav-label">添加 Muse 账号</span></button>
    <div class="sidebar-bottom"><div class="bottom-row"><button class="nav-button ${view === 'settings' ? 'active' : ''}" data-action="settings" title="设置" ${view === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span class="nav-label">设置</span></button><button class="icon-button" data-action="sidebar" title="${sidebarCollapsed ? '展开' : '收起'}侧栏" aria-label="${sidebarCollapsed ? '展开' : '收起'}侧栏" aria-expanded="${!sidebarCollapsed}">${icon('panel')}</button></div><div class="sidebar-caption"><span class="tiny-dot"></span>本地原型 · 不连接真实账号</div></div>`;
  $('#app').classList.toggle('collapsed', sidebarCollapsed);
  $('#app').classList.toggle('account-drawer', accountDrawer);
}
function renderHome() {
  const recent = [...accounts].sort((a, b) => b.usedAt - a.usedAt).slice(0, 3);
  const pending = accounts.filter((a) => !a.ready);
  return `<div class="page home-page">
    <div class="page-heading"><div><div class="eyebrow">YOUR MUSE WORKSPACE</div><h1>工作台首页</h1></div><span class="quiet-pill">${icon('shield')}让每一个账号，各得其所</span></div>
    <section class="hero"><div class="hero-copy"><h2>多个账号，一个从容的空间。</h2><p>从这里开始新的对话，或回到熟悉的账号。<br>这是一份本地交互原型，所有网页和登录状态均为模拟。</p><button class="primary" data-action="add">${icon('plus')}添加 Muse 账号</button></div>
      <div class="hero-art" aria-hidden="true"><div class="art-card back"></div><div class="art-card front"><span class="art-avatar">${icon('chat')}</span><span class="art-line"></span><span class="art-line short"></span><span class="art-footer">MUSE WORKSPACE ${icon('check')}</span></div></div>
    </section>
    <div class="section-heading"><h2>最近使用 <small>${accounts.length} 个本地演示档案</small></h2><span class="text-muted">选择一个账号，继续探索</span></div>
    ${recent.length ? `<div class="card-grid">${recent.map((a) => `<button class="recent-card" data-action="account" data-id="${esc(a.id)}"><span class="card-top">${avatar(a)}${badge(a)}</span><h3>${esc(a.name)}</h3><p>${esc(a.note || '尚未填写备注')}</p><span class="card-bottom"><span>${a.usedAt > 10 ? '最近打开' : '示例档案'}</span>${icon('arrow')}</span></button>`).join('')}</div>` : '<div class="empty-state">还没有账号。点击上方按钮，添加你的第一个 Muse 账号。</div>'}
    ${pending.length ? `<div class="section-heading"><h2>需要处理 <small>${pending.length}</small></h2></div>${pending.slice(0, 2).map((a) => `<div class="notice-row"><span class="notice-icon">${icon('info')}</span><div class="notice-copy"><strong>${esc(a.name)} · 尚未完成模拟登录</strong><p>档案已保留，可以随时继续，不需要重新添加。</p></div><button class="text-button" data-action="account" data-id="${esc(a.id)}">继续登录 ${icon('arrow')}</button></div>`).join('')}` : ''}
    <p class="home-foot">${icon('info')}原型仅保存名称、备注与设置。关闭再打开仍从首页开始。</p>
  </div>`;
}
function dashboardStats() {
  return { total: accounts.length, loaded: accounts.filter((a) => !a.sleeping && a.tabs.length).length, sleeping: accounts.filter((a) => a.sleeping).length, tabs: accounts.reduce((n, a) => n + a.tabs.length, 0) };
}
function renderDashboard() {
  const stats = dashboardStats();
  return `<div class="page dashboard-page"><div class="page-heading"><div><div class="eyebrow">WORKSPACE OVERVIEW</div><h1>仪表盘</h1></div><span class="quiet-pill">${icon('info')}仅统计本地原型状态</span></div>
    <p class="dashboard-intro">账号与页面，一目了然。这里展示本次演示的状态，不包含真实登录、额度、用量或内存测量。</p>
    <div class="metric-grid">${[['total', '账号档案', '本地演示账号', 'chat'], ['loaded', '页面驻留', '已打开网页的账号', 'panel'], ['sleeping', '已休眠', '模拟回收页面资源', 'moon'], ['tabs', '网页标签', '所有账号的打开标签', 'book']].map(([key, label, help, glyph]) => `<div class="metric-card"><span class="metric-label">${icon(glyph)}${label}</span><strong data-metric="${key}">${stats[key]}</strong><small>${help}</small></div>`).join('')}</div>
    <div class="section-heading"><h2>账号与页面状态</h2><span class="text-muted">自动休眠：${settings.sleep === '0' ? '关闭' : `${settings.sleep} 分钟`}</span></div>
    <div class="overview-table"><table><thead><tr><th>账号</th><th>页面状态</th><th>标签数</th><th>操作</th></tr></thead><tbody>${accounts.map((a) => `<tr><td><div class="overview-account">${avatar(a)}<span><strong>${esc(a.name)}</strong><small>${esc(a.note || '未填写备注')}</small></span></div></td><td><span class="state-chip">${a.sleeping ? '已休眠' : a.tabs.length ? '页面驻留' : a.initialized ? '全部标签已关闭' : '尚未打开'}</span>${a.tabs.some((t) => t.kind === 'auth') ? '<small class="overview-auth">认证中 · 演示</small>' : ''}</td><td>${a.tabs.length}</td><td><button class="text-button" data-action="account" data-id="${esc(a.id)}">打开 ${icon('arrow')}</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">还没有账号，先添加一个吧。</td></tr>'}</tbody></table></div>
    <p class="home-foot">${icon('shield')}打开仪表盘不会加载全部账号，也不会清除账号的标签和浏览资料。</p>
  </div>`;
}
function createTab(a, kind, source = null, id = `tab-${++tabSequence}`) {
  const page = kind === 'main' ? (a.ready ? 'chat' : 'login') : kind;
  const url = kind === 'main' ? 'https://muse.ai/' : kind === 'auth' ? 'https://auth.muse.ai/' : kind === 'article' ? 'https://reference.example/' : 'about:blank';
  const tab = { id, kind, source, title: '', url, history: [{ page, url }], position: 0, draft: '', message: '' };
  syncTab(tab);
  a.tabs.push(tab);
  a.activeTab = id;
  return tab;
}
function ensureTabs(a) {
  if (!a.initialized) { a.initialized = true; createTab(a, 'main', null, 'main'); }
  if (!a.tabs.some((t) => t.id === a.activeTab)) a.activeTab = a.tabs[0]?.id ?? null;
}
function syncTab(tab) {
  const entry = tab.history[tab.position];
  tab.url = entry.url;
  tab.kind = ['chat', 'login', 'error'].includes(entry.page) ? 'main' : entry.page;
  tab.title = ({ main: 'Muse 对话', auth: 'Meta 账号认证', article: '参考资料', blank: '新标签页' })[tab.kind] || new URL(tab.url).hostname;
}
function navigateTab(tab, page, url) {
  tab.history = tab.history.slice(0, tab.position + 1);
  tab.history.push({ page, url });
  tab.position = tab.history.length - 1;
  syncTab(tab);
}
function parseAddress(value) {
  let text = value.trim();
  if (!text) return null;
  if (text === 'about:blank') return { page: 'blank', url: text };
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return { page: url.hostname === 'muse.ai' ? (current().ready ? 'chat' : 'login') : 'web', url: url.href };
  } catch { return null; }
}
function tabPage(a, tab) {
  const page = tab.history[tab.position].page;
  const head = `<div class="mock-header"><span class="muse-wordmark">muse<span style="color:var(--accent)">.</span></span><span class="mock-page-label">本地网页示意 · 非真实 Muse</span></div>`;
  if (page === 'blank') return `${head}<div class="login-card"><span class="auth-symbol">${icon('plus')}</span><h1>新的标签，新的可能</h1><p>在上方输入网址并回车，或打开 Muse 首页。<br>此标签始终属于左侧选中的账号。</p><button class="primary" data-action="main">${icon('home')}打开 Muse 首页</button><p class="mock-disclaimer">原型只演示导航，不访问外部网站。</p></div>`;
  if (page === 'web') return `${head}<article class="article"><div class="eyebrow">NAVIGATION PREVIEW</div><h1>已模拟打开网页</h1><p class="preview-url">${esc(tab.url)}</p><div class="article-callout"><p>正式版会在当前账号的浏览环境中加载这个地址。原型没有发送网络请求，也没有读取网站内容。</p></div><button class="secondary" data-action="main">${icon('home')}在此标签打开 Muse</button></article>`;
  if (page === 'error') return `${head}<div class="login-card"><span class="auth-symbol">${icon('info')}</span><h1>页面暂时无法加载</h1><p>这是一个模拟网络错误，不代表账号登录失效。账号档案仍然保留。</p><button class="primary" data-action="reload">${icon('refresh')}重试</button><button class="text-button" style="margin:auto" data-action="show-console">查看运行日志</button></div>`;
  if (tab.kind === 'auth') return `${head}<div class="login-card"><span class="auth-symbol">${icon('lock')}</span><h1>继续完成账号认证</h1><p>这里演示认证网页作为新标签打开。<br>可切回 Muse，也可切换账号后再回来。</p><button class="primary" data-action="auth-complete">${icon('check')}模拟认证完成</button><p class="mock-disclaimer">无需输入密码或验证码。此页面不连接 Meta。<br>真实认证兼容性尚未验证。</p></div>`;
  if (tab.kind === 'article') return `${head}<article class="article"><div class="eyebrow">REFERENCE · 本地参考文章示意</div><h1>把灵感留在当下，把账号分得清楚。</h1><p>从 Muse 打开的参考资料，会出现在这个账号自己的标签组里。回到对话时，点击上方的「Muse 对话」即可。</p><div class="article-callout"><p>左侧切换账号，上方切换网页。两个动作，各有自己的空间。</p></div><p>本页是静态演示内容，没有加载外部文章。正式版的文章网页同样不应获得工作台的本地文件或系统权限。</p><button class="secondary" data-action="main">${icon('chat')}返回 Muse 对话</button></article>`;
  if (page === 'login') return `${head}<div class="login-card"><span class="auth-symbol">${icon('shield')}</span><h1>欢迎来到你的 Muse</h1><p>账号档案已经准备好。<br>正式版将在这里显示真实的 Muse 登录页面。</p><button class="primary" data-action="auth-open">${icon('external')}演示网页认证</button><p class="mock-disclaimer">点击后在旁边打开模拟认证标签。<br>请勿在原型中输入真实登录信息。</p></div>`;
  return `${head}<div class="chat-center"><div class="muse-orbit">${icon('spark')}</div><h1>今天，想从哪个想法开始？</h1><p>给灵感一点空间，让对话自然发生。</p>${tab.message ? `<div class="message-preview"><strong>本地演示消息</strong><br>${esc(tab.message)}<br><span class="text-muted">这里只演示输入与账号切换，不会发送到 Muse。</span></div>` : ''}<div class="suggestions"><button data-action="suggest" data-text="帮我梳理一个新想法">梳理一个新想法</button><button data-action="article-open">${icon('book')} 打开参考资料</button><button data-action="auth-open">演示认证标签</button></div><form id="composer" class="composer"><textarea id="chat-draft" maxlength="2000" aria-label="本地演示消息" placeholder="在这里输入演示文字…">${esc(tab.draft)}</textarea><div class="composer-foot"><span>仅本地展示，不发送到 Muse</span><button class="send-button" type="submit" title="展示演示消息" aria-label="展示演示消息">${icon('arrow')}</button></div></form><div class="mock-disclaimer">这是 Muse 内容区的布局示意，不代表网站的实际界面。<br><button class="text-button" style="margin:auto" data-action="simulate-error">体验加载失败状态</button></div></div>`;
}
function renderBrowser() {
  const a = current();
  ensureTabs(a);
  const tab = selectedTab(a);
  return `<div class="browser-view"><div class="tabbar"><div class="tabs" role="tablist" aria-label="当前账号的网页标签">${a.tabs.map((t) => `<div class="tab ${t.id === a.activeTab ? 'active' : ''}"><button class="tab-select" role="tab" aria-selected="${t.id === a.activeTab}" aria-controls="web-content" data-action="tab" data-id="${t.id}">${icon(t.kind === 'auth' ? 'lock' : t.kind === 'article' || t.kind === 'web' ? 'book' : t.kind === 'blank' ? 'plus' : 'chat')}<span>${esc(t.title)}</span></button><button class="icon-button" data-action="close-tab" data-id="${t.id}" aria-label="关闭${esc(t.title)}">${icon('close')}</button></div>`).join('')}</div><button class="icon-button new-tab-button" data-action="new-tab" aria-label="新建标签页" title="新建标签页（Ctrl+T）">${icon('plus')}</button></div>
    <div class="browser-toolbar"><button class="icon-button" data-action="back" aria-label="返回" title="返回" ${!tab || tab.position === 0 ? 'disabled' : ''}>${icon('arrow', 'back-icon')}</button><button class="icon-button" data-action="forward" aria-label="前进" title="前进" ${!tab || tab.position === tab.history.length - 1 ? 'disabled' : ''}>${icon('arrow')}</button><button class="icon-button" data-action="reload" aria-label="刷新当前页面" title="刷新当前页面" ${!tab ? 'disabled' : ''}>${icon('refresh')}</button><form id="address-form" class="address">${icon('info')}<input id="page-address" aria-label="网页地址（原型仅模拟导航）" value="${esc(tab?.url === 'about:blank' ? '' : tab?.url || '')}" placeholder="输入网址，按 Enter 打开（模拟）" spellcheck="false" autocomplete="off" ${!tab ? 'disabled' : ''}></form><span class="sim-badge">模拟网页</span><button class="icon-button" data-action="main" aria-label="返回 Muse 首页" title="返回 Muse 首页">${icon('home')}</button></div><div id="web-content" class="webpage" role="tabpanel">${tab ? tabPage(a, tab) : `<div class="login-card"><span class="auth-symbol">${icon('book')}</span><h1>此账号的标签已全部关闭</h1><p>账号档案仍然保留，未执行退出登录。<br>新建标签页，或重新打开 Muse 继续使用。</p><button class="primary" data-action="new-tab">${icon('plus')}新建标签页</button><button class="secondary" data-action="main">${icon('home')}打开 Muse 首页</button></div>`}</div></div>`;
}
function settingRow(key, label, description) {
  return `<div class="setting-row"><div class="setting-copy"><label for="setting-${key}">${label}</label><p>${description}</p></div><select id="setting-${key}" data-setting="${key}">${choices[key].map(([value, text]) => `<option value="${value}" ${settings[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
}
function renderSettings() {
  const content = settingsTab === 'general' ? `<section class="settings-section"><h2>窗口与外观</h2><div class="settings-card">${settingRow('close', '关闭窗口时', '原型仅保存偏好；真实退出与系统托盘由桌面版实现。')}${settingRow('theme', '工作台主题', '只调整工作台外观，不修改真实 Muse 网页主题。')}${settingRow('uiZoom', '工作台界面缩放', '调整导航、首页和设置的显示大小。')}</div></section><div class="settings-note">${icon('info')}每次启动先显示首页；从托盘恢复时，应回到隐藏前的界面。浏览器原型不控制系统窗口。</div>` : settingsTab === 'pages' ? `<section class="settings-section"><h2>页面与资源</h2><div class="settings-card">${settingRow('sleep', '后台账号自动休眠', '回收闲置页面，保留本机登录资料。再次进入时重新加载。')}${settingRow('webZoom', 'Muse 网页缩放', '仅调整右侧模拟网页，不改变导航栏大小。')}</div></section><div class="notice-row"><span class="notice-icon">${icon('shield')}</span><div class="notice-copy"><strong>不打断认证，不丢下正在输入的想法</strong><p>本原型会保护认证标签和非空草稿。真实网站的生成、上传状态尚待验证；原型休眠只模拟页面回收。</p></div></div><div class="settings-note">${icon('info')}只有已打开的后台账号参与计时。关闭再打开不会自动恢复旧认证链接。</div>` : `<section class="settings-section"><h2>诊断</h2><div class="settings-card"><div class="setting-row"><div class="setting-copy"><strong>仪表盘</strong><p>查看账号概况和页面状态。</p></div><button class="secondary" data-action="dashboard">打开仪表盘</button></div><div class="setting-row"><div class="setting-copy"><strong>工作台控制台</strong><p>独立查看运行日志，不切换当前页面。</p></div><button class="secondary" data-action="show-console">打开控制台</button></div><div class="setting-row"><div class="setting-copy"><strong>脱敏诊断信息</strong><p>不包含账号名称、备注、消息、认证网址或凭据。</p></div><button class="secondary" data-action="copy-diagnostics">复制诊断信息</button></div></div></section><section class="settings-section"><h2>关于</h2><div class="settings-card"><div class="about-mark"><span class="avatar">M</span><div><strong>Muse-multiple</strong><p>界面原型 v0.1 · 尚未创建桌面应用</p></div></div></div></section><div class="settings-note">${icon('info')}GitHub 项目地址已配置；使用文档地址尚未配置。原型不连接 Muse 或 Meta。</div>`;
  return `<div class="page settings-page"><div class="page-heading"><div><div class="eyebrow">PREFERENCES</div><h1>设置</h1></div><span id="save-status" class="saved-label">${icon('check')}${saveStatus}</span></div><div class="settings-tabs" aria-label="设置分类">${[['general', '通用'], ['pages', '账号与页面'], ['about', '诊断与关于']].map(([id, label]) => `<button data-action="settings-tab" data-id="${id}" class="${settingsTab === id ? 'active' : ''}" aria-pressed="${settingsTab === id}">${label}</button>`).join('')}</div>${content}</div>`;
}
function render() {
  renderSidebar();
  $('#view').innerHTML = view === 'home' ? renderHome() : view === 'dashboard' ? renderDashboard() : view === 'settings' ? renderSettings() : renderBrowser();
  $('#dashboard-link').classList.toggle('active', view === 'dashboard');
  $('#dashboard-link').setAttribute('aria-pressed', String(view === 'dashboard'));
  renderConsole();
  $('#console-toggle').classList.toggle('active', consoleOpen);
  $('#console-toggle').setAttribute('aria-expanded', String(consoleOpen));
}
function navigate(next, id = null) {
  accountDrawer = false;
  if (view === 'account' && (next !== 'account' || id !== activeId)) current().leftAt = Date.now();
  view = next;
  if (next === 'account') {
    activeId = id;
    const a = current();
    a.leftAt = null;
    if (a.sleeping) { a.sleeping = false; log('唤醒账号，模拟重新加载页面', a.id); }
    ensureTabs(a);
    a.usedAt = Date.now();
    save();
    log('切换到此账号的独立演示标签组', a.id);
  }
  closeMenu();
  render();
  $('#view').scrollTop = 0;
}
function openTab(kind) {
  const a = current();
  const existing = kind === 'auth' ? a.tabs.find((t) => t.kind === 'auth' && t.source === a.activeTab) : null;
  if (existing) a.activeTab = existing.id;
  else { createTab(a, kind, a.activeTab); log(kind === 'auth' ? '打开模拟认证标签；暂停此账号自动休眠' : '在所属账号内打开演示标签', a.id); }
  render();
  if (kind === 'blank') $('#page-address').focus();
}
function closeTab(id) {
  const a = current();
  const tab = a.tabs.find((t) => t.id === id);
  if (!tab) return;
  const perform = () => {
    const index = a.tabs.indexOf(tab);
    a.tabs.splice(index, 1);
    if (a.activeTab === id) a.activeTab = a.tabs.find((t) => t.id === tab.source)?.id ?? a.tabs[Math.max(0, index - 1)]?.id ?? null;
    log('关闭演示标签，未移除账号档案或退出登录', a.id);
    render();
  };
  if (tab.draft.trim()) showDialog({ title: '关闭这个标签？', description: '此标签有未发送的演示文字，关闭后会丢失。账号档案和其他标签不受影响。', confirm: '关闭标签', onSubmit: perform });
  else perform();
}
function completeAuth() {
  const a = current();
  const auth = selectedTab(a);
  a.ready = true;
  const source = a.tabs.find((t) => t.id === auth.source);
  if (source && source.kind === 'main') navigateTab(source, 'chat', 'https://muse.ai/');
  log('模拟认证完成；真实登录尚未实现或验证', a.id);
  closeTab(auth.id);
  toast(source ? '模拟认证完成，已返回来源标签。' : '模拟认证完成；来源标签已关闭，可重新打开 Muse。');
}
function openMuse() {
  const a = current();
  const tab = selectedTab(a) || createTab(a, 'main');
  if (tab.draft.trim()) { toast('当前标签有未发送文字，请先处理或新建标签再打开 Muse。'); return; }
  navigateTab(tab, a.ready ? 'chat' : 'login', 'https://muse.ai/');
  render();
}
function sleepAccount(a, manual = false) {
  if (a.sleeping || !a.tabs.length) return;
  const perform = () => {
    a.sleeping = true;
    a.tabs = [];
    a.activeTab = null;
    a.initialized = false;
    a.leftAt = null;
    log('模拟回收页面；演示账号档案保留，不代表真实会话已验证', a.id);
    if (view === 'account' && activeId === a.id) navigate('home'); else render();
  };
  if (manual && (isProtected(a) || (view === 'account' && activeId === a.id))) {
    showDialog({ title: '立即休眠此账号？', description: '将关闭此账号的演示网页标签，保留名称与备注。\n未发送的文字与正在进行的认证会中断。', confirm: '确认休眠', onSubmit: perform });
  } else if (!isProtected(a)) perform();
}
function showDialog({ title, description = '', field = null, value = '', confirm = '确定', danger = false, onSubmit = null }) {
  closeMenu();
  dialog.innerHTML = `<form id="modal-form"><div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" type="button" data-action="dialog-cancel" aria-label="关闭弹窗">${icon('close')}</button></div>${description ? `<p class="dialog-description">${esc(description)}</p>` : ''}${field ? `<label class="field-label" for="modal-value">${field === 'note' ? '账号备注（可选）' : '账号名称'}</label>${field === 'note' ? `<textarea id="modal-value" maxlength="200">${esc(value)}</textarea>` : `<input id="modal-value" autocomplete="off" required maxlength="32" placeholder="例如：工作账号" value="${esc(value)}">`}<div class="dialog-help">${field === 'note' ? '仅用于区分用途，请勿填写密码、验证码等敏感信息。' : '名称仅用于本地识别，之后可以修改。'}</div><div id="name-warning" class="dialog-warning" aria-live="polite"></div>` : ''}<div class="dialog-actions">${onSubmit ? '<button type="button" class="secondary" data-action="dialog-cancel">取消</button>' : ''}<button type="submit" class="primary ${danger ? 'danger' : ''}">${esc(confirm)}</button></div></form>`;
  $('#modal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#modal-value');
    const text = input ? input.value.trim() : '';
    if (input && field !== 'note' && !text) { input.setCustomValidity('请填写账号名称，不能只输入空格。'); input.reportValidity(); return; }
    dialog.close();
    onSubmit?.(text);
  });
  if (field && field !== 'note') $('#modal-value').addEventListener('input', (event) => {
    event.target.setCustomValidity('');
    $('#name-warning').textContent = accounts.some((a) => a.name === event.target.value.trim()) ? '已有同名账号，仍可添加；各账号资料相互独立。' : '';
  });
  dialog.showModal();
  if (field) { $('#modal-value').focus(); $('#modal-value').select(); }
}
function addAccount() {
  showDialog({ title: '添加 Muse 账号', description: '先为这个空间取个名字，再打开它自己的 Muse 页面。', field: 'name', confirm: '添加并打开', onSubmit: (name) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `account-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    accounts.push({ id, name, note: '', tone: ['', 'ochre', 'sage'][accounts.length % 3], usedAt: Date.now(), ready: false, sleeping: false, initialized: false, tabs: [], activeTab: null, leftAt: null });
    search = '';
    groupExpanded = true;
    log('创建演示账号档案，等待模拟登录', id);
    navigate('account', id);
  } });
}
function closeMenu() {
  accountMenu.hidden = true;
}
function openMenu(button, id) {
  const a = accounts.find((item) => item.id === id);
  lastMenuButton = button;
  accountMenu.innerHTML = `<button data-action="rename" data-id="${esc(id)}">重命名</button><button data-action="note" data-id="${esc(id)}">编辑备注</button><hr><button data-action="refresh-account" data-id="${esc(id)}">刷新当前页面</button><button data-action="sleep-account" data-id="${esc(id)}">${a.sleeping ? '唤醒账号' : '立即休眠'}</button><hr><button class="danger-text" data-action="remove" data-id="${esc(id)}">移除账号…</button>`;
  accountMenu.hidden = false;
  const rect = button.getBoundingClientRect();
  accountMenu.style.left = `${Math.min(rect.right + 8, innerWidth - 180)}px`;
  accountMenu.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - accountMenu.offsetHeight - 12))}px`;
  accountMenu.querySelector('button').focus();
}
function renderConsole() {
  const panel = $('#console');
  panel.hidden = !consoleOpen;
  if (panel.hidden) return;
  let filtered = logs.filter((l) => consoleScope === 'all' || (consoleScope === 'workspace' ? !l.account : l.account === consoleScope));
  if (consoleLevel !== 'all') filtered = filtered.filter((l) => l.level === consoleLevel);
  panel.innerHTML = `<div class="resize-handle" role="separator" aria-label="调整运行日志高度" aria-orientation="horizontal" aria-valuemin="130" aria-valuemax="500" aria-valuenow="${parseInt(getComputedStyle(document.documentElement).getPropertyValue('--console-height')) || 220}" tabindex="0"></div><div class="console-head"><strong>${icon('terminal')}运行日志</strong><div class="console-tools"><button class="text-button" data-action="copy-diagnostics">复制诊断信息</button><button class="text-button" data-action="clear-logs">清屏</button><button class="icon-button" data-action="console" aria-label="收起运行日志" title="收起运行日志">${icon('close')}</button></div></div><div class="console-filters"><select id="console-scope" aria-label="日志范围">${[['all', '全部账号与工作台'], ['workspace', '仅工作台'], ...accounts.map((a) => [a.id, a.name])].map(([v, t]) => `<option value="${esc(v)}" ${consoleScope === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><select id="console-level" aria-label="日志级别">${[['all', '全部级别'], ['info', '信息'], ['warn', '警告'], ['error', '错误']].map(([v, t]) => `<option value="${v}" ${consoleLevel === v ? 'selected' : ''}>${t}</option>`).join('')}</select><span>内存记录 · 最多 100 条 · 不记录网页内容</span></div><div class="logs">${filtered.length ? filtered.map((l) => `<div class="log-row"><time>${l.time}</time><span class="log-level ${l.level}">${({ info: '信息', warn: '警告', error: '错误' })[l.level]}</span><span class="log-account">${esc(l.account ? accounts.find((a) => a.id === l.account)?.name ?? '已移除账号' : '工作台')}</span><span>${esc(l.text)}</span></div>`).join('') : '<div class="text-muted" style="padding:15px 0">暂无符合筛选条件的记录</div>'}</div>`;
}
function reloadAccount(a) {
  if (a.sleeping) { navigate('account', a.id); return; }
  const tab = selectedTab(a);
  if (!tab) { toast('此账号没有打开的标签，请先新建。'); return; }
  if (tab.history[tab.position].page === 'error') { tab.history[tab.position].page = a.ready ? 'chat' : 'login'; syncTab(tab); }
  log('模拟刷新当前标签；未访问真实网页', a.id);
  render();
  toast('模拟页面已刷新；没有连接真实网站。');
}
async function copyDiagnostics() {
  const diagnostic = JSON.stringify({ application: 'Muse-multiple', mode: 'local-ui-prototype', version: '0.1', nativeWebview: 'not connected', accountCount: accounts.length, autoSleepMinutes: Number(settings.sleep), warningCount: logs.filter((l) => l.level === 'warn').length, errorCount: logs.filter((l) => l.level === 'error').length }, null, 2);
  try { await navigator.clipboard.writeText(diagnostic); toast('已复制脱敏诊断信息（不含账号名称或网页内容）。'); }
  catch { showDialog({ title: '诊断信息', description: diagnostic, confirm: '关闭' }); }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) { if (!accountMenu.contains(event.target)) closeMenu(); return; }
  const action = button.dataset.action;
  const id = button.dataset.id;
  const a = accounts.find((item) => item.id === id);
  if (action !== 'menu') closeMenu();
  switch (action) {
    case 'home': navigate('home'); break;
    case 'settings': navigate('settings'); break;
    case 'dashboard': navigate('dashboard'); break;
    case 'account': navigate('account', id); break;
    case 'add': addAccount(); break;
    case 'group': groupExpanded = !groupExpanded; renderSidebar(); break;
    case 'account-list': accountDrawer = !accountDrawer; groupExpanded = true; renderSidebar(); break;
    case 'sidebar': if (accountDrawer) accountDrawer = false; else if (innerWidth <= 520) accountDrawer = true; else sidebarCollapsed = !sidebarCollapsed; renderSidebar(); break;
    case 'menu': openMenu(button, id); break;
    case 'rename': case 'note':
      showDialog({ title: action === 'rename' ? '重命名账号' : '编辑备注', field: action === 'note' ? 'note' : 'name', value: action === 'note' ? a.note : a.name, confirm: '保存', onSubmit: (value) => { if (action === 'rename') a.name = value; else a.note = value; save(); render(); toast('已更新演示账号资料。'); } }); break;
    case 'remove':
      showDialog({ title: `移除账号“${a.name}”？`, description: '将关闭它的全部演示标签并删除本地原型档案。\n\n正式版还会清除该账号的本机登录资料，重新添加后需要登录；不会注销 Muse 网站账号，也不影响其他账号。原型没有真实登录资料。', confirm: '移除账号', danger: true, onSubmit: () => { accounts.splice(accounts.indexOf(a), 1); logs = logs.filter((l) => l.account !== id); if (consoleScope === id) consoleScope = 'all'; save(); if (activeId === id) activeId = null; if (view === 'account' && !current()) view = 'home'; log('已移除一个本地演示账号档案'); render(); } }); break;
    case 'refresh-account': reloadAccount(a); break;
    case 'sleep-account': if (a.sleeping) navigate('account', id); else if (!a.tabs.length) toast('此账号的页面尚未打开，无需回收。'); else sleepAccount(a, true); break;
    case 'tab': current().activeTab = id; render(); break;
    case 'close-tab': closeTab(id); break;
    case 'new-tab': openTab('blank'); break;
    case 'auth-open': openTab('auth'); break;
    case 'article-open': openTab('article'); break;
    case 'auth-complete': completeAuth(); break;
    case 'main': openMuse(); break;
    case 'back': case 'forward': {
      const tab = selectedTab();
      if (!tab) break;
      tab.position = Math.max(0, Math.min(tab.history.length - 1, tab.position + (action === 'back' ? -1 : 1))); syncTab(tab); render(); break;
    }
    case 'reload': reloadAccount(current()); break;
    case 'suggest': selectedTab().draft = button.dataset.text; render(); $('#chat-draft').focus(); break;
    case 'simulate-error': {
      const tab = selectedTab();
      navigateTab(tab, 'error', tab.url);
      log('模拟加载失败，不代表会话失效', current().id, 'error'); render(); break;
    }
    case 'console': consoleOpen = !consoleOpen; renderConsole(); $('#console-toggle').classList.toggle('active', consoleOpen); $('#console-toggle').setAttribute('aria-expanded', String(consoleOpen)); break;
    case 'show-console': consoleOpen = true; renderConsole(); $('#console-toggle').classList.add('active'); $('#console-toggle').setAttribute('aria-expanded', 'true'); break;
    case 'clear-logs': logs = []; renderConsole(); break;
    case 'copy-diagnostics': copyDiagnostics(); break;
    case 'settings-tab': settingsTab = id; render(); break;
    case 'dialog-cancel': dialog.close(); break;
    case 'docs': showDialog({ title: '原型体验指南', description: '① 点击账号，体验独立的网页标签。\n② 用标签栏“＋”新建，输入网址模拟导航；所有标签均可关闭。\n③ 添加账号后，点击“演示网页认证”。\n④ 仪表盘查看账号概况；顶部控制台独立查看运行日志。\n⑤ 在设置中调整主题和自动休眠。\n\n正式版使用文档将在系统浏览器打开，地址尚未配置。', confirm: '开始体验' }); break;
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'chat-draft') selectedTab().draft = event.target.value;
  if (event.target.id === 'page-address') event.target.setCustomValidity('');
  if (event.target.id === 'account-search') {
    search = event.target.value;
    let count = 0;
    document.querySelectorAll('[data-account-row]').forEach((row) => {
      const a = accounts.find((item) => item.id === row.dataset.accountRow);
      row.hidden = !`${a.name} ${a.note}`.toLowerCase().includes(search.toLowerCase());
      if (!row.hidden) count++;
    });
    $('#no-matches').hidden = count > 0;
  }
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'address-form') {
    event.preventDefault();
    const input = $('#page-address');
    const destination = parseAddress(input.value);
    if (!destination) { input.setCustomValidity('请输入有效的 http 或 https 网址，不支持本地文件、脚本或带账号密码的地址。'); input.reportValidity(); return; }
    const tab = selectedTab();
    if (tab.draft.trim()) { toast('当前标签有未发送文字，请先处理或新建标签再导航。'); return; }
    navigateTab(tab, destination.page, destination.url);
    log('模拟地址导航；未访问外部网站，未记录网址', current().id);
    render(); return;
  }
  if (event.target.id !== 'composer') return;
  event.preventDefault();
  const tab = selectedTab();
  if (!tab.draft.trim()) { $('#chat-draft').focus(); return; }
  tab.message = tab.draft;
  tab.draft = '';
  render();
});
document.addEventListener('change', (event) => {
  const key = event.target.dataset.setting;
  if (key && choices[key].some(([v]) => v === event.target.value)) {
    settings[key] = event.target.value;
    save(); applySettings();
    $('#save-status').innerHTML = `${icon(saveStatus === '保存失败' ? 'info' : 'check')}${saveStatus}`;
    log('更新并尝试保存原型偏好');
    if (key === 'close') toast('仅保存关闭偏好；浏览器原型不控制系统托盘或退出。');
  }
  if (event.target.id === 'console-scope') { consoleScope = event.target.value; renderConsole(); }
  if (event.target.id === 'console-level') { consoleLevel = event.target.value; renderConsole(); }
});
document.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('[data-account-row]');
  if (!row) return;
  event.preventDefault(); openMenu(row.querySelector('[data-action="menu"]'), row.dataset.accountRow);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !accountMenu.hidden) { closeMenu(); lastMenuButton?.focus(); }
  if (!accountMenu.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const items = [...accountMenu.querySelectorAll('button')];
    items[(items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
  if (event.target.classList.contains('resize-handle') && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); setConsoleHeight($('#console').getBoundingClientRect().height + (event.key === 'ArrowUp' ? 20 : -20));
  }
  if (dialog.open || view !== 'account' || !event.ctrlKey) return;
  if (event.key.toLowerCase() === 't') { event.preventDefault(); openTab('blank'); return; }
  if (event.key === 'Tab') {
    event.preventDefault();
    if (!current().tabs.length) return;
    const a = current(); const index = a.tabs.findIndex((t) => t.id === a.activeTab);
    a.activeTab = a.tabs[(index + (event.shiftKey ? a.tabs.length - 1 : 1)) % a.tabs.length].id; render();
  }
  if (event.key.toLowerCase() === 'w') { event.preventDefault(); closeTab(current().activeTab); }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); reloadAccount(current()); }
});
function setConsoleHeight(height) {
  const value = Math.max(130, Math.min(500, height));
  document.documentElement.style.setProperty('--console-height', `${value}px`);
  $('.resize-handle')?.setAttribute('aria-valuenow', String(Math.round(value)));
}
document.addEventListener('pointerdown', (event) => {
  if (!event.target.classList.contains('resize-handle')) return;
  event.preventDefault();
  const start = event.clientY; const height = $('#console').getBoundingClientRect().height;
  const move = (e) => setConsoleHeight(height + start - e.clientY);
  const end = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
setInterval(() => {
  if (settings.sleep === '0') return;
  const cutoff = Number(settings.sleep) * 60_000;
  for (const a of accounts) {
    if (a.leftAt && Date.now() - a.leftAt >= cutoff && !(view === 'account' && activeId === a.id) && !isProtected(a)) sleepAccount(a);
  }
}, 15_000);
applySettings();
log('本地界面原型已启动；未连接真实 Muse 或原生 WebView');
render();
if (storageNotice) toast(storageNotice);
