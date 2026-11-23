//! Windows-first M0 browser verification. Authentication remains explicitly blocked.
mod actions;
mod logic;
mod model;
mod registry;
mod storage;
mod views;

pub use model::{Action, AppError, ContentBounds, Snapshot};
use registry::{BrowserState, Registry};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

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
    app.manage(BrowserState {
        _instance_lock: instance_lock,
        root,
        registry: Mutex::new(Registry::new(accounts)),
        operation: Mutex::new(()),
    });
    let window = app
        .get_window("shell")
        .ok_or_else(|| AppError::new("shell_missing", "工作台窗口不存在"))?;
    let handle = app.handle().clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            let state = handle.state::<BrowserState>();
            if let Ok(_operation) = state.operation.try_lock() {
                let _ = views::apply_layout(&handle);
            }
        }
    });
    Ok(())
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

pub fn layout(app: &AppHandle, bounds: ContentBounds) -> Result<(), AppError> {
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
        if !logic::valid_bounds(
            [bounds.x, bounds.y, bounds.width, bounds.height],
            [size.width, size.height],
            bounds.layout_seq,
            r.bounds.as_ref().map(|b| b.layout_seq),
        ) {
            return Err(AppError::new(
                "invalid_layout",
                "布局须为有限非负逻辑像素、位于工作台内且序号严格递增",
            ));
        }
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
