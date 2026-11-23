use super::{logic, model::*};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const LOGIN_VERIFICATION_PENDING: &str = "原页登录待验收：电话/邮箱、验证码及可选两步验证在原页完成；外部授权使用来源账号内的新标签，保留原生窗口关系；登录与应用连接结果须分别人工验收。";

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
    pending_popups: HashSet<String>,
    closing: HashSet<String>,
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
                gate_status: LOGIN_VERIFICATION_PENDING.into(),
            },
            opened: HashSet::new(),
            bounds: None,
            pending_popups: HashSet::new(),
            closing: HashSet::new(),
            diagnostic_seq: 0,
        };
        registry.diagnostic(
            None,
            "login_verification_pending",
            LOGIN_VERIFICATION_PENDING,
        );
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
        let index = self.owned_tab(account, tab)?;
        if self.closing.contains(tab) {
            return Err(AppError::new("tab_closing", "标签正在关闭"));
        }
        Ok(index)
    }

    fn owned_tab(&self, account: &str, tab: &str) -> Result<usize, AppError> {
        self.account(account)?;
        self.snapshot
            .tabs
            .iter()
            .position(|t| t.id == tab && logic::owned_tab(account, &t.account_id, tab))
            .ok_or_else(|| AppError::new("tab_not_found", "标签不存在或不属于此账号"))
    }

    pub fn select(&mut self, account: &str, tab: Option<String>) {
        if self.account(account).is_err()
            || tab
                .as_deref()
                .is_some_and(|id| self.tab(account, id).is_err())
        {
            return;
        }
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

    pub fn forget_tab(&mut self, account: &str, tab: &str) -> bool {
        let Ok(index) = self.owned_tab(account, tab) else {
            return false;
        };
        let removed = self.snapshot.tabs.remove(index);
        self.pending_popups.remove(tab);
        self.closing.remove(tab);
        let replacement = removed
            .opener_tab_id
            .filter(|opener| {
                self.tab(account, opener).is_ok() && !self.pending_popups.contains(opener)
            })
            .or_else(|| {
                self.snapshot
                    .tabs
                    .iter()
                    .rev()
                    .find(|t| {
                        t.account_id == account
                            && !self.closing.contains(&t.id)
                            && !self.pending_popups.contains(&t.id)
                    })
                    .map(|t| t.id.clone())
            });
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
        true
    }

    pub fn begin_close(&mut self, account: &str, tab: &str) -> Result<bool, AppError> {
        self.owned_tab(account, tab)?;
        // A failed discard remains unauthorized, but explicit close may retry cleanup.
        Ok(self.closing.insert(tab.into()))
    }

    pub fn cancel_close(&mut self, account: &str, tab: &str) {
        if self.owned_tab(account, tab).is_ok() {
            self.closing.remove(tab);
        }
    }

    pub fn register_popup(
        &mut self,
        account: &str,
        opener: &str,
        id: &str,
        display_url: String,
    ) -> Result<(), AppError> {
        self.tab(account, opener)?;
        if !logic::canonical_id(id) || self.snapshot.tabs.iter().any(|t| t.id == id) {
            return Err(AppError::new("invalid_tab_id", "标签 ID 非法或已存在"));
        }
        if self.snapshot.tabs.len() >= 100 {
            return Err(AppError::new("tab_limit", "M0 同时打开标签上限为 100"));
        }
        self.snapshot.tabs.push(Tab {
            id: id.into(),
            account_id: account.into(),
            opener_tab_id: Some(opener.into()),
            purpose: "normal",
            title: String::new(),
            display_url,
            load_state: LoadState::Loading,
            can_go_back: false,
            can_go_forward: false,
        });
        self.pending_popups.insert(id.into());
        self.changed();
        Ok(())
    }

    pub fn complete_popup(&mut self, account: &str, tab: &str) -> bool {
        let Ok(index) = self.tab(account, tab) else {
            return false;
        };
        if !self.pending_popups.remove(tab) {
            return false;
        }
        let opener = self.snapshot.tabs[index].opener_tab_id.clone();
        // Never select the global account, or overwrite a newer tab selection.
        // A surviving child can complete even when its opener has already closed.
        if let Some(runtime) = self
            .snapshot
            .runtimes
            .iter_mut()
            .find(|r| r.account_id == account)
            && (runtime.active_tab_id == opener || runtime.active_tab_id.is_none())
        {
            runtime.active_tab_id = Some(tab.into());
        }
        self.changed();
        true
    }

    pub fn record_new_window_blocked(&mut self, account: &str, tab: &str) -> bool {
        // Attribute only to the live source, never to whichever account is active now.
        if self.tab(account, tab).is_err() {
            return false;
        }
        self.diagnostic(
            Some(account),
            "new_window_blocked",
            "本次新窗口请求受限：未建立安全的来源标签，未打开替代窗口；原页登录独立，登录与应用连接结果须分别验收。",
        );
        self.changed();
        true
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
    const B: &str = "95466371-b57c-4df9-81ca-f59065276a0b";
    const U: &str = "f7e5b760-6ace-4235-b80c-d066dc2d4d95";

    fn two_accounts_with_tabs() -> Registry {
        let mut r = Registry::new(
            [A, B]
                .into_iter()
                .map(|id| Account {
                    id: id.into(),
                    name: "合成账号".into(),
                    note: String::new(),
                    last_used_at: 0,
                })
                .collect(),
        );
        for (account, tab) in [(A, T), (B, U)] {
            r.opened.insert(account.into());
            r.snapshot.tabs.push(Tab {
                id: tab.into(),
                account_id: account.into(),
                opener_tab_id: None,
                purpose: "normal",
                title: String::new(),
                display_url: "about:blank".into(),
                load_state: LoadState::Loading,
                can_go_back: false,
                can_go_forward: false,
            });
            r.select(account, Some(tab.into()));
        }
        r
    }

    #[test]
    fn startup_reports_pending_in_page_login_without_claiming_an_outcome() {
        let r = Registry::new(vec![Account {
            id: A.into(),
            name: "合成账号".into(),
            note: String::new(),
            last_used_at: 0,
        }]);
        assert_eq!(r.snapshot.runtimes[0].session_status, "unknown");
        assert!(r.snapshot.active_account_id.is_none());
        assert!(r.snapshot.tabs.is_empty());
        assert!(r.opened.is_empty());
        assert!(r.snapshot.gate_status.contains("原页登录待验收"));
        assert!(r.snapshot.gate_status.contains("来源账号内的新标签"));
        for unsupported_claim in ["BLOCKED", "已登录", "已连接", "登录失败"] {
            assert!(!r.snapshot.gate_status.contains(unsupported_claim));
        }
        assert_eq!(r.snapshot.diagnostics[0].code, "login_verification_pending");
        assert_eq!(
            r.snapshot.diagnostics[0].safe_message,
            r.snapshot.gate_status
        );
        assert!(r.snapshot.diagnostics[0].account_id.is_none());
        assert!(
            r.snapshot
                .diagnostics
                .iter()
                .all(|d| d.code != "authentication_gate_blocked")
        );
        assert!(serde_json::to_value(&r.snapshot).unwrap()["gateStatus"].is_string());
    }

    #[test]
    fn diagnostics_keep_the_latest_hundred_with_monotonic_ids() {
        let mut r = Registry::new(Vec::new());
        let initial_id = r.snapshot.diagnostics.last().unwrap().id;
        for _ in 0..105 {
            r.diagnostic(Some(A), "synthetic_event", "合成固定脱敏诊断");
        }
        assert_eq!(r.snapshot.diagnostics.len(), 100);
        assert_eq!(r.snapshot.diagnostics[0].id, initial_id + 6);
        assert_eq!(r.snapshot.diagnostics[99].id, initial_id + 105);
        assert!(
            r.snapshot
                .diagnostics
                .windows(2)
                .all(|pair| pair[0].id + 1 == pair[1].id)
        );
        assert!(r.snapshot.diagnostics.iter().all(|d| {
            d.account_id.as_deref() == Some(A)
                && d.code == "synthetic_event"
                && d.safe_message == "合成固定脱敏诊断"
        }));
    }

    #[test]
    fn popup_from_a_while_b_is_active_changes_only_a_diagnostic_and_revision() {
        let mut r = two_accounts_with_tabs();
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(B));
        let mut expected = r.snapshot.clone();
        let opened = r.opened.clone();

        assert!(r.record_new_window_blocked(A, T));

        let diagnostic = r.snapshot.diagnostics.last().unwrap();
        assert_eq!(diagnostic.account_id.as_deref(), Some(A));
        assert_eq!(diagnostic.code, "new_window_blocked");
        assert!(diagnostic.safe_message.contains("本次新窗口请求受限"));
        assert!(diagnostic.safe_message.contains("原页登录独立"));
        expected.diagnostics.push(diagnostic.clone());
        expected.revision += 1;
        assert_eq!(
            serde_json::to_value(&r.snapshot).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert_eq!(r.opened, opened);
    }

    #[test]
    fn closed_source_has_no_late_diagnostic_or_resurrected_tab() {
        let mut r = two_accounts_with_tabs();
        r.forget_tab(A, T);
        let before = serde_json::to_value(&r.snapshot).unwrap();
        let opened = r.opened.clone();
        let diagnostic_seq = r.diagnostic_seq;

        assert!(!r.record_new_window_blocked(A, T));

        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert_eq!(r.opened, opened);
        assert_eq!(r.diagnostic_seq, diagnostic_seq);
        assert!(r.tab(A, T).is_err());
    }

    #[test]
    fn wrong_or_missing_source_has_no_diagnostic_or_state_change() {
        let mut r = two_accounts_with_tabs();
        let before = serde_json::to_value(&r.snapshot).unwrap();
        let diagnostic_seq = r.diagnostic_seq;
        for (account, tab) in [
            (B, T),
            (A, U),
            (A, B),
            (T, T),
            ("../account", T),
            (A, "../tab"),
        ] {
            assert!(!r.record_new_window_blocked(account, tab));
        }
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert_eq!(r.diagnostic_seq, diagnostic_seq);

        // Even a lingering tab cannot authorize an event after its account is removed.
        r.snapshot.accounts.retain(|a| a.id != A);
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(!r.record_new_window_blocked(A, T));
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert_eq!(r.diagnostic_seq, diagnostic_seq);
    }

    #[test]
    fn popup_diagnostics_are_fixed_and_exclude_page_data() {
        let mut r = two_accounts_with_tabs();
        r.snapshot.accounts[0].name = "synthetic-private-name".into();
        r.snapshot.tabs[0].title = "synthetic-private-title".into();
        r.snapshot.tabs[0].display_url =
            "https://example.test/synthetic-private-path?code=synthetic#token=synthetic".into();
        assert!(r.record_new_window_blocked(A, T));
        assert!(r.record_new_window_blocked(B, U));
        let events = &r.snapshot.diagnostics[r.snapshot.diagnostics.len() - 2..];
        assert_eq!(events[0].safe_message, events[1].safe_message);
        for event in events {
            let serialized = serde_json::to_string(event).unwrap();
            for excluded in ["synthetic", "example.test", "https://", "code=", "token="] {
                assert!(!serialized.contains(excluded));
            }
            assert_eq!(event.code, "new_window_blocked");
        }
    }

    const CHILD: &str = "7317c426-74c0-4bee-b80f-2c378d61ea63";
    const NESTED: &str = "d51e672a-cb63-4d24-bf8e-094793996491";

    fn popup(r: &mut Registry, account: &str, opener: &str, id: &str) {
        r.register_popup(account, opener, id, "about:blank".into())
            .unwrap();
    }

    #[test]
    fn background_popup_keeps_global_account_and_unknown_session() {
        let mut r = two_accounts_with_tabs();
        let diagnostics = r.snapshot.diagnostics.len();
        popup(&mut r, A, T, CHILD);
        let child = &r.snapshot.tabs[r.tab(A, CHILD).unwrap()];
        assert_eq!(child.opener_tab_id.as_deref(), Some(T));
        assert_eq!(child.purpose, "normal");
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(B));
        assert!(r.complete_popup(A, CHILD));
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(B));
        assert_eq!(r.snapshot.runtimes[0].active_tab_id.as_deref(), Some(CHILD));
        assert_eq!(r.snapshot.runtimes[1].active_tab_id.as_deref(), Some(U));
        assert_eq!(r.snapshot.diagnostics.len(), diagnostics);
        assert!(
            r.snapshot
                .runtimes
                .iter()
                .all(|rt| rt.session_status == "unknown")
        );
        assert!(matches!(
            r.snapshot.tabs[r.tab(A, CHILD).unwrap()].load_state,
            LoadState::Loading
        ));
    }

    #[test]
    fn popup_rejects_wrong_missing_closed_or_closing_source_without_changes() {
        for (account, opener) in [(B, T), (A, U), (A, CHILD), (T, T)] {
            let mut r = two_accounts_with_tabs();
            let before = serde_json::to_value(&r.snapshot).unwrap();
            assert!(
                r.register_popup(account, opener, CHILD, "about:blank".into())
                    .is_err()
            );
            assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
            assert!(r.pending_popups.is_empty());
        }
        let mut r = two_accounts_with_tabs();
        r.begin_close(A, T).unwrap();
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(r.register_popup(A, T, CHILD, "about:blank".into()).is_err());
        assert!(!r.record_new_window_blocked(A, T));
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        r.forget_tab(A, T);
        assert!(r.register_popup(A, T, CHILD, "about:blank".into()).is_err());
        r.snapshot.accounts.retain(|a| a.id != B);
        assert!(r.register_popup(B, U, CHILD, "about:blank".into()).is_err());
    }

    #[test]
    fn popup_id_validation_and_limit_do_not_mutate_registry() {
        let mut r = two_accounts_with_tabs();
        for id in [T, U, "../tab"] {
            let before = serde_json::to_value(&r.snapshot).unwrap();
            assert!(r.register_popup(A, T, id, "about:blank".into()).is_err());
            assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        }
        for _ in 2..100 {
            let id = uuid::Uuid::new_v4().to_string();
            popup(&mut r, A, T, &id);
        }
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(r.register_popup(A, T, CHILD, "about:blank".into()).is_err());
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
    }

    #[test]
    fn wrong_account_cannot_forget_or_close_another_accounts_tab() {
        let mut r = two_accounts_with_tabs();
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(!r.forget_tab(B, T));
        assert!(r.begin_close(B, T).is_err());
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert!(r.closing.is_empty());
    }

    #[test]
    fn child_completes_after_source_close_without_reviving_source() {
        let mut r = two_accounts_with_tabs();
        popup(&mut r, A, T, CHILD);
        r.begin_close(A, T).unwrap();
        r.forget_tab(A, T);
        assert!(r.snapshot.runtimes[0].active_tab_id.is_none());
        assert!(r.complete_popup(A, CHILD));
        assert!(r.tab(A, T).is_err());
        assert_eq!(r.snapshot.runtimes[0].active_tab_id.as_deref(), Some(CHILD));
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(B));
        r.begin_close(A, CHILD).unwrap();
        r.forget_tab(A, CHILD);
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(!r.complete_popup(A, CHILD));
        assert!(!r.record_new_window_blocked(A, CHILD));
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert!(r.snapshot.runtimes[0].active_tab_id.is_none());
        assert!(r.opened.contains(A));
    }

    #[test]
    fn native_close_prefers_live_opener_and_never_changes_global_account() {
        let mut r = two_accounts_with_tabs();
        popup(&mut r, A, T, CHILD);
        assert!(r.complete_popup(A, CHILD));
        popup(&mut r, A, T, NESTED);
        assert!(r.complete_popup(A, NESTED));
        // A newer sibling exists; closing CHILD must prefer its real opener.
        r.snapshot.runtimes[0].active_tab_id = Some(CHILD.into());
        r.begin_close(A, CHILD).unwrap();
        r.forget_tab(A, CHILD);
        assert_eq!(r.snapshot.runtimes[0].active_tab_id.as_deref(), Some(T));
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(B));
        assert!(r.tab(A, NESTED).is_ok());
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(!r.forget_tab(A, CHILD));
        assert!(!r.complete_popup(A, CHILD));
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
    }

    #[test]
    fn late_completion_and_rollback_do_not_overwrite_newer_selection() {
        let mut r = two_accounts_with_tabs();
        popup(&mut r, A, T, CHILD);
        popup(&mut r, A, T, NESTED);
        assert!(r.complete_popup(A, NESTED));
        r.select(A, Some(NESTED.into()));
        assert!(r.complete_popup(A, CHILD));
        assert_eq!(
            r.snapshot.runtimes[0].active_tab_id.as_deref(),
            Some(NESTED)
        );
        assert!(r.forget_tab(A, CHILD));
        assert_eq!(
            r.snapshot.runtimes[0].active_tab_id.as_deref(),
            Some(NESTED)
        );
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(!r.complete_popup(A, CHILD));
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
    }

    #[test]
    fn nested_child_retains_exact_source_and_survives_its_close() {
        let mut r = two_accounts_with_tabs();
        popup(&mut r, A, T, CHILD);
        assert!(r.complete_popup(A, CHILD));
        popup(&mut r, A, CHILD, NESTED);
        r.forget_tab(A, CHILD);
        assert!(r.complete_popup(A, NESTED));
        let nested = &r.snapshot.tabs[r.tab(A, NESTED).unwrap()];
        assert_eq!(nested.opener_tab_id.as_deref(), Some(CHILD));
        assert_eq!(nested.purpose, "normal");
        assert!(r.tab(A, CHILD).is_err());
        assert!(r.tab(A, T).is_ok());
    }

    #[test]
    fn closing_child_rejects_late_events_and_allows_exact_cleanup_retry() {
        let mut r = two_accounts_with_tabs();
        popup(&mut r, A, T, CHILD);
        assert!(r.begin_close(A, CHILD).unwrap());
        let before = serde_json::to_value(&r.snapshot).unwrap();
        assert!(!r.complete_popup(A, CHILD));
        assert!(!r.record_new_window_blocked(A, CHILD));
        assert!(
            r.register_popup(A, CHILD, NESTED, "about:blank".into())
                .is_err()
        );
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert!(!r.begin_close(A, CHILD).unwrap());
        assert!(r.forget_tab(A, CHILD));
        assert!(r.pending_popups.is_empty());
        assert!(r.closing.is_empty());
        assert_eq!(r.snapshot.runtimes[0].active_tab_id.as_deref(), Some(T));
    }

    #[test]
    fn failed_close_rollback_preserves_newer_selection() {
        let mut r = two_accounts_with_tabs();
        popup(&mut r, A, T, CHILD);
        r.complete_popup(A, CHILD);
        r.begin_close(A, CHILD).unwrap();
        r.select(A, Some(T.into()));
        r.cancel_close(A, CHILD);
        assert!(r.tab(A, CHILD).is_ok());
        assert_eq!(r.snapshot.runtimes[0].active_tab_id.as_deref(), Some(T));
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(A));
        assert!(
            r.snapshot
                .runtimes
                .iter()
                .all(|rt| rt.session_status == "unknown")
        );
    }

    #[test]
    fn stale_selection_cannot_restore_closed_or_foreign_tabs() {
        let mut r = two_accounts_with_tabs();
        r.forget_tab(A, T);
        let before = serde_json::to_value(&r.snapshot).unwrap();
        for (account, tab) in [(A, T), (A, U), (B, T), (T, T)] {
            r.select(account, Some(tab.into()));
        }
        assert_eq!(serde_json::to_value(&r.snapshot).unwrap(), before);
        assert_eq!(r.snapshot.active_account_id.as_deref(), Some(B));
    }

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
