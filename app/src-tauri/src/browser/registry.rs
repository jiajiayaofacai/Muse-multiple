use super::{logic, model::*};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub(super) const GATE: &str = "BLOCKED: 同窗认证未验证；同步 reparent 后 Create 的宿主查找不安全，异步接管与 close/宿主生命周期未获验证。window.open 已拒绝；未降级独立弹窗或系统浏览器。";

pub(super) struct BrowserState {
    pub root: PathBuf,
    pub _instance_lock: std::fs::File,
    pub registry: Mutex<Registry>,
    // Never hold the registry mutex while entering a native API (callbacks may reenter).
    pub operation: Mutex<()>,
}

pub(super) struct Registry {
    pub snapshot: Snapshot,
    pub opened: HashSet<String>,
    pub bounds: Option<ContentBounds>,
    diagnostic_seq: u64,
}

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .unwrap_or_default()
}

pub(super) fn lock(app: &AppHandle) -> Result<MutexGuard<'_, Registry>, AppError> {
    let state = app
        .try_state::<BrowserState>()
        .ok_or_else(|| AppError::new("not_installed", "原生浏览模块未安装"))?;
    // State::inner has the application's lifetime, unlike the temporary State wrapper.
    state
        .inner()
        .registry
        .lock()
        .map_err(|_| AppError::new("state_unavailable", "浏览状态锁不可用，请重启应用"))
}

impl Registry {
    pub fn new(accounts: Vec<Account>) -> Self {
        let runtimes = accounts
            .iter()
            .map(|a| Runtime {
                account_id: a.id.clone(),
                lifecycle: "unopened",
                session_status: "unknown",
                active_tab_id: None,
                protection_reasons: Vec::new(),
            })
            .collect();
        let mut registry = Self {
            snapshot: Snapshot {
                revision: 1,
                accounts,
                tabs: Vec::new(),
                runtimes,
                settings: Settings::default(),
                diagnostics: Vec::new(),
                active_account_id: None,
                gate_status: GATE.into(),
            },
            opened: HashSet::new(),
            bounds: None,
            diagnostic_seq: 0,
        };
        registry.diagnostic(None, "authentication_gate_blocked", GATE);
        registry.diagnostic(None, "history_unavailable", "M0 未接入可靠的原生历史查询或加载失败回调；历史按钮不可用，load finished 不代表登录或网络成功");
        registry
    }

    pub fn account(&self, id: &str) -> Result<usize, AppError> {
        if !logic::canonical_id(id) {
            return Err(AppError::new("invalid_account_id", "账号 ID 非法"));
        }
        self.snapshot
            .accounts
            .iter()
            .position(|a| a.id == id)
            .ok_or_else(|| AppError::new("account_not_found", "账号不存在"))
    }

    pub fn tab(&self, account: &str, tab: &str) -> Result<usize, AppError> {
        self.account(account)?;
        self.snapshot
            .tabs
            .iter()
            .position(|t| t.id == tab && logic::owned_tab(account, &t.account_id, tab))
            .ok_or_else(|| AppError::new("tab_not_found", "标签不存在或不属于此账号"))
    }

    pub fn select(&mut self, account: &str, tab: Option<String>) {
        self.snapshot.active_account_id = Some(account.into());
        for runtime in &mut self.snapshot.runtimes {
            if runtime.account_id == account {
                runtime.active_tab_id = tab.clone();
            }
            runtime.lifecycle = if !self.opened.contains(&runtime.account_id) {
                "unopened"
            } else if runtime.account_id == account {
                "active"
            } else {
                "background"
            };
        }
    }

    pub fn forget_tab(&mut self, account: &str, tab: &str) {
        self.snapshot.tabs.retain(|t| t.id != tab);
        let replacement = self
            .snapshot
            .tabs
            .iter()
            .rev()
            .find(|t| t.account_id == account)
            .map(|t| t.id.clone());
        if let Some(runtime) = self
            .snapshot
            .runtimes
            .iter_mut()
            .find(|r| r.account_id == account)
            && runtime.active_tab_id.as_deref() == Some(tab)
        {
            runtime.active_tab_id = replacement;
        }
        // `opened` deliberately remains set even when the last tab closes.
    }

    pub fn changed(&mut self) {
        self.snapshot.revision += 1;
    }

    pub fn diagnostic(&mut self, account: Option<&str>, code: &'static str, message: &'static str) {
        self.diagnostic_seq += 1;
        self.snapshot.diagnostics.push(Diagnostic {
            id: self.diagnostic_seq,
            timestamp: now(),
            level: "warn",
            account_id: account.map(str::to_owned),
            code,
            safe_message: message,
        });
        if self.snapshot.diagnostics.len() > 100 {
            self.snapshot.diagnostics.remove(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const A: &str = "6ee7080e-e0ba-4a70-bd01-df306c2d351f";
    const T: &str = "194b5aa2-c1f4-45c3-9e00-ab0637999e4e";
    #[test]
    fn cold_start_and_last_tab_stay_empty() {
        let mut r = Registry::new(vec![Account {
            id: A.into(),
            name: "合成账号".into(),
            note: String::new(),
            last_used_at: 0,
        }]);
        assert!(r.snapshot.tabs.is_empty());
        assert!(r.snapshot.active_account_id.is_none());
        assert_eq!(r.snapshot.runtimes[0].session_status, "unknown");
        r.opened.insert(A.into());
        r.snapshot.tabs.push(Tab {
            id: T.into(),
            account_id: A.into(),
            opener_tab_id: None,
            purpose: "normal",
            title: String::new(),
            display_url: "about:blank".into(),
            load_state: LoadState::Loading,
            can_go_back: false,
            can_go_forward: false,
        });
        r.select(A, Some(T.into()));
        r.forget_tab(A, T);
        r.select(A, None);
        assert!(r.opened.contains(A));
        assert!(r.snapshot.tabs.is_empty());
        assert!(r.snapshot.runtimes[0].active_tab_id.is_none());
        assert!(r.tab(A, T).is_err());
    }
}
