'use strict';
(async () => {
  const el = (id) => document.querySelector(`[data-testid="${id}"]`);
  function state(id, value, text = value) {
    const target = el(id);
    if (target) { target.dataset.state = value; target.textContent = text; }
  }
  const account = () => el('account-select').value === 'B' ? 'B' : 'A';
  const tab = () => ['T1', 'T2', 'T3'].includes(el('tab-select').value) ? el('tab-select').value : 'T1';
  // Never display arbitrary existing storage values (even in an accidentally reused profile).
  function synthetic(value, session = false) {
    if (value == null) return 'missing';
    return (session ? /^[AB]:T[123]$/ : /^[AB]$/).test(value) ? value : 'unexpected-non-synthetic';
  }
  function database(operation, value) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('muse-m0', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('identity');
      open.onerror = () => reject(new Error('indexeddb-open'));
      open.onblocked = () => reject(new Error('indexeddb-blocked'));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('identity', operation === 'read' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('identity');
        const request = operation === 'write' ? store.put(value, 'account')
          : operation === 'clear' ? store.delete('account') : store.get('account');
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(new Error('indexeddb-transaction')); };
      };
    });
  }
  async function readStorage() {
    let failed = false;
    const reads = [
      ['cookie-value', () => document.cookie.split('; ').find((part) => part.startsWith('muse_m0_cookie='))?.slice('muse_m0_cookie='.length)],
      ['local-value', () => localStorage.getItem('muse_m0_local')],
      ['session-value', () => sessionStorage.getItem('muse_m0_session')],
      ['indexeddb-value', () => database('read')],
    ];
    for (const [id, read] of reads) {
      try { el(id).textContent = synthetic(await read(), id === 'session-value'); }
      catch { el(id).textContent = 'error'; failed = true; }
    }
    state('storage-status', failed ? 'error' : 'read');
  }
  async function storageAction(action) {
    state('storage-status', 'busy');
    try {
      if (action === 'write') {
        const value = account();
        document.cookie = `muse_m0_cookie=${value}; Path=/; Max-Age=86400; SameSite=Lax`;
        localStorage.setItem('muse_m0_local', value);
        sessionStorage.setItem('muse_m0_session', `${value}:${tab()}`);
        await database('write', value);
      } else if (action === 'session') {
        sessionStorage.setItem('muse_m0_session', `${account()}:${tab()}`);
      } else if (action === 'clear') {
        if (!window.confirm('仅清除当前 profile 当前源的 M0 测试键；Cookie 对同主机另一端口也有效。继续？')) {
          state('storage-status', 'cancelled'); return;
        }
        document.cookie = 'muse_m0_cookie=; Path=/; Max-Age=0; SameSite=Lax';
        localStorage.removeItem('muse_m0_local');
        sessionStorage.removeItem('muse_m0_session');
        await database('clear');
      }
      await readStorage();
    } catch { state('storage-status', 'error', 'error (may have partially written; read to inspect)'); }
  }

  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('config');
    const { role, origins } = await response.json();
    if (!['parent', 'popup'].includes(role) || location.origin !== origins[role]) throw new Error('origin');
    el('current-origin').textContent = location.origin;
    const children = new Map(); // Preserve actual WindowProxy, not a URL copied to a new view.
    let rejected = 0;
    function renderChild(child) {
      child.row.dataset.result = child.result;
      child.row.dataset.closed = child.closed;
      child.row.dataset.account = child.account;
      child.row.dataset.origin = child.origin;
      child.row.dataset.source = child.source;
      child.row.dataset.state = child.result === 'success' && child.closed === 'true' ? 'closed-after-result'
        : child.closed === 'true' ? 'closed-without-result' : child.result;
      child.row.textContent = `account=${child.account}; result=${child.result}; closed=${child.closed}; origin=${child.origin}; source=${child.source}`;
    }
    el('open-popup').onclick = () => {
      const id = crypto.randomUUID();
      const selected = account();
      const url = new URL('/popup', origins.popup);
      url.search = new URLSearchParams({ request: id, account: selected, opener: role }).toString();
      // Synchronous user click, no noopener: opener identity is the subject of this fixture.
      let win;
      try { win = window.open(url.href, '_blank', 'popup,width=640,height=760'); }
      catch { state('message-status', 'open-error'); return; }
      if (!win) { state('message-status', 'blocked-or-unassociated'); return; }
      const row = document.createElement('li');
      row.dataset.testid = 'popup-record';
      row.dataset.requestId = id;
      const child = { win, row, account: selected, result: 'pending', closed: 'false', origin: 'none', source: 'unmatched' };
      children.set(id, child);
      el('popup-list').append(row);
      renderChild(child);
      state('message-status', 'waiting');
    };
    window.addEventListener('message', (event) => {
      const payload = event.data;
      const child = payload && typeof payload === 'object' && typeof payload.request === 'string'
        ? children.get(payload.request) : undefined;
      if (event.origin !== origins.popup || !child || event.source !== child.win
          || child.result !== 'pending' || payload.type !== 'muse-m0-synthetic-result'
          || payload.account !== child.account || payload.result !== 'synthetic-ok') {
        el('rejected-count').textContent = String(++rejected);
        state('message-status', 'rejected');
        return;
      }
      child.result = 'success';
      child.origin = event.origin;
      child.source = 'matched';
      renderChild(child);
      el('message-origin').textContent = event.origin;
      state('message-status', 'success', `success; source=matched; synthetic account=${child.account}`);
    });

    let callback;
    if (role === 'popup') {
      const query = new URLSearchParams(location.search);
      const request = query.get('request');
      const requestedAccount = query.get('account');
      const openerRole = query.get('opener');
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request || '')
          && ['A', 'B'].includes(requestedAccount) && ['parent', 'popup'].includes(openerRole)) {
        callback = { request, account: requestedAccount, origin: origins[openerRole] };
        el('account-select').value = requestedAccount;
        el('request-account').textContent = requestedAccount;
      }
      el('complete-auth').onclick = () => {
        if (!callback) { state('send-status', 'invalid-request'); return; }
        if (!window.opener || window.opener.closed) { state('send-status', 'opener-missing-or-closed'); return; }
        try {
          window.opener.postMessage({ type: 'muse-m0-synthetic-result', request: callback.request,
            account: callback.account, result: 'synthetic-ok' }, callback.origin);
          state('send-status', 'sent-close-requested');
          el('complete-auth').disabled = true;
          window.close();
          setTimeout(() => state('send-status', 'close-not-observed', 'sent, but page still running; inspect direct opener'), 500);
        } catch { state('send-status', 'send-or-close-error'); }
      };
      el('close-self').onclick = () => window.close();
      el('close-opener').onclick = () => {
        if (!window.opener || window.opener.closed) { state('close-opener-status', 'opener-missing-or-closed'); return; }
        try {
          window.opener.close();
          state('close-opener-status', 'requested');
          setTimeout(() => state('close-opener-status', window.opener?.closed ? 'closed' : 'not-closed'), 500);
        } catch { state('close-opener-status', 'denied-or-error'); }
      };
    }
    const timer = setInterval(() => {
      for (const child of children.values()) {
        try { child.closed = String(child.win.closed); }
        catch { child.closed = 'unknown'; }
        renderChild(child);
      }
      if (role === 'popup') {
        state('opener-status', !window.opener ? 'missing' : window.opener.closed ? 'closed' : 'present');
      }
    }, 250);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    if (el('open-tab')) el('open-tab').onclick = () => {
      const win = window.open(`${origins.parent}/parent`, '_blank');
      state('tab-open-status', win ? 'opened' : 'blocked-or-unassociated');
    };
    el('write-storage').onclick = () => storageAction('write');
    el('write-session').onclick = () => storageAction('session');
    el('read-storage').onclick = readStorage;
    el('clear-storage').onclick = () => storageAction('clear');
    el('probe-native').onclick = async () => {
      const bridge = window.__TAURI_INTERNALS__;
      if (typeof bridge?.invoke !== 'function') { state('native-status', 'unavailable'); return; }
      state('native-status', 'pending');
      try {
        // Do not print, retain or inspect the response; no mutating command is attempted.
        await bridge.invoke('workspace_snapshot');
        state('native-status', 'unexpected-resolved', 'unexpected-resolved: remote page accessed workspace; security failure');
      } catch { state('native-status', 'rejected-unclassified', 'rejected-unclassified: confirm capability denial in native diagnostics'); }
    };
    document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    if (role === 'popup' && !callback) el('complete-auth').disabled = true;
    state('page-status', 'ready');
    await readStorage();
  } catch { state('page-status', 'error', 'error: configuration or initialization failed'); }
})();
