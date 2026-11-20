// Label picker: choose from the nested label tree, shown with full paths ("Work / Mnemo").
// Single mode picks one place (move a label; "(Top level)" is the top). Multiple mode picks several
// labels and shows each as a removable chip with its path. A node can be disabled with a reason
// that stays visible. The tree is a role=tree of treeitems; Arrow Up and Down, Home and End move
// between them, Enter and Space choose. Escape and the focus trap belong to the Dialog the picker
// sits in. Every name goes in as text.
import { Check, CircleAlert, Tag, X } from "lucide";
import { createIcon } from "../../icon";
import { nextControlId } from "../field/id";
import "./label-picker.css";

export interface LabelPickerNode {
  readonly name: string;
  readonly children?: readonly LabelPickerNode[];
  /** Why this node cannot be chosen. The node stays in the tree and shows the reason. */
  readonly disabled?: string;
  /** Marks the node as the current one (for a move, the current parent). */
  readonly current?: boolean;
}

export interface LabelPickerOptions {
  /** The accessible name of the tree and the label of the field. */
  readonly label: string;
  readonly mode: "single" | "multiple";
  readonly nodes: readonly LabelPickerNode[];
  /** Chosen paths. The top level is the empty path "". */
  readonly value?: readonly string[];
  /** Single mode: adds a "(Top level)" choice first. Its path is "". */
  readonly topLevel?: boolean;
  /** Shown when `nodes` is empty. Says how to create a label. */
  readonly emptyText?: string;
  readonly disabled?: boolean;
  readonly onChange?: (paths: readonly string[]) => void;
  /** Draws a state of one node without the pointer or keyboard, for the UI Catalog. */
  readonly forceState?: {
    readonly path: string;
    readonly state: "hover" | "active" | "focus";
  };
}

export interface LabelPicker {
  readonly element: HTMLElement;
  /** The chosen paths now. */
  value(): string[];
  /** Shows `text` as the field error, or clears it when `text` is null. */
  setError(text: string | null): void;
}

export const PATH_SEPARATOR = " / ";
export const TOP_LEVEL_LABEL = "(Top level)";
export const EMPTY_TEXT =
  "No labels yet. Create one from the label tree with New label.";

interface Flat {
  readonly path: string;
  readonly name: string;
  readonly level: number;
  readonly node: LabelPickerNode | null;
}

function flatten(
  nodes: readonly LabelPickerNode[],
  parent: string,
  level: number,
  out: Flat[],
): Flat[] {
  for (const node of nodes) {
    const path = parent ? `${parent}${PATH_SEPARATOR}${node.name}` : node.name;
    out.push({ path, name: node.name, level, node });
    flatten(node.children ?? [], path, level + 1, out);
  }
  return out;
}

export function createLabelPicker(
  doc: Document,
  options: LabelPickerOptions,
): LabelPicker {
  const multiple = options.mode === "multiple";
  const id = nextControlId("label-picker");
  const wrap = doc.createElement("div");
  wrap.className = "label-picker";

  const legend = doc.createElement("span");
  legend.className = "label-picker-label";
  legend.id = `${id}-label`;
  legend.textContent = options.label;
  wrap.append(legend);

  const flat: Flat[] = [];
  if (options.topLevel && !multiple)
    flat.push({ path: "", name: TOP_LEVEL_LABEL, level: 0, node: null });
  flatten(options.nodes, "", 0, flat);

  let chosen: string[] = [...(options.value ?? [])];
  if (!multiple) chosen = chosen.slice(0, 1);

  const chips = doc.createElement("ul");
  chips.className = "label-picker-chosen";
  chips.setAttribute("aria-label", `Chosen: ${options.label}`);
  const tree = doc.createElement("div");
  tree.className = "label-picker-tree";
  tree.id = `${id}-tree`;
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-labelledby", legend.id);
  tree.setAttribute("aria-multiselectable", String(multiple));
  const error = doc.createElement("span");
  error.className = "err-text label-picker-error";
  error.id = `${id}-error`;
  error.setAttribute("role", "status");
  error.hidden = true;

  const items = new Map<string, HTMLButtonElement>();
  const isDisabled = (f: Flat) => Boolean(options.disabled || f.node?.disabled);

  const choose = (path: string) => {
    if (multiple) {
      chosen = chosen.includes(path)
        ? chosen.filter((p) => p !== path)
        : [...chosen, path];
    } else chosen = [path];
    render();
    options.onChange?.([...chosen]);
  };

  const buildItem = (f: Flat) => {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "label-picker-item";
    btn.setAttribute("role", "treeitem");
    btn.setAttribute("aria-level", String(f.level + 1));
    btn.setAttribute("aria-label", f.path === "" ? f.name : f.path);
    btn.dataset.path = f.path;
    btn.dataset.level = String(f.level);
    btn.title = f.path === "" ? f.name : f.path;
    const name = doc.createElement("span");
    name.className = "label-picker-name";
    name.textContent = f.name;
    const mark = doc.createElement("span");
    mark.className = "label-picker-mark";
    mark.append(createIcon(Check, "sm"));
    btn.append(createIcon(Tag, "sm", "ic-muted"), name);
    const notes = doc.createElement("span");
    notes.className = "label-picker-notes";
    if (f.node?.current) {
      const cur = doc.createElement("span");
      cur.className = "label-picker-current";
      cur.textContent = "Current";
      notes.append(cur);
    }
    const reason = f.node?.disabled;
    if (reason) {
      const why = doc.createElement("span");
      why.className = "label-picker-reason";
      why.id = `${id}-why-${items.size}`;
      why.textContent = reason;
      notes.append(why);
      btn.setAttribute("aria-describedby", why.id);
    }
    btn.append(notes, mark);
    if (isDisabled(f)) btn.setAttribute("aria-disabled", "true");
    if (options.forceState?.path === f.path)
      btn.classList.add(`is-${options.forceState.state}`);
    btn.addEventListener("click", () => {
      if (isDisabled(f)) return;
      choose(f.path);
    });
    items.set(f.path, btn);
    tree.append(btn);
  };
  for (const f of flat) buildItem(f);

  const chipFor = (path: string) => {
    const li = doc.createElement("li");
    li.className = "label-picker-chip";
    const text = doc.createElement("span");
    text.className = "label-picker-chip-text";
    text.textContent = path;
    text.title = path;
    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "label-picker-chip-remove";
    remove.setAttribute("aria-label", `Remove label ${path}`);
    remove.disabled = options.disabled ?? false;
    remove.append(createIcon(X));
    remove.addEventListener("click", () => {
      choose(path);
      tree.querySelector<HTMLElement>("[tabindex='0']")?.focus();
    });
    li.append(text, remove);
    return li;
  };

  const render = () => {
    for (const [path, btn] of items) {
      const on = chosen.includes(path);
      btn.setAttribute("aria-selected", String(on));
      btn.classList.toggle("is-selected", on);
    }
    const all = [...items.values()];
    const stop =
      chosen.map((p) => items.get(p)).find(Boolean) ??
      all.find((b) => b.getAttribute("aria-disabled") !== "true") ??
      all[0];
    for (const btn of all) btn.tabIndex = btn === stop ? 0 : -1;
    chips.replaceChildren(...chosen.map(chipFor));
    chips.hidden = !multiple || chosen.length === 0;
  };

  tree.addEventListener("keydown", (e) => {
    const list = [...items.values()];
    const i = list.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return;
    let to = -1;
    if (e.key === "ArrowDown") to = Math.min(i + 1, list.length - 1);
    else if (e.key === "ArrowUp") to = Math.max(i - 1, 0);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = list.length - 1;
    if (to < 0) return;
    e.preventDefault();
    for (const b of list) b.tabIndex = -1;
    list[to].tabIndex = 0;
    list[to].focus();
  });

  if (multiple) wrap.append(chips);
  if (flat.length === 0) {
    const box = doc.createElement("p");
    box.className = "label-picker-empty is-empty";
    box.textContent = options.emptyText ?? EMPTY_TEXT;
    wrap.append(box);
  } else wrap.append(tree);
  wrap.append(error);
  wrap.classList.toggle("is-disabled", options.disabled ?? false);
  render();

  return {
    element: wrap,
    value: () => [...chosen],
    setError(text) {
      error.hidden = text === null;
      error.replaceChildren();
      if (text !== null) {
        error.append(createIcon(CircleAlert), doc.createTextNode(text));
        tree.setAttribute("aria-invalid", "true");
        tree.setAttribute("aria-describedby", error.id);
      } else {
        tree.removeAttribute("aria-invalid");
        tree.removeAttribute("aria-describedby");
      }
      wrap.classList.toggle("is-error", text !== null);
    },
  };
}
