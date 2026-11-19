import type { IconNode } from "lucide";
import { createIcon } from "../../icon";
import "./pill.css";

export type PillTint = "default" | "info" | "good" | "warn" | "note" | "bad";

export interface PillOptions {
  readonly text: string;
  readonly tint?: PillTint;
  /** An optional icon before the word. The word still carries the meaning. */
  readonly icon?: IconNode;
}

/** A pill: a short label such as "Draft" or "Overdue". Class names: `pill`, `pill-<tint>`. */
export function buildPill(options: PillOptions): HTMLSpanElement {
  const tint = options.tint ?? "default";
  const pill = document.createElement("span");
  pill.className = tint === "default" ? "pill" : `pill pill-${tint}`;
  if (options.icon) pill.append(createIcon(options.icon, "sm"));
  pill.append(document.createTextNode(options.text));
  return pill;
}
