// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Builds a `data:` page that shows the startup error as plain text. Uses system colours
/// only, so no design token is needed. The message is escaped and then percent-encoded.
fn error_page_url(message: &str) -> String {
    let escaped = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Mnemo</title>\
         <body style=\"font-family:system-ui,sans-serif;background:Canvas;color:CanvasText;margin:2rem\">\
         <h1>Mnemo could not start</h1><p>{escaped}</p>"
    );
    let mut url = String::from("data:text/html;charset=utf-8,");
    for b in html.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            url.push(b as char);
        } else {
            url.push_str(&format!("%{b:02X}"));
        }
    }
    url
}

/// Longest error text put on the error page, so the `data:` URL stays small.
const MAX_MESSAGE_CHARS: usize = 2000;

/// The storage the commands use: the open database, or the reason it could not be opened.
/// It is always registered, so a command gets the startup error back instead of a panic.
#[allow(dead_code)] // `get` is first called by the item commands in #14.
pub(crate) struct AppStorage(Result<Mutex<storage::Storage>, String>);

#[allow(dead_code)]
impl AppStorage {
    fn new(opened: Result<storage::Storage, String>) -> Self {
        AppStorage(opened.map(Mutex::new))
    }

    /// Locks the database, or returns the plain startup error when it could not be opened.
    pub(crate) fn get(&self) -> Result<std::sync::MutexGuard<'_, storage::Storage>, String> {
        match &self.0 {
            Ok(m) => m
                .lock()
                .map_err(|_| "Mnemo's data file is not available.".to_string()),
            Err(message) => Err(message.clone()),
        }
    }
}

/// The first page of the main window: the app itself, or the error page when storage
/// failed. The error page is the window's first load, so the app page cannot replace it.
fn start_url(error: Option<&str>, app_url: WebviewUrl) -> Result<WebviewUrl, String> {
    match error {
        None => Ok(app_url),
        Some(message) => {
            let short: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
            error_page_url(&short)
                .parse()
                .map(WebviewUrl::External)
                .map_err(|e| format!("{message} (the error page could not be built: {e})"))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Open the one database in the app data folder. The data file is never deleted
            // or replaced when this fails.
            let opened = system::paths::data_dir(app.handle()).and_then(|dir| {
                storage::Storage::open(&system::paths::db_path(&dir)).map_err(|e| e.to_string())
            });
            let error = opened.as_ref().err().cloned();
            if let Some(message) = &error {
                eprintln!("{message}");
            }
            app.manage(AppStorage::new(opened));

            // The main window is built here (`create: false` in tauri.conf.json) so it can
            // start on the error page. If it cannot be built, setup fails and the app exits
            // with the error instead of running with no window.
            let mut config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json has no main window")?;
            config.url = start_url(error.as_deref(), config.url)?;
            WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running Mnemo");
}

#[cfg(test)]
mod tests {
    use super::{error_page_url, start_url, AppStorage, MAX_MESSAGE_CHARS};
    use tauri::WebviewUrl;

    fn decode(url: &str) -> String {
        let body = url.strip_prefix("data:text/html;charset=utf-8,").unwrap();
        let mut bytes = Vec::new();
        let raw = body.as_bytes();
        let mut i = 0;
        while i < raw.len() {
            if raw[i] == b'%' {
                bytes.push(u8::from_str_radix(&body[i + 1..i + 3], 16).unwrap());
                i += 3;
            } else {
                bytes.push(raw[i]);
                i += 1;
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn error_page_shows_the_plain_message() {
        let html = decode(&error_page_url("Mnemo could not open its data file."));
        assert!(html.contains("Mnemo could not start"));
        assert!(html.contains("Mnemo could not open its data file."));
    }

    #[test]
    fn error_page_escapes_markup_in_the_message() {
        let html = decode(&error_page_url("<script>x</script>"));
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn start_url_is_the_app_when_storage_opened() {
        let app = WebviewUrl::App("index.html".into());
        let url = start_url(None, app).unwrap();
        assert!(matches!(url, WebviewUrl::App(p) if p.to_str() == Some("index.html")));
    }

    #[test]
    fn start_url_is_the_error_page_when_storage_failed() {
        let url = start_url(
            Some("Mnemo could not open its data file."),
            WebviewUrl::default(),
        );
        match url.unwrap() {
            WebviewUrl::External(u) => {
                assert_eq!(u.scheme(), "data");
                assert!(decode(u.as_str()).contains("Mnemo could not open its data file."));
            }
            other => panic!("expected the error page, got {other:?}"),
        }
    }

    #[test]
    fn start_url_cuts_a_very_long_message() {
        let long = "x".repeat(MAX_MESSAGE_CHARS * 5);
        let WebviewUrl::External(u) = start_url(Some(&long), WebviewUrl::default()).unwrap() else {
            panic!("expected the error page");
        };
        let html = decode(u.as_str());
        assert!(html.contains(&"x".repeat(MAX_MESSAGE_CHARS)));
        assert!(!html.contains(&"x".repeat(MAX_MESSAGE_CHARS + 1)));
    }

    #[test]
    fn app_storage_returns_the_startup_error_instead_of_panicking() {
        let state = AppStorage::new(Err("Mnemo could not open its data file.".into()));
        assert_eq!(
            state.get().err().as_deref(),
            Some("Mnemo could not open its data file.")
        );
    }

    #[test]
    fn app_storage_gives_the_database_when_it_opened() {
        let dir = std::env::temp_dir().join(format!("mnemo-appstorage-{}", uuid::Uuid::new_v4()));
        let opened =
            crate::storage::Storage::open(&dir.join("mnemo.db")).map_err(|e| e.to_string());
        let state = AppStorage::new(opened);
        assert!(state.get().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
