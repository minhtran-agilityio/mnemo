import { invoke } from "@tauri-apps/api/core";
import "./style.css";

const status = document.querySelector<HTMLElement>("#ping-status");

async function showPing(): Promise<void> {
  if (!status) return;
  try {
    status.textContent = await invoke<string>("ping");
  } catch (error) {
    status.textContent = `Could not reach the Rust core: ${String(error)}`;
  }
}

void showPing();
