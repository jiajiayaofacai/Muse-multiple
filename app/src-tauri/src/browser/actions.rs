use super::{
    model::*,
    registry::{self, BrowserState},
    storage, views,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub(super) fn run(app: &AppHandle, action: Action) -> Result<(), AppError> {
    match action {
        Action::CreateAccount { name, note } => create_account(app, name, note),
        Action::UpdateAccount {
            account_id,
            name,
            note,
        } => update_account(app, &account_id, name, note),
        Action::UpdateSettings { settings } => update_settings(app, settings),
        Action::DeleteAccount { account_id } => delete_account(app, &account_id),
        Action::ActivateAccount { account_id } => activate_account(app, &account_id),
        Action::CreateTab { account_id, url } => create_tab(app, &account_id, &url),
        Action::RetryProfileCleanup => retry_profile_cleanup(app),
        Action::ActivateTab { account_id, tab_id } => {
            views::get(app, &account_id, &tab_id)?;
            registry::lock(app)?.select(&account_id, Some(tab_id));
            Ok(())
        }
        Action::SleepAccount {
            account_id,
            automatic,
        } => sleep_account(app, &account_id, automatic),
        Action::CloseAllTabs { account_id } => close_all_tabs(app, &account_id),
        Action::CloseTab { account_id, tab_id } => views::close(app, &account_id, &tab_id),
        Action::Navigate {
            account_id,
            tab_id,
            url,
        } => navigate(app, &account_id, &tab_id, &url),
        Action::Reload { account_id, tab_id } => {
            let view = views::get(app, &account_id, &tab_id)?;
            loading(app, &account_id, &tab_id, LoadState::Loading)?;
            if let Err(error) = view.reload() {
                loading(app, &account_id, &tab_id, LoadState::Error)?;
                return Err(AppError::native(error));
            }
            Ok(())
        }
        Action::Stop { account_id, tab_id } => {
            views::get(app, &account_id, &tab_id)?
                .eval("window.stop();")
                .map_err(AppError::native)?;
            registry::lock(app)?.diagnostic(
                Some(&account_id),
                "stop_requested",
                "停止脚本已提交；没有原生停止确认回调，不推断页面加载成功",
            );
            Ok(())
        }
        Action::Back { account_id, tab_id } => views::get(app, &account_id, &tab_id)?
            .eval("history.back();")
            .map_err(AppError::native),
        Action::Forward { account_id, tab_id } => views::get(app, &account_id, &tab_id)?
            .eval("history.forward();")
            .map_err(AppError::native),
        Action::OpenProjectLink { kind } => open_project_link(kind),
    }
}
fn sleep_account(app: &AppHandle, account: &str, automatic: bool) -> Result<(), AppError> {
    let allowed = {
        let registry = registry::lock(app)?;
        if automatic {
            registry.can_auto_sleep(account, registry::now())
        } else {
            registry.snapshot.active_account_id.as_deref() != Some(account)
                && registry.snapshot.runtimes.iter().any(|runtime| {
                    runtime.account_id == account && runtime.lifecycle == "background"
                })
        }
    };
    if !allowed {
        return if automatic {
            Ok(())
        } else {
            Err(AppError::new(
                "sleep_unavailable",
                "只有后台账号可休眠；请先切换到其他账号",
            ))
        };
    }
    close_all_tabs(app, account)?;
    if !registry::lock(app)?.mark_sleeping(account) {
        return Err(AppError::new(
            "sleep_cancelled",
            "账号状态已变化；未执行休眠",
        ));
    }
    Ok(())
}

fn delete_account(app: &AppHandle, account: &str) -> Result<(), AppError> {
    let state = app.state::<BrowserState>();
    let root = state.root.clone();
    let (tabs, accounts) = {
        let r = registry::lock(app)?;
        r.account(account)?;
        (
            r.snapshot
                .tabs
                .iter()
                .filter(|tab| tab.account_id == account)
                .map(|tab| tab.id.clone())
                .collect::<Vec<_>>(),
            r.snapshot
                .accounts
                .iter()
                .filter(|entry| entry.id != account)
                .cloned()
                .collect::<Vec<_>>(),
        )
    };
    for tab in tabs {
        views::close(app, account, &tab)?;
    }
    let staged = storage::stage_profile_for_deletion(&root, account)?;
    if let Err(error) = storage::save(&root, &accounts) {
        if let Some(path) = &staged {
            storage::restore_staged_profile(&root, account, path)?;
        }
        return Err(error);
    }
    registry::lock(app)?.forget_account(account)?;
    if let Some(path) = staged
        && storage::finish_staged_profile_deletion(&path).is_err()
    {
        registry::lock(app)?.diagnostic(
            None,
            "profile_cleanup_pending",
            "账号已从列表移除；部分旧浏览资料待本机清理",
        );
    }
    Ok(())
}

fn retry_profile_cleanup(app: &AppHandle) -> Result<(), AppError> {
    let root = app.state::<BrowserState>().root.clone();
    storage::retry_all_staged_profile_deletions(&root)?;
    registry::lock(app)?.diagnostic(
        None,
        "profile_cleanup_completed",
        "待清理的旧账号资料已按已提交元数据安全重试",
    );
    Ok(())
}

fn close_all_tabs(app: &AppHandle, account: &str) -> Result<(), AppError> {
    let tabs = {
        let r = registry::lock(app)?;
        r.account(account)?;
        r.snapshot
            .tabs
            .iter()
            .filter(|tab| tab.account_id == account)
            .map(|tab| tab.id.clone())
            .collect::<Vec<_>>()
    };
    for tab in tabs {
        views::close(app, account, &tab)?;
    }
    Ok(())
}

fn update_settings(app: &AppHandle, settings: Settings) -> Result<(), AppError> {
    if !super::logic::valid_settings(&settings) {
        return Err(AppError::new("invalid_settings", "设置值无效，未保存"));
    }
    let previous_zoom = registry::lock(app)?.snapshot.settings.web_zoom_percent;
    if let Err(error) = views::set_web_zoom(app, settings.web_zoom_percent) {
        let _ = views::set_web_zoom(app, previous_zoom);
        return Err(error);
    }
    if let Err(error) = storage::save_settings(&app.state::<BrowserState>().root, &settings) {
        let _ = views::set_web_zoom(app, previous_zoom);
        return Err(error);
    }
    registry::lock(app)?.snapshot.settings = settings;
    Ok(())
}

#[cfg(windows)]
fn open_project_link(kind: ProjectLink) -> Result<(), AppError> {
    let url = match kind {
        ProjectLink::Github => "https://github.com/jiajiayaofacai/Muse-multiple",
        ProjectLink::Docs => {
            "https://github.com/jiajiayaofacai/Muse-multiple/blob/main/app/README.md"
        }
        ProjectLink::Releases => "https://github.com/jiajiayaofacai/Muse-multiple/releases",
    };
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|_| AppError::new("project_link_failed", "无法打开固定项目链接"))
}

#[cfg(not(windows))]
fn open_project_link(_kind: ProjectLink) -> Result<(), AppError> {
    Err(AppError::new(
        "project_link_unsupported",
        "当前平台暂不支持打开项目链接",
    ))
}

fn create_account(app: &AppHandle, name: String, note: String) -> Result<(), AppError> {
    let name = super::logic::account_name(&name)
        .map_err(|message| AppError::new("invalid_name", message))?;
    let note = super::logic::account_note(&note)
        .map_err(|message| AppError::new("invalid_note", message))?;
    let state = app.state::<BrowserState>();
    let mut accounts = registry::lock(app)?.snapshot.accounts.clone();
    if accounts.len() >= 1000 {
        return Err(AppError::new("account_limit", "M0 账号数量上限为 1000"));
    }
    let id = Uuid::new_v4().to_string();
    let duplicate = accounts.iter().any(|a| a.name == name);
    accounts.push(Account {
        id: id.clone(),
        name,
        note,
        last_used_at: 0,
    });
    storage::save(&state.root, &accounts)?;
    let mut r = registry::lock(app)?;
    r.snapshot.accounts = accounts;
    r.snapshot.runtimes.push(Runtime {
        account_id: id,
        lifecycle: "unopened",
        session_status: "unknown",
        active_tab_id: None,
        protection_reasons: Vec::new(),
    });
    if duplicate {
        r.diagnostic(
            None,
            "duplicate_name",
            "同名账号已创建；浏览资料仍按稳定 ID 独立存储",
        );
    }
    // Creation saves metadata only. The user explicitly activates the account to load Muse.
    Ok(())
}
fn update_account(
    app: &AppHandle,
    account: &str,
    name: String,
    note: String,
) -> Result<(), AppError> {
    let name = super::logic::account_name(&name)
        .map_err(|message| AppError::new("invalid_name", message))?;
    let note = super::logic::account_note(&note)
        .map_err(|message| AppError::new("invalid_note", message))?;
    let state = app.state::<BrowserState>();
    let (accounts, duplicate) = {
        let r = registry::lock(app)?;
        let index = r.account(account)?;
        let mut accounts = r.snapshot.accounts.clone();
        let duplicate = accounts
            .iter()
            .any(|entry| entry.id != account && entry.name == name);
        accounts[index].name = name;
        accounts[index].note = note;
        (accounts, duplicate)
    };
    storage::save(&state.root, &accounts)?;
    let mut r = registry::lock(app)?;
    r.snapshot.accounts = accounts;
    if duplicate {
        r.diagnostic(
            None,
            "duplicate_name",
            "同名账号已保存；浏览资料仍按稳定 ID 独立存储",
        );
    }
    Ok(())
}

fn activate_account(app: &AppHandle, account: &str) -> Result<(), AppError> {
    let (needs_initial_tab, selected, mut accounts) = {
        let r = registry::lock(app)?;
        r.account(account)?;
        let runtime = r
            .snapshot
            .runtimes
            .iter()
            .find(|runtime| runtime.account_id == account);
        let selected = runtime.and_then(|runtime| runtime.active_tab_id.clone());
        let needs_initial_tab = !r.opened.contains(account)
            || runtime.is_some_and(|runtime| runtime.lifecycle == "sleeping");
        (needs_initial_tab, selected, r.snapshot.accounts.clone())
    };
    if let Some(a) = accounts.iter_mut().find(|a| a.id == account) {
        a.last_used_at = registry::now();
    }
    storage::save(&app.state::<BrowserState>().root, &accounts)?;
    registry::lock(app)?.snapshot.accounts = accounts;
    if needs_initial_tab {
        create_tab(app, account, "https://muse.ai/")
    } else {
        registry::lock(app)?.select(account, selected);
        Ok(())
    }
}

fn create_tab(app: &AppHandle, account: &str, input: &str) -> Result<(), AppError> {
    let url = views::url(input)?;
    let id = Uuid::new_v4().to_string();
    {
        let mut r = registry::lock(app)?;
        r.account(account)?;
        if r.snapshot.tabs.len() >= 100 {
            return Err(AppError::new("tab_limit", "M0 同时打开标签上限为 100"));
        }
        r.snapshot.tabs.push(Tab {
            id: id.clone(),
            account_id: account.into(),
            opener_tab_id: None,
            purpose: "normal",
            title: String::new(),
            display_url: views::display_url(&url),
            load_state: LoadState::Loading,
            can_go_back: false,
            can_go_forward: false,
        });
    }
    // Register before native creation; synchronous and late callbacks both validate ownership.
    if let Err(error) = views::build(app, account, &id, url) {
        views::discard(app, account, &id);
        return Err(error);
    }
    let mut r = registry::lock(app)?;
    r.tab(account, &id)?;
    r.opened.insert(account.into());
    r.select(account, Some(id));
    Ok(())
}

fn loading(app: &AppHandle, account: &str, tab: &str, state: LoadState) -> Result<(), AppError> {
    let mut r = registry::lock(app)?;
    let index = r.tab(account, tab)?;
    r.snapshot.tabs[index].load_state = state;
    Ok(())
}

fn navigate(app: &AppHandle, account: &str, tab: &str, input: &str) -> Result<(), AppError> {
    let url = views::url(input)?;
    let view = views::get(app, account, tab)?;
    loading(app, account, tab, LoadState::Loading)?;
    if let Err(error) = view.navigate(url) {
        loading(app, account, tab, LoadState::Error)?;
        return Err(AppError::native(error));
    }
    Ok(())
}
