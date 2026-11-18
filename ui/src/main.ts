import { invoke } from "@tauri-apps/api/core";
import { pingErrorText } from "./ping-text";
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

void showPing();
