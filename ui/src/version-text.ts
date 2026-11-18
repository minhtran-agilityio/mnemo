// Turns the app version (or a failed lookup) into the text the window shows.
export function versionText(version: string): string {
  return `Version ${version}`;
}

// The raw error is not shown: it can hold paths or internal detail.
export function versionErrorText(_error: unknown): string {
  return "Version unknown: could not read the app version.";
}
