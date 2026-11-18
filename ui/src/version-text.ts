// Turns the app version (or a failed lookup) into the text the window shows.
export function versionText(version: string): string {
  return `Version ${version}`;
}

export function versionErrorText(error: unknown): string {
  return `Version unknown: ${String(error)}`;
}
