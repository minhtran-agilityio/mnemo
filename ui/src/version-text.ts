// Turns the app version (or a failed lookup) into the text the window shows.
export function versionText(version: string): string {
  return `Version ${version}`;
}

// The raw error is not shown in the window (it can hold paths or internal
// detail); the caller logs it.
export function versionErrorText(): string {
  return "Version unknown: could not read the app version.";
}
