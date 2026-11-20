// A tree for folders and nested labels. A node with children is a button with aria-expanded that
// opens and closes its group. The current node has aria-current. Arrow Up and Down move between
// the visible nodes, Arrow Right opens and Arrow Left closes; Tab and Enter work as on any button.
//
// With `actions` the owner manages the labels in place. Each node gets a menu (the "..."
// button, the context menu, Shift+F10) with New label inside, Rename (F2), Move to and Delete
// (Delete key). Rename and create open a field in the row: Enter saves, Escape cancels, an empty or
// duplicate name is refused at the field. The tree only reports the chosen node and the action; the
// screen does the work. A refused action stays in the menu, disabled, with its reason.
import {
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Folder,
  type IconNode,
  Plus,
  Tag,
} from "lucide";
import { createIcon } from "../../icon";
import { createButton } from "../button/button";
import { createTextInput } from "../input/input";
import { createMenuPanel, type MenuEntry, type MenuItem } from "../menu/menu";
import { createPopover, type Popover } from "../popover/popover";
import { buildEmptyState } from "../state-box/state-box";
import "./tree.css";

export type TreeAction = "create" | "rename" | "move" | "delete";

export interface TreeNode {
  readonly label: string;
  readonly kind: "folder" | "label";
  readonly count?: number;
  readonly children?: readonly TreeNode[];
  readonly expanded?: boolean;
  readonly current?: boolean;
  /** Names the node in a TreeActionEvent. Defaults to the label. */
  readonly id?: string;
  /** An action the screen refuses for this node, with the reason. It stays in the menu, disabled. */
  readonly refused?: Partial<Record<TreeAction, string>>;
}

/** What the tree reports. The screen does the work. */
export interface TreeActionEvent {
  readonly action: TreeAction;
  /** The node acted on. For "create": the parent, or null for the top level. */
  readonly id: string | null;
  /** The label of that node ("" for the top level). */
  readonly label: string;
  /** The typed name, for "create" and "rename". */
  readonly name?: string;
}

/** A look the pointer or keyboard cannot hold still (the catalog shows these). */
export interface TreeForcedState {
  readonly id: string;
  readonly state: "hover" | "active" | "focus" | "menu" | "renaming" | "error";
  /** The text in the field, for "renaming" and "error". */
  readonly value?: string;
}

export interface TreeActionsOptions {
  readonly onAction: (event: TreeActionEvent) => void;
  /** An extra rule for a name. Return the message to show at the field, or nothing. */
  readonly validateName?: (
    name: string,
    action: "create" | "rename",
  ) => string | undefined;
  readonly forced?: TreeForcedState;
  /** When it aborts, an open menu closes and its document listener goes. */
  readonly signal?: AbortSignal;
}

const ICONS: Record<TreeNode["kind"], IconNode> = {
  folder: Folder,
  label: Tag,
};

const KEYS = "F2 Delete Shift+F10";
const ACTIONS: readonly TreeAction[] = ["create", "rename", "move", "delete"];
const nameKey = (name: string) => name.trim().normalize("NFC").toLowerCase();
const idOf = (node: TreeNode) => node.id ?? node.label;
let counter = 0;

interface Meta {
  readonly node: TreeNode;
  readonly siblings: readonly TreeNode[];
}

type Run = (action: TreeAction, node: TreeNode, btn: HTMLButtonElement) => void;

interface Build {
  readonly meta: WeakMap<HTMLElement, Meta>;
  readonly menus: WeakMap<HTMLElement, Popover>;
  readonly actions?: TreeActionsOptions;
  readonly run: Run;
  /** Names the owner saved by rename. The tree keeps them, so F2 again, the duplicate check and
   * the menu names follow the rename without the screen re-rendering first. */
  readonly names: Map<TreeNode, string>;
}

const labelOf = (build: Build, node: TreeNode) =>
  build.names.get(node) ?? node.label;

function menuFor(
  doc: Document,
  node: TreeNode,
  btn: HTMLButtonElement,
  build: Build,
): HTMLElement {
  const refused = node.refused ?? {};
  const item = (
    action: TreeAction,
    label: string,
    extra: Partial<MenuItem> = {},
  ): MenuItem => ({
    label,
    disabled: refused[action] !== undefined,
    // Close the menu and put focus on the node first, so a rename field that takes focus after
    // it is not pulled away again.
    onSelect: () => {
      pop?.close(false);
      btn.focus();
      build.run(action, node, btn);
    },
    ...extra,
  });
  const entries: MenuEntry[] = [
    item("create", "New label inside"),
    item("rename", "Rename", { shortcut: "F2" }),
    item("move", "Move to…"),
    "separator",
    item("delete", "Delete", { danger: true, shortcut: "Del" }),
  ];
  const trigger = createButton(doc, {
    label: `Actions for ${node.label}`,
    iconOnly: true,
    icon: Ellipsis,
    size: "sm",
    variant: "ghost",
  });
  trigger.classList.add("tmore");
  trigger.tabIndex = -1;
  let pop: Popover | undefined;
  const panel = createMenuPanel(doc, entries, {
    ariaLabel: `Actions for ${node.label}`,
  });
  panel.classList.add("tmenu");
  // A refused action keeps its place and says why, under its name.
  const rows = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  ACTIONS.forEach((action, i) => {
    const reason = refused[action];
    const row = rows[i];
    if (reason === undefined || !row) return;
    counter += 1;
    const why = doc.createElement("span");
    why.className = "tmenu-why";
    why.id = `tmenu-why-${counter}`;
    why.textContent = reason;
    row.classList.add("has-why");
    row.setAttribute("aria-describedby", why.id);
    row.append(why);
  });
  pop = createPopover(doc, {
    trigger,
    panel,
    haspopup: "menu",
    signal: build.actions?.signal,
    firstFocus: () => rows[0] ?? null,
  });
  // Escape closes the menu (the popover does that); focus goes back to the node, not the "..." button.
  pop.anchor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") btn.focus();
  });
  build.menus.set(btn, pop);
  return pop.anchor;
}

function buildNodes(
  doc: Document,
  nodes: readonly TreeNode[],
  build: Build,
): HTMLUListElement {
  const ul = doc.createElement("ul");
  for (const node of nodes) {
    const li = doc.createElement("li");
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "tnode";
    const hasKids = (node.children?.length ?? 0) > 0;
    if (hasKids) {
      btn.setAttribute("aria-expanded", String(node.expanded === true));
      btn.append(createIcon(ChevronRight, "sm", "chev"));
    } else {
      const spacer = doc.createElement("span");
      spacer.className = "spacer";
      btn.append(spacer);
    }
    if (node.current) btn.setAttribute("aria-current", "true");
    const name = doc.createElement("span");
    name.className = "tname";
    name.textContent = node.label;
    name.title = node.label;
    btn.append(createIcon(ICONS[node.kind], "sm", "ic-muted"), name);
    if (node.count !== undefined) {
      const cnt = doc.createElement("span");
      cnt.className = "cnt";
      cnt.textContent = String(node.count);
      btn.append(cnt);
    }
    build.meta.set(btn, { node, siblings: nodes });
    if (build.actions) {
      btn.setAttribute("aria-keyshortcuts", KEYS);
      const row = doc.createElement("div");
      row.className = "trow";
      row.append(btn, menuFor(doc, node, btn, build));
      li.append(row);
    } else {
      li.append(btn);
    }
    if (hasKids) {
      const sub = buildNodes(doc, node.children ?? [], build);
      sub.hidden = node.expanded !== true;
      li.append(sub);
    }
    ul.append(li);
  }
  return ul;
}

type Edit = (
  mode: "create" | "rename",
  target: HTMLButtonElement | null,
  options?: { value?: string; focus?: boolean },
) => void;

export function createTree(
  doc: Document,
  label: string,
  nodes: readonly TreeNode[],
  onSelect?: (label: string) => void,
  actions?: TreeActionsOptions,
): HTMLElement {
  // The actions need the finished tree (to find a row), so `run` reads `startEdit` when called.
  let startEdit: Edit = () => {};
  let openField: HTMLInputElement | null = null;
  const build: Build = {
    meta: new WeakMap(),
    menus: new WeakMap(),
    names: new Map(),
    actions,
    run: (action, node, btn) => {
      if (action === "rename" || action === "create") startEdit(action, btn);
      else
        actions?.onAction({
          action,
          id: idOf(node),
          label: labelOf(build, node),
        });
    },
  };
  const tree = buildNodes(doc, nodes, build);
  tree.classList.add("tree");
  tree.setAttribute("aria-label", label);
  const visible = () =>
    [...tree.querySelectorAll<HTMLButtonElement>(".tnode")].filter(
      (b) => !b.hidden && !b.closest("ul[hidden]"),
    );
  const subOf = (btn: HTMLElement): HTMLElement | null =>
    [...(btn.closest("li")?.children ?? [])].find(
      (c): c is HTMLElement => c.tagName === "UL",
    ) ?? null;
  const setOpen = (btn: HTMLElement, open: boolean) => {
    btn.setAttribute("aria-expanded", String(open));
    const sub = subOf(btn);
    if (sub) sub.hidden = !open;
  };
  tree.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".tnode");
    if (!btn) return;
    if (btn.hasAttribute("aria-expanded"))
      setOpen(btn, btn.getAttribute("aria-expanded") !== "true");
    for (const b of tree.querySelectorAll(".tnode"))
      b.removeAttribute("aria-current");
    btn.setAttribute("aria-current", "true");
    onSelect?.(btn.querySelector(".tname")?.textContent ?? "");
  });
  tree.addEventListener("keydown", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".tnode");
    if (!btn) return;
    const list = visible();
    const i = list.indexOf(btn);
    if (e.key === "ArrowDown" && i < list.length - 1) {
      e.preventDefault();
      list[i + 1].focus();
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      list[i - 1].focus();
    } else if (
      e.key === "ArrowRight" &&
      btn.getAttribute("aria-expanded") === "false"
    ) {
      e.preventDefault();
      setOpen(btn, true);
    } else if (
      e.key === "ArrowLeft" &&
      btn.getAttribute("aria-expanded") === "true"
    ) {
      e.preventDefault();
      setOpen(btn, false);
    } else if (actions) {
      const meta = build.meta.get(btn);
      const key =
        e.key === "F2"
          ? "rename"
          : e.key === "Delete"
            ? "delete"
            : e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")
              ? "menu"
              : null;
      if (!meta || !key) return;
      e.preventDefault();
      // A refused action opens the menu, which shows the reason.
      if (key === "menu" || meta.node.refused?.[key] !== undefined)
        build.menus.get(btn)?.open();
      else build.run(key, meta.node, btn);
    }
  });
  if (!actions) return tree;

  // Actions: the box holds the tree, the empty state and the New label button.
  const box = doc.createElement("div");
  box.className = "tree-box";
  const newLabel = createButton(doc, {
    label: "New label",
    icon: Plus,
    size: "sm",
    variant: "ghost",
    onClick: () => startEdit("create", null),
  });
  newLabel.classList.add("tree-new");
  const empty = buildEmptyState({
    title: "No labels yet",
    body: "Create a label to group your notes. You can nest labels later.",
    action: { label: "New label", onClick: () => startEdit("create", null) },
  });
  box.append(tree, empty, newLabel);
  const sync = () => {
    const none = tree.querySelector("li") === null;
    empty.hidden = !none;
    newLabel.hidden = none;
    tree.hidden = none;
  };
  sync();

  tree.addEventListener("contextmenu", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".tnode");
    const pop = btn ? build.menus.get(btn) : undefined;
    if (!pop) return;
    e.preventDefault();
    pop.open();
  });

  /** The field of an inline rename or create. Enter saves; Escape or leaving the field cancels. */
  startEdit = (mode, target, options = {}) => {
    // One field at a time: a second request goes to the field that is open.
    if (openField) {
      openField.focus();
      return;
    }
    const meta = target ? build.meta.get(target) : undefined;
    if (mode === "rename" && (!target || !meta)) return;
    const current = mode === "rename" && meta ? labelOf(build, meta.node) : "";
    const siblings: readonly TreeNode[] =
      mode === "rename"
        ? (meta?.siblings ?? [])
        : target
          ? (meta?.node.children ?? [])
          : nodes;
    // Where the field goes: in the node's own row (rename) or in a new row of the parent's list.
    let row: HTMLElement | null = null;
    let list: HTMLElement | null = null;
    let createdList = false;
    if (mode === "create") {
      const parentLi = target?.closest("li") ?? null;
      list = parentLi && target ? subOf(target) : tree;
      if (!list && parentLi) {
        list = doc.createElement("ul");
        parentLi.append(list);
        createdList = true;
      }
      if (!list) return;
      if (target?.hasAttribute("aria-expanded")) setOpen(target, true);
      list.hidden = false;
      row = doc.createElement("li");
      list.append(row);
    }
    tree.hidden = false;
    empty.hidden = true;
    const input = createTextInput(doc, { value: options.value ?? current });
    input.setAttribute(
      "aria-label",
      mode === "rename" ? `Rename ${current}` : "New label name",
    );
    const spacer = doc.createElement("span");
    spacer.className = "spacer";
    const line = doc.createElement("div");
    line.className = "tedit-line";
    line.append(spacer, createIcon(Tag, "sm", "ic-muted"), input);
    const edit = doc.createElement("div");
    edit.className = "tedit";
    edit.append(line);
    let message: HTMLElement | null = null;
    const showError = (text: string | undefined) => {
      message?.remove();
      message = null;
      if (text === undefined) {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
        return;
      }
      message = doc.createElement("span");
      message.className = "err-text";
      counter += 1;
      message.id = `tree-err-${counter}`;
      message.setAttribute("role", "alert");
      message.append(createIcon(CircleAlert), doc.createTextNode(text));
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", message.id);
      edit.append(message);
    };
    const problem = (typed: string): string | undefined => {
      const name = typed.trim();
      if (!name) return "Type a name before you save.";
      if (
        siblings.some(
          (s) =>
            labelOf(build, s) !== current &&
            nameKey(labelOf(build, s)) === nameKey(name),
        )
      )
        return `A label named "${name}" already exists here.`;
      return actions.validateName?.(name, mode);
    };
    let closed = false;
    const close = (returnFocus: boolean) => {
      if (closed) return;
      closed = true;
      openField = null;
      newLabel.disabled = false;
      edit.remove();
      if (mode === "rename" && target) {
        target.hidden = false;
        target.closest(".trow")?.classList.remove("is-editing");
      } else {
        row?.remove();
        if (createdList) list?.remove();
      }
      sync();
      if (returnFocus) (target ?? newLabel).focus();
    };
    const save = () => {
      const found = problem(input.value);
      if (found !== undefined) {
        showError(found);
        input.focus();
        return;
      }
      const name = input.value.trim();
      if (mode === "rename" && meta && target) {
        if (name !== current) {
          // Keep the tree's own state in step: the shown name, the menu names and later checks.
          build.names.set(meta.node, name);
          const text = target.querySelector<HTMLElement>(".tname");
          if (text) {
            text.textContent = name;
            text.title = name;
          }
          const anchor = build.menus.get(target)?.anchor;
          anchor
            ?.querySelector(".tmore")
            ?.setAttribute("aria-label", `Actions for ${name}`);
          anchor
            ?.querySelector(".tmenu")
            ?.setAttribute("aria-label", `Actions for ${name}`);
          actions.onAction({
            action: "rename",
            id: idOf(meta.node),
            label: current,
            name,
          });
        }
      } else {
        actions.onAction({
          action: "create",
          id: meta ? idOf(meta.node) : null,
          label: meta ? labelOf(build, meta.node) : "",
          name,
        });
      }
      close(true);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    input.addEventListener("input", () => {
      if (message) showError(undefined);
    });
    // Leaving the field (Tab away, a click elsewhere, the window losing focus) cancels only an
    // empty or unchanged field. A typed name stays open, marked invalid when it is refused, and
    // only Escape or Enter ends it, so a typed name is never lost to a stray click.
    edit.addEventListener("focusout", (e) => {
      const to = e.relatedTarget;
      if (to instanceof Node && edit.contains(to)) return;
      const typed = input.value.trim();
      if (typed === "" || typed === current) close(false);
      else {
        const found = problem(input.value);
        if (found !== undefined && !message) showError(found);
      }
    });
    openField = input;
    newLabel.disabled = true;
    if (mode === "rename" && target) {
      const trow = target.closest(".trow");
      target.hidden = true;
      trow?.insertBefore(edit, target.nextSibling);
      trow?.classList.add("is-editing");
    } else {
      const wrap = doc.createElement("div");
      wrap.className = "trow is-editing";
      wrap.append(edit);
      row?.append(wrap);
    }
    if (options.focus !== false) {
      input.focus();
      input.select();
    }
    if (options.value !== undefined) showError(problem(options.value));
  };

  const forced = actions.forced;
  if (forced) {
    const btn = [...tree.querySelectorAll<HTMLButtonElement>(".tnode")].find(
      (b) => {
        const meta = build.meta.get(b);
        return meta !== undefined && idOf(meta.node) === forced.id;
      },
    );
    if (btn) {
      if (forced.state === "renaming" || forced.state === "error")
        startEdit("rename", btn, { value: forced.value, focus: false });
      else if (forced.state === "menu") {
        // Held open through the popover itself, so the first click on "..." closes it. Focus
        // stays where it was; the menu closes on the first click outside it, as any menu does.
        const prev = doc.activeElement;
        build.menus.get(btn)?.open();
        const now = doc.activeElement;
        if (now && now !== prev) (now as HTMLElement).blur();
      } else btn.classList.add(`is-${forced.state}`);
    }
  }
  return box;
}
