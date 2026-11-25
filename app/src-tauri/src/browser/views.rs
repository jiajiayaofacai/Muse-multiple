use super::{
    logic,
    model::{AppError, LoadState},
    registry::{self, BrowserState},
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

pub(super) fn close(app: &AppHandle, account: &str, tab: &str) -> Result<(), AppError> {
    close_inner(app, account, tab, false)
}

pub(super) fn discard(app: &AppHandle, account: &str, tab: &str) {
    let _ = close_inner(app, account, tab, true);
}

fn close_inner(app: &AppHandle, account: &str, tab: &str, discard: bool) -> Result<(), AppError> {
    let fresh = registry::lock(app)?.begin_close(account, tab)?;
    // Mark first, then release the mutex before native destruction can reenter.
    if let Some(view) = app.get_webview(&label(tab))
        && let Err(error) = view.close()
    {
        let mut r = registry::lock(app)?;
        if !discard && fresh {
            r.cancel_close(account, tab);
        }
        r.diagnostic(
            Some(account),
            "native_close_failed",
            "原生标签关闭未完成；未更改登录或应用连接状态",
        );
        r.changed();
        drop(r);
        let _ = emit(app);
        return Err(AppError::native(error));
    }
    {
        let mut r = registry::lock(app)?;
        if r.forget_tab(account, tab) {
            r.changed();
        }
    }
    let layout = apply_layout(app);
    let event = emit(app);
    layout?;
    event
}

fn blocked_popup(app: &AppHandle, account: &str, opener: &str) {
    let recorded =
        registry::lock(app).is_ok_and(|mut r| r.record_new_window_blocked(account, opener));
    if recorded {
        let _ = emit(app);
    }
}

#[cfg(windows)]
fn connector_child(
    app: &AppHandle,
    account: &str,
    opener: &str,
    target: Url,
    features: tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    // The requested URL is only validated, never navigated by us. WebView2 owns
    // navigation and the real WindowProxy/opener relationship after takeover.
    if url(target.as_str()).is_err() || get(app, account, opener).is_err() {
        blocked_popup(app, account, opener);
        return NewWindowResponse::Deny;
    }
    let Ok(blank) = url("about:blank") else {
        return NewWindowResponse::Deny;
    };
    let id = uuid::Uuid::new_v4().to_string();
    let registered = registry::lock(app)
        .and_then(|mut r| r.register_popup(account, opener, &id, display_url(&target)));
    if registered.is_err() {
        blocked_popup(app, account, opener);
        return NewWindowResponse::Deny;
    }
    let child = match build_with_features(app, account, &id, blank, Some(features)) {
        Ok(child) => child,
        Err(_) => {
            // Roll back this UUID only; never restore a stale selection or opener.
            let _ = close_inner(app, account, &id, true);
            blocked_popup(app, account, opener);
            return NewWindowResponse::Deny;
        }
    };
    let complete_app = app.clone();
    let complete_account = account.to_owned();
    NewWindowResponse::CreateWebview {
        webview: child,
        on_complete: Box::new(move |result| {
            if result.is_err() {
                // Ignore raw COM/runtime error strings, including their stage text.
                update(&complete_app, &complete_account, &id, |r, _| {
                    r.diagnostic(
                        Some(&complete_account),
                        "new_window_failed",
                        "新窗口原生接管未完成；未确认登录或应用连接结果",
                    );
                });
                let _ = close_inner(&complete_app, &complete_account, &id, true);
                return;
            }
            let completed = registry::lock(&complete_app)
                .is_ok_and(|mut r| r.complete_popup(&complete_account, &id));
            if completed {
                // Completion means native handoff only, not page/session success.
                let _ = apply_layout(&complete_app);
                let _ = emit(&complete_app);
            }
        }),
    }
}

pub(super) fn build(
    app: &AppHandle,
    account: &str,
    tab: &str,
    target: Url,
) -> Result<Webview, AppError> {
    build_with_features(app, account, tab, target, None)
}

fn build_with_features(
    app: &AppHandle,
    account: &str,
    tab: &str,
    target: Url,
    features: Option<tauri::webview::NewWindowFeatures>,
) -> Result<Webview, AppError> {
    registry::lock(app)?.tab(account, tab)?;
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
        .on_new_window(move |target, features| {
            #[cfg(windows)]
            {
                connector_child(&popup_app, &popup_account, &popup_tab, target, features)
            }
            #[cfg(not(windows))]
            {
                let _ = (target, features);
                blocked_popup(&popup_app, &popup_account, &popup_tab);
                NewWindowResponse::Deny
            }
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
    #[cfg(windows)]
    let builder = {
        let debug =
            cfg!(debug_assertions) && std::env::var("MUSE_MULTIPLE_M0_DEBUG").as_deref() == Ok("1");
        match logic::browser_args(&state.startup_proxy, debug) {
            Some(args) => builder.additional_browser_args(&args),
            None => builder,
        }
    };
    let builder = {
        let close_account = account.to_owned();
        let close_tab = tab.to_owned();
        let builder = builder.on_close_requested(move |view| {
            // The patched runtime queues this outside WebView2's COM callback.
            if registry::lock(view.app_handle())
                .is_ok_and(|r| r.tab(&close_account, &close_tab).is_ok())
            {
                let _ = close(view.app_handle(), &close_account, &close_tab);
            }
        });
        if let Some(features) = features {
            builder.with_environment(features.opener().environment.clone())
        } else {
            builder
        }
    };
    #[cfg(not(windows))]
    let _ = features;
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
    let zoom = registry::lock(app)?.snapshot.settings.web_zoom_percent;
    if let Err(error) = view.set_zoom(f64::from(zoom) / 100.) {
        let _ = close_inner(app, account, tab, true);
        return Err(AppError::native(error));
    }
    if let Err(error) = view.hide() {
        let _ = close_inner(app, account, tab, true);
        return Err(AppError::native(error));
    }
    if registry::lock(app)?.tab(account, tab).is_err() {
        let _ = view.close();
        return Err(AppError::new("tab_not_found", "标签已关闭；未重新打开页面"));
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
            .and_then(|rt| {
                rt.active_tab_id
                    .as_ref()
                    .filter(|id| r.tab(&rt.account_id, id).is_ok())
                    .cloned()
            });
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
    let Some(bounds) = bounds.filter(|b| b.visible && b.width > 0. && b.height > 0.) else {
        for id in &tabs {
            if let Some(view) = app.get_webview(&label(id)) {
                view.hide().map_err(AppError::native)?;
            }
        }
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
        for id in &tabs {
            if let Some(view) = app.get_webview(&label(id)) {
                view.hide().map_err(AppError::native)?;
            }
        }
        return Ok(());
    }
    // Apply the same ordered plan covered by the dependency-free layout regression test.
    for step in logic::layout_steps(&tabs, active.as_deref()) {
        match step {
            logic::LayoutStep::SetActiveBounds(id) => {
                if let Some(view) = app.get_webview(&label(id)) {
                    view.set_bounds(Rect {
                        position: LogicalPosition::new(bounds.x, bounds.y).into(),
                        size: LogicalSize::new(bounds.width, bounds.height).into(),
                    })
                    .map_err(AppError::native)?;
                }
            }
            logic::LayoutStep::ShowActive(id) => {
                if let Some(view) = app.get_webview(&label(id)) {
                    view.show().map_err(AppError::native)?;
                }
            }
            logic::LayoutStep::Hide(id) => {
                if let Some(view) = app.get_webview(&label(id)) {
                    view.hide().map_err(AppError::native)?;
                }
            }
        }
    }
    Ok(())
}

pub(super) fn set_web_zoom(app: &AppHandle, percent: u16) -> Result<(), AppError> {
    let tabs = registry::lock(app)?
        .snapshot
        .tabs
        .iter()
        .map(|tab| tab.id.clone())
        .collect::<Vec<_>>();
    for tab in tabs {
        if let Some(view) = app.get_webview(&label(&tab)) {
            view.set_zoom(f64::from(percent) / 100.)
                .map_err(AppError::native)?;
        }
    }
    Ok(())
}
