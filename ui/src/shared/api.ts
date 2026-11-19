// The one typed client for the Tauri commands. Screens call these functions and never
// call invoke themselves.
import { invoke } from "@tauri-apps/api/core";

/** The error shape every command rejects with: a stable code and a plain message. */
export interface AppError {
  code: string;
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppError).code === "string" &&
    typeof (value as AppError).message === "string"
  );
}

/** A plain sentence for any failure, using the core's message when it sent one. */
export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  return "Something went wrong. Try again.";
}

/** Proves the Rust core is reachable. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}

/** The value saved under `key`, or null when it was never saved. */
export async function getSetting(key: string): Promise<string | null> {
  const value = await invoke<string | null | undefined>("get_setting", { key });
  return value ?? null;
}

/** Saves `value` under `key`, replacing an earlier value. */
export async function setSetting(key: string, value: string): Promise<void> {
  await invoke<void>("set_setting", { key, value });
}
