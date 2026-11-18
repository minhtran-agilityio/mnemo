// Turns a failed ping call into the text the window shows.
export function pingErrorText(error: unknown): string {
  return `Could not reach the Rust core: ${String(error)}`;
}
