//! The tray item (Open, Quit) and the check that a tray is visible on this desktop.

use super::window::show_main;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::App;

/// Builds the tray item with exactly two entries: Open and Quit.
pub fn build_tray(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Asks the session D-Bus whether a StatusNotifier watcher owns its name. Without one (GNOME
/// without the AppIndicator extension) a tray item is never shown.
#[cfg(target_os = "linux")]
pub fn tray_available() -> bool {
    use gio::glib::{ToVariant, VariantTy};

    let connection = match gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) {
        Ok(connection) => connection,
        Err(err) => {
            log::error!("could not reach the session D-Bus: {err}");
            return false;
        }
    };
    let reply = connection.call_sync(
        Some("org.freedesktop.DBus"),
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "NameHasOwner",
        Some(&("org.kde.StatusNotifierWatcher",).to_variant()),
        Some(VariantTy::new("(b)").expect("valid variant type")),
        gio::DBusCallFlags::NONE,
        2000,
        gio::Cancellable::NONE,
    );
    match reply {
        Ok(value) => value.child_value(0).get::<bool>().unwrap_or(false),
        Err(err) => {
            log::error!("could not ask D-Bus for a StatusNotifier watcher: {err}");
            false
        }
    }
}

/// macOS always has a menu bar for the tray item.
#[cfg(not(target_os = "linux"))]
pub fn tray_available() -> bool {
    true
}
