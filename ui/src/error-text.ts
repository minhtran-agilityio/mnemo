// Turns the startup error code from the core into the plain sentence the error page shows.
// The core sends only a code, never raw error text, so no file path reaches the UI.
const REASONS: Record<string, string> = {
  folder:
    "Mnemo could not find or create its data folder. Nothing was deleted or changed.",
  open: "Mnemo could not open its data file. Nothing was deleted.",
  migration:
    "Mnemo could not update its data file. The update was undone and your data is unchanged.",
  too_new:
    "The data file was made by a newer Mnemo. Update Mnemo to open it. Nothing was deleted.",
  database: "Mnemo's data file gave an error. Nothing was deleted or changed.",
};

const FALLBACK =
  "Mnemo could not open its data file. Nothing was deleted or changed.";

export function startupReasonText(code: string | null): string {
  return code !== null && Object.hasOwn(REASONS, code)
    ? REASONS[code]
    : FALLBACK;
}
