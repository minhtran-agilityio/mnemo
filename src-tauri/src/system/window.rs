//! Main window behaviour: show it again and decide what closing it does.

use tauri::{AppHandle, Manager, Window, WindowEvent};

/// Managed state: whether a tray item can be seen on this desktop.
pub struct TrayAvailable(pub bool);

/// What closing the window does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Hide the window; the tray item brings it back.
    Hide,
    /// Minimise the window; there is no tray item to bring it back.
    Minimize,
}

/// Decides what to do on close. With no visible tray, hiding would lose the window.
pub fn close_action(tray_available: bool) -> CloseAction {
    if tray_available {
        CloseAction::Hide
    } else {
        CloseAction::Minimize
    }
}

/// Shows the main window again, restores it if minimised, and focuses it.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Close-to-hide: closing the window never stops the app; only Quit does.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let tray = window
            .try_state::<TrayAvailable>()
            .is_some_and(|state| state.0);
        let result = match close_action(tray) {
            CloseAction::Hide => window.hide(),
            CloseAction::Minimize => window.minimize(),
        };
        if let Err(err) = result {
            log::error!("could not hide or minimise the window on close: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_hides_when_a_tray_is_available() {
        assert_eq!(close_action(true), CloseAction::Hide);
    }

    #[test]
    fn close_minimises_when_no_tray_is_available() {
        assert_eq!(close_action(false), CloseAction::Minimize);
    }
}
