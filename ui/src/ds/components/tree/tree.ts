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
  /**
   * Names the node in a TreeActionEvent. Ids must be unique in the tree. Without one the tree
   * uses the path from the top as JSON, each step a label and its index among its siblings
   * ([["Work",0],["Notes",1]]), so equal labels stay apart and a "/" in a label is safe. Give a
   * real id (the database id) when the screen needs ids that survive a reorder.
   */
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
  /**
   * The screen does the work. For "rename" and "create" it may refuse at once: return a non-empty
   * message and the tree keeps the field open with the message and the typed name. Return nothing
   * when the work is done. A handler that throws shows "Could not save. Try again." at the field.
   * The tree only reports: after a save it does not change the shown name, the menu names, the
   * ids or any other state. The screen does the work and re-renders the tree from its own data,
   * on success and on failure alike. A handler may be async: the tree does not wait for it, and a
   * value it resolves to is ignored, so refuse synchronously. If the promise rejects, the tree
   * shows "Could not save. Try again." as a note under the node.
   */
  readonly onAction: (
    event: TreeActionEvent,
  ) => void | string | Promise<unknown>;
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
let counter = 0;

interface Meta {
  readonly node: TreeNode;
  readonly siblings: readonly TreeNode[];
  /** The node's id as reported, fixed when the tree is drawn. */
  readonly id: string;
  readonly path: readonly (readonly [string, number])[];
  readonly parent: Meta | null;
}

type Run = (action: TreeAction, node: TreeNode, btn: HTMLButtonElement) => void;

interface Build {
  readonly meta: WeakMap<HTMLElement, Meta>;
  readonly menus: WeakMap<HTMLElement, Popover>;
  /** Every node menu, so opening one can close the rest. */
  readonly all: Popover[];
  readonly actions?: TreeActionsOptions;
  readonly run: Run;
}

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
    held:
      build.actions?.forced?.state === "menu" &&
      build.actions.forced.id === build.meta.get(btn)?.id,
  });
  // Escape closes the menu (the popover does that); focus goes back to the node, not the "..." button.
  pop.anchor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") btn.focus();
  });
  build.menus.set(btn, pop);
  build.all.push(pop);
  return pop.anchor;
}

function buildNodes(
  doc: Document,
  nodes: readonly TreeNode[],
  build: Build,
  parent: Meta | null = null,
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
    const step: readonly [string, number] = [node.label, nodes.indexOf(node)];
    const path = [...(parent?.path ?? []), step];
    const meta: Meta = {
      node,
      siblings: nodes,
      id: node.id ?? JSON.stringify(path),
      path,
      parent,
    };
    build.meta.set(btn, meta);
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
      const sub = buildNodes(doc, node.children ?? [], build, meta);
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
  options?: {
    value?: string;
    focus?: boolean;
    /** A message to show at the field at once (a refusal by the screen). */
    error?: string;
    /** The catalog's held example: leaving the field does not close it. */
    held?: boolean;
  },
) => void;

/** Without actions: the plain list, as before. */
export function createTree(
  doc: Document,
  label: string,
  nodes: readonly TreeNode[],
  onSelect?: (label: string) => void,
): HTMLUListElement;
/** With actions: a box that holds the list, the empty state and the New label button. */
export function createTree(
  doc: Document,
  label: string,
  nodes: readonly TreeNode[],
  onSelect: ((label: string) => void) | undefined,
  actions: TreeActionsOptions,
): HTMLElement;
export function createTree(
  doc: Document,
  label: string,
  nodes: readonly TreeNode[],
  onSelect?: (label: string) => void,
  actions?: TreeActionsOptions,
): HTMLElement {
  // The actions need the finished tree (to find a row), so `run` reads `startEdit` when called.
  let startEdit: Edit = () => {};
  // Closes the open name field, if there is one.
  let cancelField: ((returnFocus: boolean) => void) | null = null;
  /** Calls the screen. Returns a refusal message, or nothing. A throw is a failed save. */
  const report = (
    event: TreeActionEvent,
    near: HTMLElement | null,
  ): string | undefined => {
    try {
      const outcome = actions?.onAction(event);
      // A promise is not waited for. A rejection shows as a note and is never left unhandled; a
      // value it resolves to is ignored.
      if (
        typeof outcome === "object" &&
        outcome !== null &&
        typeof (outcome as PromiseLike<unknown>).then === "function"
      )
        (outcome as PromiseLike<unknown>).then(undefined, () =>
          note(near, "Could not save. Try again."),
        );
      return typeof outcome === "string" && outcome !== ""
        ? outcome
        : undefined;
    } catch {
      return "Could not save. Try again.";
    }
  };
  let noteLine: HTMLElement | null = null;
  /** A refusal with no field (Move, Delete, a failed async save) shows as a line under the node. */
  const note = (btn: HTMLElement | null, text: string) => {
    noteLine?.remove();
    const line = doc.createElement("span");
    line.className = "err-text tnote";
    line.setAttribute("role", "alert");
    line.append(createIcon(CircleAlert), doc.createTextNode(text));
    (btn?.closest(".trow") ?? tree).after(line);
    noteLine = line;
    // After this click or key has finished, the next one clears it.
    setTimeout(() => {
      const drop = () => line.remove();
      tree.addEventListener("click", drop, { once: true });
      tree.addEventListener("keydown", drop, { once: true });
    }, 0);
  };
  const build: Build = {
    meta: new WeakMap(),
    menus: new WeakMap(),
    all: [],
    actions,
    run: (action, node, btn) => {
      // A name field that is still open (kept after focus left) is cancelled first.
      cancelField?.(false);
      if (action === "rename" || action === "create") startEdit(action, btn);
      else {
        const failure = report(
          {
            action,
            id: build.meta.get(btn)?.id ?? node.label,
            label: node.label,
          },
          btn,
        );
        if (failure !== undefined) note(btn, failure);
      }
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
  // One node menu at a time: opening one closes the others.
  const openMenu = (btn: HTMLElement) => {
    const pop = build.menus.get(btn);
    // Not twice for one key press (the ContextMenu key and Shift+F10 fire a contextmenu event as
    // well as a keydown). An open name field is cancelled first, as for any other action.
    if (!pop || pop.isOpen()) return;
    cancelField?.(false);
    for (const other of build.all) if (other !== pop) other.close(false);
    pop.open();
  };
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
    // Escape anywhere in the tree cancels a name field that is still open.
    if (e.key === "Escape" && cancelField) {
      e.preventDefault();
      cancelField(true);
      return;
    }
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
        openMenu(btn);
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
    if (!btn || !build.menus.has(btn)) return;
    e.preventDefault();
    openMenu(btn);
  });

  /** The field of an inline rename or create. Enter saves; Escape or leaving the field cancels. */
  startEdit = (mode, target, options = {}) => {
    // One field at a time: a new request cancels the one that is open. A note goes away too.
    cancelField?.(false);
    noteLine?.remove();
    const meta = target ? build.meta.get(target) : undefined;
    if (mode === "rename" && (!target || !meta)) return;
    const current = mode === "rename" && meta ? meta.node.label : "";
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
    let wasClosed = false; // the parent was collapsed before this create opened it
    if (mode === "create") {
      const parentLi = target?.closest("li") ?? null;
      list = parentLi && target ? subOf(target) : tree;
      if (!list && parentLi) {
        list = doc.createElement("ul");
        parentLi.append(list);
        createdList = true;
      }
      if (!list) return;
      if (target?.getAttribute("aria-expanded") === "false") {
        wasClosed = true;
        setOpen(target, true);
      }
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
      const taken = siblings.filter((s) => s !== meta?.node);
      if (taken.some((s) => nameKey(s.label) === nameKey(name)))
        return `A label named "${name}" already exists here.`;
      return actions.validateName?.(name, mode);
    };
    let closed = false;
    const close = (returnFocus: boolean, saved = false) => {
      if (closed) return;
      closed = true;
      // Nothing was saved: put the parent back as it was.
      if (wasClosed && !saved && target) setOpen(target, false);
      cancelField = null;
      edit.remove();
      if (mode === "rename" && target) {
        target.hidden = false;
        target.closest(".trow")?.classList.remove("is-editing");
      } else {
        row?.remove();
        if (createdList) list?.remove();
      }
      sync();
      // On an empty tree the New label button is hidden, so focus goes to the empty state's.
      if (returnFocus)
        (
          target ?? (newLabel.hidden ? empty.querySelector("button") : newLabel)
        )?.focus();
    };
    const save = () => {
      const name = input.value.trim();
      // The node's own name, unchanged: nothing to save, nothing to check.
      if (mode === "rename" && name === current) {
        close(true);
        return;
      }
      const found = problem(input.value);
      if (found !== undefined) {
        showError(found);
        input.focus();
        return;
      }
      const failure = report(
        mode === "rename" && meta
          ? { action: "rename", id: meta.id, label: current, name }
          : {
              action: "create",
              id: meta ? meta.id : null,
              label: meta ? meta.node.label : "",
              name,
            },
        target,
      );
      // The screen refused: the field stays open with the message.
      if (failure !== undefined) {
        showError(failure);
        input.focus();
        return;
      }
      close(true, true);
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
      if (options.held || (to instanceof Node && edit.contains(to))) return;
      const typed = input.value.trim();
      if (typed === "" || typed === current) close(false);
      else {
        const found = problem(input.value);
        if (found !== undefined && !message) showError(found);
      }
    });
    cancelField = close;
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
    if (options.error !== undefined) showError(options.error);
    else if (options.value !== undefined) showError(problem(options.value));
  };

  const forced = actions.forced;
  if (forced) {
    const btn = [...tree.querySelectorAll<HTMLButtonElement>(".tnode")].find(
      (b) => {
        const meta = build.meta.get(b);
        return meta !== undefined && meta.id === forced.id;
      },
    );
    if (btn) {
      if (forced.state === "renaming" || forced.state === "error")
        startEdit("rename", btn, {
          value: forced.value,
          focus: false,
          held: true,
        });
      else if (forced.state === "menu") {
        // The popover was built held for this node (see menuFor): open through it, so a click on
        // "..." or Escape closes it, and no outside click or focus move does.
        build.menus.get(btn)?.open();
      } else btn.classList.add(`is-${forced.state}`);
    }
  }
  return box;
}
