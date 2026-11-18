// Turns the startup error code from the core into the plain sentence the error page shows.
// The core sends only a code, never raw error text, so no file path reaches the UI.
// The codes come from `open_storage` and `startup_code` in src-tauri/src/lib.rs.
export const REASONS: Record<string, string> = {
  folder: "Mnemo could not find its data folder. Nothing was deleted.",
  open: "Mnemo could not open or create its data file or folder. Nothing was deleted.",
  migration:
    "Mnemo could not finish updating its data file. The failed step was undone and nothing was deleted.",
  too_new:
    "The data file was made by a newer Mnemo. Update Mnemo to open it. Nothing was deleted.",
  database: "Mnemo's data file gave an error. Nothing was deleted.",
};

// Also written in ui/error.html, so the page is honest before the script runs.
export const FALLBACK =
  "Mnemo could not open its data file. Nothing was deleted.";

export function startupReasonText(code: string | null): string {
  return code !== null && Object.hasOwn(REASONS, code)
    ? REASONS[code]
    : FALLBACK;
}
