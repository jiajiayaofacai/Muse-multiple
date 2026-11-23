#![forbid(unsafe_code)]

mod browser;

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

pub fn run() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let config = &app.config().app.windows[0];
            let mut window = tauri::WebviewWindowBuilder::from_config(app, config)?;
            if cfg!(debug_assertions)
                && std::env::var("MUSE_MULTIPLE_M0_DEBUG").as_deref() == Ok("1")
            {
                window = window.additional_browser_args("--remote-debugging-port=9224");
            }
            let shell = window.build()?;
            shell.show()?;
            shell.unminimize()?;
            browser::install(app)
        })
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            workspace_action,
            workspace_layout,
            workspace_layout_begin
        ])
        .run(tauri::generate_context!());
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
