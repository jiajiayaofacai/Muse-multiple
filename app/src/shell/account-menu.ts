import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { escapeHtml as esc } from '../ui/markup';

// Resolve the target from the latest snapshot, never from the selected sidebar row.
export function accountMenuModel(snapshot: WorkspaceSnapshot | null, id: string) {
  const account = snapshot?.accounts.find(item => item.id === id);
  if (!snapshot || !account) return null;
  const runtime = snapshot.runtimes.find(item => item.accountId === id);
  const tabs = snapshot.tabs.filter(tab => tab.accountId === id);
  const tab = tabs.find(item => item.id === runtime?.activeTabId);
  const wake = runtime?.lifecycle === 'sleeping';
  const items = [
    { action: 'open-account', label: wake ? '唤醒并打开账号' : '打开账号', short: wake ? '唤醒' : '打开', enabled: true },
    { action: 'edit-account', label: '编辑名称和备注', short: '编辑', enabled: true },
    { action: 'refresh-account', label: '刷新此账号当前标签', short: '刷新', enabled: !!tab },
    { action: 'close-account-tabs', label: '关闭此账号全部标签', short: '关页', enabled: tabs.length > 0 },
    { action: 'sleep-account', label: '休眠后台账号', short: '休眠', enabled: snapshot.activeAccountId !== id && runtime?.lifecycle === 'background' },
    { action: 'delete-account', label: '删除此账号', short: '删除', enabled: true },
  ];
  return { account, tab, items };
}

type Model = ReturnType<typeof accountMenuModel>;
const triggerSelector = '[data-action="account-menu"]';

export function attachAccountMenu(sidebar: HTMLElement, getModel: (id: string) => Model) {
  const menu = sidebar.querySelector<HTMLElement>('#account-menu')!;
  let accountId: string | null = null;
  const events = new AbortController();
  const options = { signal: events.signal };
  const trigger = () => accountId === null ? null : sidebar.querySelector<HTMLButtonElement>(`${triggerSelector}[data-id="${CSS.escape(accountId)}"]`);
  const buttons = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));

  function close(restoreFocus = false) {
    if (accountId === null) return;
    const anchor = trigger();
    accountId = null;
    anchor?.setAttribute('aria-expanded', 'false');
    anchor?.removeAttribute('aria-controls');
    menu.hidden = true;
    menu.replaceChildren();
    if (restoreFocus) anchor?.focus();
  }

  function position() {
    if (menu.hidden) return;
    const anchor = trigger();
    if (!anchor) return close();
    const bounds = sidebar.getBoundingClientRect();
    const row = anchor.getBoundingClientRect();
    const list = anchor.closest('.accounts')!.getBoundingClientRect();
    if (row.bottom <= list.top || row.top >= list.bottom) return close();
    // DOMRects are zoomed; CSS top and offsetHeight are in local sidebar pixels.
    const scale = bounds.height / sidebar.offsetHeight;
    if (!scale) return;
    const below = (row.bottom - bounds.top) / scale + 2;
    const above = (row.top - bounds.top) / scale - menu.offsetHeight - 2;
    menu.style.top = `${Math.max(0, below + menu.offsetHeight <= sidebar.clientHeight ? below : above)}px`;
  }

  function refresh() {
    if (accountId === null) return;
    const model = getModel(accountId);
    const anchor = trigger();
    if (!anchor || anchor.disabled || !model) return close();
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', menu.id);
    menu.setAttribute('aria-label', `${model.account.name} 的账号操作`);
    const focused = menu.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.action : null;
    const markup = model.items.map(item => `<button type="button" role="menuitem" tabindex="-1" data-action="${item.action}" data-id="${esc(model.account.id)}" title="${item.label}" aria-label="${item.label}" ${item.enabled ? '' : 'disabled'}><span>${item.label}</span><small aria-hidden="true">${item.short}</small></button>`).join('');
    // Do not replace the focused menu item on unrelated native snapshot events.
    if (menuMarkup !== markup) {
      menu.innerHTML = markup;
      menuMarkup = markup;
      if (focused) (buttons().find(item => item.dataset.action === focused) ?? buttons()[0])?.focus();
    }
    position();
  }
  let menuMarkup = '';

  function open(id: string, last = false) {
    close();
    accountId = id;
    menuMarkup = '';
    menu.hidden = false;
    refresh();
    const items = buttons();
    items[last ? items.length - 1 : 0]?.focus();
  }

  sidebar.addEventListener('click', event => {
    const anchor = (event.target as Element).closest<HTMLButtonElement>(triggerSelector);
    if (!anchor?.dataset.id || anchor.disabled) return;
    if (accountId === anchor.dataset.id) close(true);
    else open(anchor.dataset.id);
  }, options);
  sidebar.addEventListener('contextmenu', event => {
    const row = (event.target as Element).closest('.account-item');
    if (!row) return;
    event.preventDefault();
    const anchor = row.querySelector<HTMLButtonElement>(triggerSelector);
    if (anchor?.dataset.id && !anchor.disabled) open(anchor.dataset.id);
  }, options);
  sidebar.addEventListener('keydown', event => {
    const anchor = (event.target as Element).closest<HTMLButtonElement>(triggerSelector);
    if (anchor?.dataset.id && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      return open(anchor.dataset.id, event.key === 'ArrowUp');
    }
    if (accountId === null) return;
    if (event.key === 'Tab') return close(true); // Let the UA advance from the trigger.
    if (event.key === 'Escape') { event.preventDefault(); return close(true); }
    const items = buttons();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = { Home: 0, End: items.length - 1, ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length }[event.key];
    if (next !== undefined) { event.preventDefault(); items[next].focus(); }
  }, options);
  function dismissOutside(event: Event) {
    if (accountId === null || !(event.target instanceof Node)) return;
    if (!menu.contains(event.target) && !trigger()?.contains(event.target)) close();
  }
  document.addEventListener('pointerdown', dismissOutside, { capture: true, ...options });
  document.addEventListener('focusin', dismissOutside, options);
  window.addEventListener('blur', () => close(), options);
  sidebar.addEventListener('scroll', position, { capture: true, ...options });
  const resize = new ResizeObserver(position);
  resize.observe(sidebar);
  return { refresh, close, targets: (id: string) => accountId === id, dispose() { events.abort(); resize.disconnect(); close(); } };
}
