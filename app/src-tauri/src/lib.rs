#![forbid(unsafe_code)]

use tauri::Manager;
mod browser;
#[cfg(windows)]
mod single_instance;

fn trusted_shell(label: &str, url: &tauri::Url) -> bool {
    if label != "shell" {
        return false;
    }
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
    let dev = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(1420);
    bundled || dev
}

fn authorize(webview: &tauri::Webview) -> Result<(), browser::AppError> {
    let trusted = webview
        .url()
        .is_ok_and(|url| trusted_shell(webview.label(), &url));
    if trusted {
        Ok(())
    } else {
        // This guard complements the capability ACL; remote content must never manage views.
        Err(browser::AppError {
            code: "forbidden",
            safe_message: "远程网页无权管理工作台".into(),
            retryable: false,
        })
    }
}

#[tauri::command]
async fn workspace_snapshot(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<browser::Snapshot, browser::AppError> {
    authorize(&webview)?;
    browser::snapshot(&app)
}

#[tauri::command]
async fn workspace_action(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    action: browser::Action,
) -> Result<browser::Snapshot, browser::AppError> {
    authorize(&webview)?;
    browser::dispatch(&app, action)
}

#[tauri::command]
async fn workspace_layout(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    bounds: browser::ContentBounds,
) -> Result<(), browser::AppError> {
    authorize(&webview)?;
    browser::layout(&app, bounds)
}

#[tauri::command]
async fn workspace_layout_begin(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<u64, browser::AppError> {
    authorize(&webview)?;
    browser::begin_layout(&app)
}

fn restore_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window("shell") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn install_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    };
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("application icon is unavailable")?;
    let show = MenuItem::with_id(app, "show", "显示工作台", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;
    TrayIconBuilder::with_id("muse-multiple-tray")
        .icon(icon)
        .tooltip("Muse-multiple")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_window(app),
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                restore_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    let (_owner, wake) = match single_instance::claim(&context.config().identifier) {
        Ok(Some(events)) => events,
        Ok(None) => return,
        Err(error) => {
            eprintln!("无法检查已有工作台：{error}");
            return;
        }
    };
    let result = tauri::Builder::default()
        .setup(move |app| {
            let config = &app.config().app.windows[0];
            let mut window = tauri::WebviewWindowBuilder::from_config(app, config)?.visible(false);
            if cfg!(debug_assertions)
                && std::env::var("MUSE_MULTIPLE_M0_DEBUG").as_deref() == Ok("1")
            {
                window = window.additional_browser_args("--remote-debugging-port=9224");
            }
            if let Some(icon) = app.default_window_icon() {
                window = window.icon(icon.clone())?;
            }
            let shell = window.build()?;
            browser::install(app)?;
            if install_tray(app.handle()).is_err() {
                browser::tray_unavailable(app.handle());
            }
            #[cfg(windows)]
            single_instance::listen(wake, app.handle().clone())?;
            shell.show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            workspace_action,
            workspace_layout,
            workspace_layout_begin
        ])
        .run(context);
    if let Err(error) = result {
        eprintln!("无法启动 Muse-multiple：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_views_cannot_manage_workspace_even_with_a_similar_label() {
        let remote = tauri::Url::parse("https://muse.ai/").unwrap();
        assert!(!trusted_shell("shell", &remote));
        assert!(!trusted_shell("tab-1", &remote));
        let bundled = tauri::Url::parse("http://tauri.localhost/").unwrap();
        assert!(!trusted_shell("tab-1", &bundled));
        assert!(trusted_shell("shell", &bundled));
    }

    #[test]
    fn arbitrary_local_origins_are_not_the_shell() {
        for url in [
            "http://localhost:1420/",
            "http://127.0.0.1:4317/",
            "http://tauri.localhost.attacker.example/",
        ] {
            assert!(!trusted_shell("shell", &tauri::Url::parse(url).unwrap()));
        }
    }
}
