use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub note: String,
    pub last_used_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoadState {
    Loading,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    pub account_id: String,
    pub opener_tab_id: Option<String>,
    pub purpose: &'static str,
    pub title: String,
    pub display_url: String,
    pub load_state: LoadState,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub account_id: String,
    pub lifecycle: &'static str,
    pub session_status: &'static str,
    pub active_tab_id: Option<String>,
    pub protection_reasons: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub close_behavior: &'static str,
    pub theme: &'static str,
    pub ui_zoom_percent: u16,
    pub web_zoom_percent: u16,
    pub auto_sleep_minutes: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_behavior: "exit",
            theme: "system",
            ui_zoom_percent: 100,
            web_zoom_percent: 100,
            auto_sleep_minutes: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub id: u64,
    pub timestamp: u64,
    pub level: &'static str,
    pub account_id: Option<String>,
    pub code: &'static str,
    pub safe_message: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub accounts: Vec<Account>,
    pub tabs: Vec<Tab>,
    pub runtimes: Vec<Runtime>,
    pub settings: Settings,
    pub diagnostics: Vec<Diagnostic>,
    pub active_account_id: Option<String>,
    pub gate_status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    CreateAccount {
        name: String,
    },
    ActivateAccount {
        account_id: String,
    },
    CreateTab {
        account_id: String,
        url: String,
    },
    ActivateTab {
        account_id: String,
        tab_id: String,
    },
    CloseTab {
        account_id: String,
        tab_id: String,
    },
    Back {
        account_id: String,
        tab_id: String,
    },
    Forward {
        account_id: String,
        tab_id: String,
    },
    Reload {
        account_id: String,
        tab_id: String,
    },
    Stop {
        account_id: String,
        tab_id: String,
    },
    Navigate {
        account_id: String,
        tab_id: String,
        url: String,
    },
    OpenProjectLink {
        kind: ProjectLink,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectLink {
    Github,
    Docs,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub layout_seq: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
    pub safe_message: String,
    pub retryable: bool,
}

impl AppError {
    pub(super) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            safe_message: message.into(),
            retryable: false,
        }
    }
    pub(super) fn native(_error: tauri::Error) -> Self {
        // Native errors may contain full URLs or disk paths; never send their text.
        Self {
            code: "native_operation_failed",
            safe_message: "原生视图操作失败；可重试，尚未证明操作完成".into(),
            retryable: true,
        }
    }
    pub(super) fn storage() -> Self {
        Self {
            code: "metadata_io_failed",
            safe_message: "账号元数据读写失败；未清理任何浏览资料".into(),
            retryable: true,
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.safe_message)
    }
}
impl std::error::Error for AppError {}
