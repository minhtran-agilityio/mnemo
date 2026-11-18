import "./fonts";
import "./tokens.css";
import "./base.css";
import "./style.css";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { pingErrorText } from "./ping-text";
import { mountKanban } from "./screens/kanban/kanban";
import { mountSample } from "./screens/sample/sample";
import { versionErrorText, versionText } from "./version-text";

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

// Style sample for the design tokens (#10); removed when the real app frame lands.
const sampleEl = document.querySelector<HTMLElement>("#sample");
if (sampleEl) mountSample(sampleEl);
