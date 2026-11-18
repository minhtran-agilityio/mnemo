import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { pingErrorText } from "./ping-text";
import { versionErrorText, versionText } from "./version-text";
import "./style.css";

const status = document.querySelector<HTMLElement>("#ping-status");

async function showPing(): Promise<void> {
  if (!status) return;
  try {
    status.textContent = await invoke<string>("ping");
  } catch (error) {
    status.textContent = pingErrorText(error);
  }
}

const versionEl = document.querySelector<HTMLElement>("#app-version");

async function showVersion(): Promise<void> {
  if (!versionEl) return;
  try {
    versionEl.textContent = versionText(await getVersion());
  } catch (error) {
    versionEl.textContent = versionErrorText(error);
  }
}

void showPing();
void showVersion();
