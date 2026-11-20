//! Main window behaviour: show it again and decide what closing it does.

use std::sync::Mutex;

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow, Window, WindowEvent,
};
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

/// The size a window of `size` (logical pixels) must have to respect `min_width` and `min_height`:
/// the larger of the two on each side. `None` when it already fits and nothing needs to change.
pub fn clamp_to_minimum(
    size: (f64, f64),
    min_width: Option<f64>,
    min_height: Option<f64>,
) -> Option<(f64, f64)> {
    let width = size.0.max(min_width.unwrap_or(0.0));
    let height = size.1.max(min_height.unwrap_or(0.0));
    ((width, height) != size).then_some((width, height))
}

/// After the window is built and the window-state plugin has restored its saved size: a size saved
/// before the minimum existed may be smaller than the minimum, and macOS does not clamp a size that
/// is set in code. Grows the window to max(saved, minimum). **Unverified** on both platforms: the
/// restore is assumed to have run when the builder returns.
pub fn enforce_minimum(window: &WebviewWindow, min_width: Option<f64>, min_height: Option<f64>) {
    let size = match (window.inner_size(), window.scale_factor()) {
        (Ok(size), Ok(scale)) => size.to_logical::<f64>(scale),
        (Err(err), _) | (_, Err(err)) => {
            log::error!("could not read the window size to check the minimum: {err}");
            return;
        }
    };
    if let Some((width, height)) =
        clamp_to_minimum((size.width, size.height), min_width, min_height)
    {
        if let Err(err) = window.set_size(LogicalSize::new(width, height)) {
            log::error!("could not grow the window to its minimum size: {err}");
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

    #[test]
    fn a_saved_size_below_the_minimum_grows_to_it() {
        let min = (Some(800.0), Some(560.0));
        assert_eq!(
            clamp_to_minimum((600.0, 400.0), min.0, min.1),
            Some((800.0, 560.0))
        );
        // Only the side that is too small changes: max(saved, minimum) on each side.
        assert_eq!(
            clamp_to_minimum((1200.0, 300.0), min.0, min.1),
            Some((1200.0, 560.0))
        );
        assert_eq!(
            clamp_to_minimum((700.0, 900.0), min.0, min.1),
            Some((800.0, 900.0))
        );
    }

    #[test]
    fn a_saved_size_at_or_above_the_minimum_is_left_alone() {
        assert_eq!(
            clamp_to_minimum((800.0, 560.0), Some(800.0), Some(560.0)),
            None
        );
        assert_eq!(
            clamp_to_minimum((1440.0, 900.0), Some(800.0), Some(560.0)),
            None
        );
    }

    #[test]
    fn no_minimum_leaves_any_size_alone() {
        assert_eq!(clamp_to_minimum((100.0, 100.0), None, None), None);
        assert_eq!(
            clamp_to_minimum((100.0, 100.0), Some(800.0), None),
            Some((800.0, 100.0))
        );
    }
}
