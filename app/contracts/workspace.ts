export interface AccountDto { id: string; name: string; note: string; lastUsedAt: number }
export interface TabDto { id: string; accountId: string; openerTabId: string | null; purpose: 'normal' | 'authentication'; title: string; displayUrl: string; loadState: 'loading' | 'ready' | 'error'; canGoBack: boolean; canGoForward: boolean }
export interface RuntimeDto { accountId: string; lifecycle: 'unopened' | 'active' | 'background' | 'sleeping'; sessionStatus: 'unknown' | 'authenticating' | 'reauthRequired'; activeTabId: string | null; protectionReasons: string[] }
export interface ProxySettingsDto { enabled: boolean; scheme: 'http' | 'socks5'; host: string; port: number }
export interface SettingsDto { closeBehavior: 'exit' | 'tray'; theme: 'system' | 'light' | 'dark'; uiZoomPercent: number; webZoomPercent: number; autoSleepMinutes: number; proxy: ProxySettingsDto }
export interface DiagnosticDto { id: number; timestamp: number; level: 'info' | 'warn' | 'error'; accountId: string | null; code: string; safeMessage: string }
export interface WorkspaceSnapshot { revision: number; accounts: AccountDto[]; tabs: TabDto[]; runtimes: RuntimeDto[]; settings: SettingsDto; diagnostics: DiagnosticDto[]; activeAccountId: string | null; gateStatus: string }
export interface CommandError { code: string; safeMessage: string; retryable: boolean }
export interface ContentBounds { x: number; y: number; width: number; height: number; visible: boolean; layoutSeq: number }
export type WorkspaceAction =
  | { type: 'createAccount'; name: string; note?: string }
  | { type: 'activateAccount'; accountId: string }
  | { type: 'updateAccount'; accountId: string; name: string; note: string }
  | { type: 'createTab'; accountId: string; url: string }
  | { type: 'deleteAccount'; accountId: string }
  | { type: 'closeAllTabs'; accountId: string }
  | { type: 'updateSettings'; settings: SettingsDto }
  | { type: 'retryProfileCleanup' }
  | { type: 'sleepAccount'; accountId: string; automatic?: boolean }
  | { type: 'activateTab' | 'closeTab' | 'back' | 'forward' | 'reload' | 'stop'; accountId: string; tabId: string }
  | { type: 'navigate'; accountId: string; tabId: string; url: string }
  | { type: 'openProjectLink'; kind: 'github' | 'docs' | 'releases' };
// Commands: workspace_layout_begin() returns the last layoutSeq after hiding old views;
// workspace_snapshot(), workspace_action({action}), workspace_layout({bounds}).
// Events: workspace_changed carries a full WorkspaceSnapshot. Never log navigation URL parameters.
