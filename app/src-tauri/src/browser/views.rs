use super::{
    logic,
    model::{AppError, LoadState},
    registry::{self, BrowserState, GATE},
};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewBuilder,
    WebviewUrl,
    webview::{NewWindowResponse, PageLoadEvent},
};

pub(super) fn label(tab: &str) -> String {
    format!("remote-{tab}")
}

pub(super) fn url(input: &str) -> Result<Url, AppError> {
    if !logic::allowed_url(input) {
        return Err(AppError::new(
            "navigation_denied",
            "只允许无凭据的 http、https 或 about:blank 地址",
        ));
    }
    let parsed = Url::parse(input).map_err(|_| AppError::new("invalid_url", "地址格式无效"))?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || (parsed.scheme() != "about" && parsed.host_str().is_none())
    {
        return Err(AppError::new(
            "navigation_denied",
            "禁止带凭据或缺少主机的地址",
        ));
    }
    Ok(parsed)
}

pub(super) fn display_url(url: &Url) -> String {
    // Even path segments may carry credentials; expose only the origin in M0.
    if url.as_str() == "about:blank" {
        "about:blank".into()
    } else {
        url.origin().ascii_serialization()
    }
}

pub(super) fn emit(app: &AppHandle) -> Result<(), AppError> {
    let snapshot = registry::lock(app)?.snapshot.clone();
    app.emit_to("shell", "workspace_changed", snapshot)
        .map_err(AppError::native)
}

fn update(
    app: &AppHandle,
    account: &str,
    tab: &str,
    change: impl FnOnce(&mut super::registry::Registry, usize),
) {
    let result = (|| {
        let mut r = registry::lock(app)?;
        let Ok(index) = r.tab(account, tab) else {
            return Ok::<_, AppError>(false);
        };
        change(&mut r, index);
        r.changed();
        Ok(true)
    })();
    if matches!(result, Ok(true)) {
        let _ = emit(app);
    }
}

pub(super) fn build(
    app: &AppHandle,
    account: &str,
    tab: &str,
    target: Url,
) -> Result<Webview, AppError> {
    let state = app.state::<BrowserState>();
    let directory = super::storage::profile(&state.root, account)?;
    let navigation_app = app.clone();
    let navigation_account = account.to_owned();
    let navigation_tab = tab.to_owned();
    let popup_app = app.clone();
    let popup_account = account.to_owned();
    let popup_tab = tab.to_owned();
    let title_account = account.to_owned();
    let title_tab = tab.to_owned();
    let load_account = account.to_owned();
    let load_tab = tab.to_owned();
    let builder = WebviewBuilder::new(label(tab), WebviewUrl::External(target))
        .data_directory(directory)
        .focused(false)
        .disable_drag_drop_handler()
        .on_download(|_, _| false)
        .on_navigation(move |target| {
            let allowed = url(target.as_str()).is_ok();
            let exists = registry::lock(&navigation_app)
                .is_ok_and(|r| r.tab(&navigation_account, &navigation_tab).is_ok());
            if !exists {
                return false;
            }
            update(
                &navigation_app,
                &navigation_account,
                &navigation_tab,
                |r, i| {
                    if allowed {
                        r.snapshot.tabs[i].display_url = display_url(target);
                        r.snapshot.tabs[i].load_state = LoadState::Loading;
                    } else {
                        r.diagnostic(
                            Some(&navigation_account),
                            "navigation_denied",
                            "已拒绝不允许的导航协议或凭据 URL",
                        );
                    }
                },
            );
            allowed
        })
        .on_new_window(move |_target, _features| {
            // Do not copy the URL into an unrelated child: that loses opener/postMessage.
            // See GATE.md for the synchronous reparent/Create hazard in the checked runtime.
            update(&popup_app, &popup_account, &popup_tab, |r, _| {
                r.snapshot.gate_status = GATE.into();
                r.diagnostic(
                    Some(&popup_account),
                    "new_window_blocked",
                    "已拒绝新窗口：同窗 opener/postMessage/close 技术闸门未通过；未打开替代窗口",
                );
            });
            NewWindowResponse::Deny
        })
        .on_document_title_changed(move |view, title| {
            update(view.app_handle(), &title_account, &title_tab, |r, i| {
                // UI-only transient title. Never persisted or included in diagnostics.
                r.snapshot.tabs[i].title = title
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(200)
                    .collect();
            });
        })
        .on_page_load(move |view, payload| {
            update(view.app_handle(), &load_account, &load_tab, |r, i| {
                r.snapshot.tabs[i].display_url = display_url(payload.url());
                r.snapshot.tabs[i].load_state = match payload.event() {
                    PageLoadEvent::Started => LoadState::Loading,
                    PageLoadEvent::Finished => LoadState::Ready,
                };
                // No inference about session validity or HTTP/network success.
            });
        });
    let builder = if cfg!(debug_assertions)
        && std::env::var("MUSE_MULTIPLE_M0_DEBUG").as_deref() == Ok("1")
    {
        builder.additional_browser_args("--remote-debugging-port=0")
    } else {
        builder
    };
    let window = app
        .get_window("shell")
        .ok_or_else(|| AppError::new("shell_missing", "工作台窗口不存在"))?;
    // Create offscreen to avoid a remote child briefly covering local dialogs before hide().
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(-10000., -10000.),
            LogicalSize::new(1., 1.),
        )
        .map_err(AppError::native)?;
    if let Err(error) = view.hide() {
        let _ = view.close();
        return Err(AppError::native(error));
    }
    Ok(view)
}

pub(super) fn get(app: &AppHandle, account: &str, tab: &str) -> Result<Webview, AppError> {
    registry::lock(app)?.tab(account, tab)?;
    app.get_webview(&label(tab))
        .ok_or_else(|| AppError::new("view_missing", "原生视图不存在；未自动复活已关闭页面"))
}

pub(super) fn apply_layout(app: &AppHandle) -> Result<(), AppError> {
    let (tabs, active, bounds) = {
        let r = registry::lock(app)?;
        let active = r
            .snapshot
            .runtimes
            .iter()
            .find(|rt| Some(&rt.account_id) == r.snapshot.active_account_id.as_ref())
            .and_then(|rt| rt.active_tab_id.clone());
        (
            r.snapshot
                .tabs
                .iter()
                .map(|t| t.id.clone())
                .collect::<Vec<_>>(),
            active,
            r.bounds.clone(),
        )
    };
    // Hide every child before moving/showing the selected one. Never rely on CSS z-index.
    for id in &tabs {
        if let Some(view) = app.get_webview(&label(id)) {
            view.hide().map_err(AppError::native)?;
        }
    }
    let Some(bounds) = bounds.filter(|b| b.visible && b.width > 0. && b.height > 0.) else {
        return Ok(());
    };
    let window = app
        .get_window("shell")
        .ok_or_else(|| AppError::new("shell_missing", "工作台窗口不存在"))?;
    let size = window
        .inner_size()
        .map_err(AppError::native)?
        .to_logical::<f64>(window.scale_factor().map_err(AppError::native)?);
    if !logic::valid_bounds(
        [bounds.x, bounds.y, bounds.width, bounds.height],
        [size.width, size.height],
        bounds.layout_seq,
        None,
    ) {
        // A resize may invalidate the last accepted bounds. Stay hidden until a fresh layout.
        return Ok(());
    }
    if let Some(view) = active.and_then(|id| app.get_webview(&label(&id))) {
        view.set_bounds(Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(AppError::native)?;
        view.show().map_err(AppError::native)?;
    }
    Ok(())
}
