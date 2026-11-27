// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSnapshot } from '../../contracts/workspace';
import { accountMenuModel, attachAccountMenu } from './account-menu';

const initialSnapshot: WorkspaceSnapshot = {
  revision: 1,
  accounts: [{ id: 'a', name: 'A', note: '', lastUsedAt: 0 }],
  tabs: [], runtimes: [], diagnostics: [], activeAccountId: null, gateStatus: 'ready',
  settings: { closeBehavior: 'exit', theme: 'system', uiZoomPercent: 100, webZoomPercent: 100, autoSleepMinutes: 15, proxy: { enabled: false, scheme: 'http', host: '', port: 0 } },
};
let snapshot: WorkspaceSnapshot;

const rect = (top: number, bottom: number, height = bottom - top) => ({ x: 0, y: top, top, right: 200, bottom, left: 0, width: 200, height, toJSON: () => ({}) }) as DOMRect;

function mountMenu(rowTop = 20, rowBottom = 60, sidebarHeight = 400, clientHeight = 200, menuHeight = 100) {
  document.body.innerHTML = '<aside id="sidebar"><div class="accounts"><div class="account-item"><button data-action="account-menu" data-id="a"></button></div></div><div id="account-menu" hidden></div><button id="outside">outside</button></aside>';
  const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
  const trigger = sidebar.querySelector<HTMLButtonElement>('[data-action="account-menu"]')!;
  const accountList = sidebar.querySelector<HTMLElement>('.accounts')!;
  const menu = sidebar.querySelector<HTMLElement>('#account-menu')!;
  Object.defineProperty(sidebar, 'offsetHeight', { configurable: true, value: sidebarHeight });
  Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: menuHeight });
  sidebar.getBoundingClientRect = () => rect(0, sidebarHeight, sidebarHeight);
  trigger.getBoundingClientRect = () => rect(rowTop, rowBottom);
  accountList.getBoundingClientRect = () => rect(0, 400, 400);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const observerDisconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() { observerDisconnect(); } });
  const api = attachAccountMenu(sidebar, id => accountMenuModel(snapshot, id));
  return { api, sidebar, trigger, menu, observerDisconnect };
}

function key(target: Element, name: string) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function click(target: Element) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => { snapshot = { ...initialSnapshot, accounts: [...initialSnapshot.accounts], tabs: [], runtimes: [], diagnostics: [] }; });
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('账号操作菜单 DOM 交互', () => {
  it('点击打开菜单、呈现账号标签、定位并再次点击关闭且恢复焦点', () => {
    const { api, trigger, menu } = mountMenu();
    click(trigger);
    expect(menu.hidden).toBe(false);
    expect(menu.getAttribute('aria-label')).toBe('A 的账号操作');
    expect(menu.innerHTML).toContain('打开账号');
    expect(menu.style.top).toBe('62px');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    click(trigger);
    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger).toBe(document.activeElement);
    api.dispose();
  });

  it('支持上下方向、Home/End、Escape 与 Tab 导航', () => {
    const { api, trigger, menu } = mountMenu();
    trigger.focus();
    key(trigger, 'ArrowDown');
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowDown');
    expect(document.activeElement).toBe(items.at(-1));
    key(items.at(-1)!, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'End');
    expect(document.activeElement).toBe(items.at(-1));
    key(items.at(-1)!, 'Home');
    expect(document.activeElement).toBe(items[0]);
    const escape = key(items[0], 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(true);
    expect(trigger).toBe(document.activeElement);
    key(trigger, 'ArrowUp');
    const reopenedItems = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    expect(document.activeElement).toBe(reopenedItems.at(-1));
    key(reopenedItems.at(-1)!, 'Tab');
    expect(menu.hidden).toBe(true);
    api.dispose();
  });

  it('右键打开；菜单外点击、焦点和窗口失焦均关闭', () => {
    const { api, sidebar, trigger, menu } = mountMenu();
    const row = trigger.closest('.account-item')!;
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    row.dispatchEvent(context);
    expect(context.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
    click(trigger);
    document.querySelector<HTMLButtonElement>('#outside')!.focus();
    expect(menu.hidden).toBe(true);
    click(trigger);
    window.dispatchEvent(new Event('blur'));
    expect(menu.hidden).toBe(true);
    api.dispose();
    expect(sidebar.querySelector('#account-menu')).not.toBeNull();
  });

  it('隐藏或移出列表的来源行会关闭菜单，滚动后重新定位', () => {
    const { api, trigger, menu } = mountMenu(150, 190, 400, 200, 100);
    click(trigger);
    expect(menu.style.top).toBe('48px');
    trigger.getBoundingClientRect = () => rect(500, 550);
    const scroll = new Event('scroll', { bubbles: true });
    trigger.dispatchEvent(scroll);
    expect(menu.hidden).toBe(true);
    api.dispose();
  });

  it('刷新时保留仍存在的焦点项，禁用或删除目标账号后关闭', () => {
    const { api, trigger, menu } = mountMenu();
    click(trigger);
    const refresh = menu.querySelector<HTMLButtonElement>('[data-action="edit-account"]')!;
    refresh.focus();
    snapshot = { ...snapshot, runtimes: [{ accountId: 'a', lifecycle: 'sleeping', sessionStatus: 'unknown', activeTabId: null, protectionReasons: [] }] };
    api.refresh();
    const recreated = menu.querySelector<HTMLButtonElement>('[data-action="edit-account"]')!;
    expect(recreated).not.toBe(refresh);
    expect(recreated).toBe(document.activeElement);
    expect(menu.querySelector('[data-action="edit-account"]')).toBe(document.activeElement);
    trigger.disabled = true;
    api.refresh();
    expect(menu.hidden).toBe(true);
    api.dispose();
  });

  it('dispose 中止事件监听并断开尺寸观察', () => {
    const { api, trigger, menu, observerDisconnect } = mountMenu(20, 60, 0, 200);
    click(trigger);
    expect(menu.hidden).toBe(false);
    api.dispose();
    expect(menu.hidden).toBe(true);
    click(trigger);
    expect(menu.hidden).toBe(true);
    expect(observerDisconnect).toHaveBeenCalledTimes(1);
  });
});
