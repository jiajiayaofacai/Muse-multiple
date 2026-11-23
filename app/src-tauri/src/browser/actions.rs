use super::{
    model::*,
    registry::{self, BrowserState},
    storage, views,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub(super) fn run(app: &AppHandle, action: Action) -> Result<(), AppError> {
    match action {
        Action::CreateAccount { name } => create_account(app, name),
        Action::ActivateAccount { account_id } => activate_account(app, &account_id),
        Action::CreateTab { account_id, url } => create_tab(app, &account_id, &url),
        Action::ActivateTab { account_id, tab_id } => {
            views::get(app, &account_id, &tab_id)?;
            registry::lock(app)?.select(&account_id, Some(tab_id));
            Ok(())
        }
        Action::CloseTab { account_id, tab_id } => {
            views::get(app, &account_id, &tab_id)?
                .close()
                .map_err(AppError::native)?;
            registry::lock(app)?.forget_tab(&account_id, &tab_id);
            Ok(())
        }
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
        Action::Back { account_id, tab_id } | Action::Forward { account_id, tab_id } => {
            views::get(app, &account_id, &tab_id)?;
            Err(AppError::new(
                "history_unsupported",
                "M0 尚无可靠的原生历史查询；不伪造可前进/后退状态",
            ))
        }
        Action::OpenProjectLink { kind } => {
            let _ = kind;
            Err(AppError::new(
                "project_link_unsupported",
                "M0 尚未接入受限系统外链接口；请由工作台壳处理固定项目链接",
            ))
        }
    }
}

fn create_account(app: &AppHandle, name: String) -> Result<(), AppError> {
    let name = super::logic::account_name(&name)
        .map_err(|message| AppError::new("invalid_name", message))?;
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
        note: String::new(),
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

fn activate_account(app: &AppHandle, account: &str) -> Result<(), AppError> {
    let (first_open, selected, mut accounts) = {
        let r = registry::lock(app)?;
        r.account(account)?;
        let selected = r
            .snapshot
            .runtimes
            .iter()
            .find(|r| r.account_id == account)
            .and_then(|r| r.active_tab_id.clone());
        (
            !r.opened.contains(account),
            selected,
            r.snapshot.accounts.clone(),
        )
    };
    if let Some(a) = accounts.iter_mut().find(|a| a.id == account) {
        a.last_used_at = registry::now();
    }
    storage::save(&app.state::<BrowserState>().root, &accounts)?;
    registry::lock(app)?.snapshot.accounts = accounts;
    if first_open {
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
        registry::lock(app)?.forget_tab(account, &id);
        return Err(error);
    }
    let mut r = registry::lock(app)?;
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
