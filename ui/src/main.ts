import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { pingErrorText } from "./ping-text";
import { mountKanban } from "./screens/kanban/kanban";
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
    console.error("getVersion failed:", error);
    versionEl.textContent = versionErrorText();
  }
}

void showPing();
void showVersion();

// Proof screen for the UI approach (#7); P1.2 replaces it with the real app frame.
const boardEl = document.querySelector<HTMLElement>("#board");
const boardStatus = document.querySelector<HTMLElement>("#board-status");
if (boardEl && boardStatus) mountKanban(boardEl, boardStatus);
