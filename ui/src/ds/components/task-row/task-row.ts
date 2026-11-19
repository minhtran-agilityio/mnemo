// A task in a list: a checkbox, the title, a meta line and a status pill. Done tasks are struck
// through AND say "Done" in text, so colour and line are never the only signal. The whole label
// is the click target.
import { Check } from "lucide";
import { createRecordIcon } from "../record-icon/record-icon";
import "./task-row.css";

export interface TaskRowOptions {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly done?: boolean;
  /** The status pill text ("Today", "Overdue") and its tone. */
  readonly badge?: { text: string; tone: "warn" | "bad" };
  readonly onToggle?: (done: boolean) => void;
}

export function createTaskRow(
  doc: Document,
  options: TaskRowOptions,
): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "row task-row";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.id = options.id;
  box.className = "task-check";
  box.checked = options.done === true;
  const label = doc.createElement("label");
  label.className = "row-body";
  label.htmlFor = options.id;
  const title = doc.createElement("span");
  title.className = "row-title";
  title.textContent = options.title;
  title.title = options.title;
  const meta = doc.createElement("span");
  meta.className = "row-meta";
  meta.textContent = options.meta;
  label.append(title, meta);
  li.append(box, label);

  const status = doc.createElement("span");
  const paint = () => {
    const done = box.checked;
    li.classList.toggle("done", done);
    status.textContent = "";
    if (done) {
      status.className = "pill pill-good";
      status.append(createRecordIcon(Check), doc.createTextNode("Done"));
    } else if (options.badge) {
      status.className = `pill pill-${options.badge.tone}`;
      status.textContent = options.badge.text;
    } else {
      status.className = "";
    }
  };
  paint();
  if (status.className) li.append(status);
  box.addEventListener("change", () => {
    paint();
    if (status.className && !status.isConnected) li.append(status);
    options.onToggle?.(box.checked);
  });
  return li;
}
