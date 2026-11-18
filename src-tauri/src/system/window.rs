//! Main window behaviour: show it again and decide what closing it does.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Managed state: whether a tray item can be seen on this desktop.
pub struct TrayAvailable(pub bool);

/// Managed state: where the window was when it was hidden. Some window managers
/// (X11 under GNOME) place a re-shown window somewhere new, so Open puts it back here.
#[derive(Default)]
pub struct HiddenAt(pub Mutex<Option<PhysicalPosition<i32>>>);

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
        let saved = app
            .try_state::<HiddenAt>()
            .and_then(|state| state.0.lock().ok().and_then(|mut pos| pos.take()));
        if let Some(pos) = saved {
            if let Err(err) = window.set_position(pos) {
                log::error!("could not put the window back where it was: {err}");
            }
        }
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
            CloseAction::Hide => {
                remember_position(window);
                window.hide()
            }
            CloseAction::Minimize => window.minimize(),
        };
        if let Err(err) = result {
            log::error!("could not hide or minimise the window on close: {err}");
        }
        // Without a tray there is no Quit, so the app may end by signal and skip the save on
        // exit. Save size and position now.
        if let Err(err) = window
            .app_handle()
            .save_window_state(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        {
            log::error!("could not save the window size and position: {err}");
        }
    }
}

/// Saves the window position before it is hidden, so `show_main` can restore it.
fn remember_position(window: &Window) {
    let Some(state) = window.try_state::<HiddenAt>() else {
        return;
    };
    match window.outer_position() {
        Ok(pos) => {
            if let Ok(mut slot) = state.0.lock() {
                *slot = Some(pos);
            }
        }
        Err(err) => log::error!("could not read the window position before hiding: {err}"),
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
