import type { DiagnosticDto, WorkspaceSnapshot } from '../../contracts/workspace';

type InputResult = { ok: true; value: string } | { ok: false; message: string };

export function accountName(input: string): InputResult {
  const value = input.trim();
  return value ? { ok: true, value } : { ok: false, message: '请填写账号名称，不能只输入空格。' };
}
export type AccountMetadataResult = { ok: true; name: string; note: string } | { ok: false; message: string };

export function accountMetadata(nameInput: string, noteInput: string): AccountMetadataResult {
  const name = nameInput.trim();
  const note = noteInput.trim();
  if (!name) return { ok: false, message: '请填写账号名称，不能只输入空格。' };
  if (Array.from(name).length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, message: '账号名称最多 80 个字符，且不能包含控制字符。' };
  }
  if (Array.from(note).length > 2000) return { ok: false, message: '备注最多 2000 个字符。' };
  return { ok: true, name, note };
}

export function navigationUrl(input: string): InputResult {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return { ok: false, message: '请输入完整的 http:// 或 https:// 网页地址。' };
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return { ok: false, message: '仅支持不含用户名和密码的 http:// 或 https:// 网页地址。' };
    }
    return { ok: true, value: url.href };
  } catch {
    return { ok: false, message: '请输入完整的 http:// 或 https:// 网页地址。' };
  }
}

export function acceptSnapshot(current: WorkspaceSnapshot | null, incoming: WorkspaceSnapshot): WorkspaceSnapshot {
  return !current || incoming.revision > current.revision ? incoming : current;
}

export function accountNewWindowDiagnostic(snapshot: WorkspaceSnapshot | null, accountId: string | null): DiagnosticDto | null {
  if (!snapshot || !accountId || !snapshot.accounts.some(account => account.id === accountId)) return null;
  // Diagnostics outlive source tabs; their accountId is the only ownership signal.
  return snapshot.diagnostics.reduce<DiagnosticDto | null>((latest, item) =>
    item.accountId === accountId && (item.code === 'new_window_blocked' || item.code === 'new_window_failed') && (!latest || item.id > latest.id)
      ? item : latest, null);
}

export function workspaceCounts(snapshot: WorkspaceSnapshot | null) {
  if (!snapshot) return null;
  return {
    accounts: snapshot.accounts.length,
    resident: snapshot.runtimes.filter(runtime => runtime.lifecycle === 'active' || runtime.lifecycle === 'background').length,
    sleeping: snapshot.runtimes.filter(runtime => runtime.lifecycle === 'sleeping').length,
    tabs: snapshot.tabs.length,
  };
}

export const lifecycleLabels = { unopened: '未打开', active: '活跃', background: '后台', sleeping: '休眠' };
export const sessionLabels = { unknown: '登录状态未验证', authenticating: '认证进行中', reauthRequired: '需要重新认证' };
