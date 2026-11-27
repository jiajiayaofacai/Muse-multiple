//! Windows-first M0 browser verification. Real authentication remains unverified.
mod actions;
mod logic;
mod model;
mod registry;
mod storage;
mod views;

pub use model::{Action, AppError, ContentBounds, Snapshot};
use registry::{BrowserState, Registry};
use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager};
static TRAY_FIRST_HIDE: AtomicBool = AtomicBool::new(true);

/// Install once during setup. Cold start reads metadata but creates no remote view.
pub fn install(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if app.try_state::<BrowserState>().is_some() {
        return Err(AppError::new("already_installed", "浏览模块已安装").into());
    }
    let default_root = app.path().app_data_dir()?.join("m0-verification");
    // Trusted process-only override for synthetic tests; never exposed through IPC.
    let root = if cfg!(debug_assertions) {
        std::env::var_os("MUSE_MULTIPLE_M0_DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or(default_root)
    } else {
        default_root
    };
    let instance_lock = storage::acquire_instance_lock(&root)?;
    let accounts = storage::load(&root)?;
    let pending_deletions = storage::recover_pending_profile_deletions(&root, &accounts);
    let settings = storage::load_settings(&root)?;
    #[cfg(windows)]
    let startup_proxy = settings.proxy.clone();
    let mut registry = Registry::with_settings(accounts, settings);
    if pending_deletions > 0 {
        registry.diagnostic(
            None,
            "profile_cleanup_pending",
            "部分旧浏览资料仍被系统占用；关闭相关程序后可重启重试",
        );
    }
    app.manage(BrowserState {
        _instance_lock: instance_lock,
        root,
        #[cfg(windows)]
        startup_proxy,
        registry: Mutex::new(registry),
        operation: Mutex::new(()),
    });
    let window = app
        .get_window("shell")
        .ok_or_else(|| AppError::new("shell_missing", "工作台窗口不存在"))?;
    let event_handle = app.handle().clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let to_tray = registry::lock(&event_handle)
                .is_ok_and(|r| r.snapshot.settings.close_behavior == "tray");
            if to_tray
                && let Some(tray) = event_handle.tray_by_id("muse-multiple-tray")
                && let Some(window) = event_handle.get_window("shell")
                && window.hide().is_ok()
            {
                api.prevent_close();
                if TRAY_FIRST_HIDE.swap(false, Ordering::Relaxed) {
                    let _ = tray.set_tooltip(Some("已隐藏到托盘；点击图标可恢复 Muse-multiple"));
                }
            }
        }
        if matches!(
            event,
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            let state = event_handle.state::<BrowserState>();
            if let Ok(_operation) = state.operation.try_lock() {
                let _ = views::apply_layout(&event_handle);
            }
        }
    });
    let timer_handle = app.handle().clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(30));
            if timer_handle.get_window("shell").is_none() {
                break;
            }
            let sleeping = {
                let state = timer_handle.state::<BrowserState>();
                let Ok(registry) = state.registry.lock() else {
                    continue;
                };
                registry
                    .snapshot
                    .accounts
                    .iter()
                    .filter(|account| registry.can_auto_sleep(&account.id, registry::now()))
                    .map(|account| account.id.clone())
                    .collect::<Vec<_>>()
            };
            for account_id in sleeping {
                let _ = dispatch(
                    &timer_handle,
                    Action::SleepAccount {
                        account_id,
                        automatic: true,
                    },
                );
            }
        }
    });
    Ok(())
}

pub fn tray_unavailable(app: &AppHandle) {
    let Some(state) = app.try_state::<BrowserState>() else {
        return;
    };
    let mut settings = match registry::lock(app) {
        Ok(registry) => registry.snapshot.settings.clone(),
        Err(_) => return,
    };
    settings.close_behavior = "exit".into();
    let saved = storage::save_settings(&state.root, &settings).is_ok();
    if let Ok(mut registry) = registry::lock(app) {
        registry.snapshot.settings = settings;
        registry.diagnostic(
            None,
            "tray_unavailable",
            if saved {
                "托盘初始化失败；已回退为关闭退出"
            } else {
                "托盘不可用；本次运行已回退为关闭退出，设置未能持久保存"
            },
        );
        registry.changed();
    }
}

pub fn snapshot(app: &AppHandle) -> Result<Snapshot, AppError> {
    Ok(registry::lock(app)?.snapshot.clone())
}

/// Call from an async Tauri command / worker thread, not a synchronous UI-thread command.
/// The command wrapper must verify caller WebView label == shell AND local origin.
pub fn dispatch(app: &AppHandle, action: Action) -> Result<Snapshot, AppError> {
    let state = app
        .try_state::<BrowserState>()
        .ok_or_else(|| AppError::new("not_installed", "浏览模块未安装"))?;
    let _operation = state.operation.try_lock().map_err(|_| busy())?;
    let action_result = actions::run(app, action);
    let layout_result = views::apply_layout(app);
    {
        let mut r = registry::lock(app)?;
        if action_result.is_err() {
            r.diagnostic(
                None,
                "action_failed",
                "操作未完整完成；请查看命令错误，未自动清除或重建浏览资料",
            );
        }
        if layout_result.is_err() {
            r.diagnostic(
                None,
                "layout_failed",
                "原生布局操作失败；请重试布局，不应假定网页已隐藏",
            );
        }
        r.changed();
    }
    let event_result = views::emit(app);
    action_result?;
    layout_result?;
    event_result?;
    snapshot(app)
}

pub fn begin_layout(app: &AppHandle) -> Result<u64, AppError> {
    let state = app.state::<BrowserState>();
    let _operation = state.operation.try_lock().map_err(|_| busy())?;
    let sequence = {
        let mut r = registry::lock(app)?;
        let seq = r.bounds.as_ref().map_or(0, |bounds| bounds.layout_seq);
        r.bounds = Some(ContentBounds {
            x: 0.,
            y: 0.,
            width: 0.,
            height: 0.,
            visible: false,
            layout_seq: seq,
        });
        seq
    };
    views::apply_layout(app)?;
    Ok(sequence)
}

pub fn layout(app: &AppHandle, mut bounds: ContentBounds) -> Result<(), AppError> {
    let state = app
        .try_state::<BrowserState>()
        .ok_or_else(|| AppError::new("not_installed", "浏览模块未安装"))?;
    let _operation = state.operation.try_lock().map_err(|_| busy())?;
    let window = app
        .get_window("shell")
        .ok_or_else(|| AppError::new("shell_missing", "工作台窗口不存在"))?;
    let size = window
        .inner_size()
        .map_err(AppError::native)?
        .to_logical::<f64>(window.scale_factor().map_err(AppError::native)?);
    {
        let mut r = registry::lock(app)?;
        let clipped = logic::clipped_layout_bounds(
            [bounds.x, bounds.y, bounds.width, bounds.height],
            [size.width, size.height],
            bounds.layout_seq,
            r.bounds.as_ref().map(|b| b.layout_seq),
        )
        .ok_or_else(|| AppError::new("invalid_layout", "原生布局请求无效；未读取网页内容"))?;
        [bounds.x, bounds.y, bounds.width, bounds.height] = clipped;
        bounds.visible &= bounds.width > 0. && bounds.height > 0.;
        r.bounds = Some(bounds);
    }
    views::apply_layout(app)
}

fn busy() -> AppError {
    AppError {
        code: "workspace_busy",
        safe_message: "原生操作进行中，请重试；布局请求需保留最新序号".into(),
        retryable: true,
    }
}
