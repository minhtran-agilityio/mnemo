// Turns the app version (or a failed lookup) into the text the window shows.
export function versionText(version: string): string {
  return `Version ${version}`;
}

// The raw error is not shown in the window (it can hold paths or internal
// detail). It is logged to the console so a failure leaves a diagnostic.
export function versionErrorText(error: unknown): string {
  console.error("getVersion failed:", error);
  return "Version unknown: could not read the app version.";
}
