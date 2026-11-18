// Crate root: declares the core modules and wires the Tauri commands.
mod ai;
mod commands;
mod scheduler;
mod storage;
mod system;

use std::sync::Mutex;

use tauri::Manager;

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

/// Replaces the main window content with the plain error screen. If the window cannot be
/// changed, the error is still written to stderr. Showing a `data:` page in the webview is
/// **Unverified** on a real run.
fn show_startup_error(app: &tauri::AppHandle, message: &str) {
    eprintln!("{message}");
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(url) = error_page_url(message).parse() {
            let _ = window.navigate(url);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Open the one database in the app data folder. On failure the main window
            // shows a plain error screen; the data file is never deleted or replaced.
            let opened = system::paths::data_dir(app.handle()).and_then(|dir| {
                storage::Storage::open(&system::paths::db_path(&dir)).map_err(|e| e.to_string())
            });
            match opened {
                Ok(storage) => {
                    app.manage(Mutex::new(storage));
                }
                Err(message) => show_startup_error(app.handle(), &message),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running Mnemo");
}

#[cfg(test)]
mod tests {
    use super::error_page_url;

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
}
