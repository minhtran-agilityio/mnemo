// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
import {
  createTree,
  type TreeActionEvent,
  type TreeActionsOptions,
  type TreeNode,
} from "./tree";

const nodes: TreeNode[] = [
  {
    label: "Work",
    kind: "folder",
    count: 212,
    expanded: true,
    children: [
      { label: "Mnemo", kind: "folder", count: 84, current: true },
      {
        label: "Clients",
        kind: "folder",
        children: [{ label: "Agility", kind: "folder" }],
      },
    ],
  },
  { label: "<b>tiếng việt</b>", kind: "label", count: 57 },
];
const make = () => {
  const t = createTree(document, "Folders", nodes);
  document.body.append(t);
  return t;
};
const node = (t: HTMLElement, name: string) =>
  [...t.querySelectorAll<HTMLButtonElement>(".tnode")].find(
    (b) => b.querySelector(".tname")?.textContent === name,
  ) as HTMLButtonElement;

test("it renders labelled nodes as text with counts, expanded state and the current node", () => {
  const t = make();
  expect(t.getAttribute("aria-label")).toBe("Folders");
  expect(node(t, "Work").getAttribute("aria-expanded")).toBe("true");
  expect(node(t, "Clients").getAttribute("aria-expanded")).toBe("false");
  expect(node(t, "Clients").nextElementSibling?.hasAttribute("hidden")).toBe(
    true,
  );
  expect(node(t, "Mnemo").getAttribute("aria-current")).toBe("true");
  expect(node(t, "Work").querySelector(".cnt")?.textContent).toBe("212");
  expect(t.querySelector("b")).toBeNull();
  t.remove();
});

test("a click on a parent toggles its group and makes it current", () => {
  const t = make();
  const clients = node(t, "Clients");
  clients.click();
  expect(clients.getAttribute("aria-expanded")).toBe("true");
  expect(clients.nextElementSibling?.hasAttribute("hidden")).toBe(false);
  expect(clients.getAttribute("aria-current")).toBe("true");
  expect(node(t, "Mnemo").hasAttribute("aria-current")).toBe(false);
  clients.click();
  expect(clients.getAttribute("aria-expanded")).toBe("false");
  t.remove();
});

test("arrow keys move between visible nodes and open or close a group", () => {
  const t = make();
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  const clients = node(t, "Clients");
  clients.focus();
  key(clients, "ArrowDown");
  expect(document.activeElement).toBe(node(t, "<b>tiếng việt</b>"));
  key(clients, "ArrowRight");
  expect(clients.getAttribute("aria-expanded")).toBe("true");
  key(clients, "ArrowLeft");
  expect(clients.getAttribute("aria-expanded")).toBe("false");
  key(clients, "ArrowUp");
  expect(document.activeElement).toBe(node(t, "Mnemo"));
  t.remove();
});

// The Limits tab fix (issue 113): a long folder name is cut with an ellipsis and keeps room for stacked marks.
test("a long folder name is whole text in .tname, which has room for stacked marks and shrinks", () => {
  const label = `${"ẪẬẲỖỮỰ".repeat(10)}/${"w".repeat(100)}`;
  const t = createTree(document, "Folders", [
    { label, kind: "folder", count: 3 },
  ]);
  const el = t.querySelector(".tname") as HTMLElement;
  expect(el.textContent).toBe(label);
  expect(el.title).toBe(label);
  const rule = cssRule(import.meta.dirname, "tree.css", ".tnode .tname");
  expect(rule).toMatchObject(MARKS_ROOM);
  expect(rule["min-width"]).toBe("0");
  expect(rule["text-overflow"]).toBe("ellipsis");
});

// Label tree actions (issue 126).
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }),
  );
const actionNodes: TreeNode[] = [
  {
    label: "Work",
    kind: "label",
    expanded: true,
    children: [
      { label: "Mnemo", kind: "label" },
      {
        label: "Design notes",
        kind: "label",
        refused: {
          delete: "This label still holds notes that have no other label",
        },
      },
    ],
  },
];
const withActions = (
  list: TreeNode[] = actionNodes,
  extra: Partial<TreeActionsOptions> = {},
) => {
  const events: TreeActionEvent[] = [];
  const t = createTree(document, "Labels", list, undefined, {
    onAction: (e) => events.push(e),
    ...extra,
  });
  document.body.append(t);
  return { t, events };
};
const field = (t: HTMLElement) => {
  const input = t.querySelector<HTMLInputElement>(".tedit input");
  if (!input) throw new Error("no field");
  return input;
};
const typeIn = (t: HTMLElement, text: string) => {
  const input = field(t);
  input.value = text;
  return input;
};
const menuItem = (t: HTMLElement, owner: string, text: string) =>
  [
    ...(node(t, owner)
      .closest("li")
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ].find((i) => i.textContent?.startsWith(text)) as HTMLElement;

test("a tree without actions is still the plain list", () => {
  const t = make();
  expect(t.tagName).toBe("UL");
  expect(t.querySelector(".tmore")).toBeNull();
  t.remove();
});

test("each node has a menu button with a name, and New label inside, Rename, Move and Delete", () => {
  const { t } = withActions();
  const more = t.querySelectorAll<HTMLButtonElement>(".tmore");
  expect(more).toHaveLength(3);
  expect(more[1].getAttribute("aria-label")).toBe("Actions for Mnemo");
  expect(menuItem(t, "Mnemo", "New label inside")).toBeDefined();
  expect(menuItem(t, "Mnemo", "Rename").textContent).toContain("F2");
  expect(menuItem(t, "Mnemo", "Move to")).toBeDefined();
  expect(menuItem(t, "Mnemo", "Delete").textContent).toContain("Del");
  t.remove();
});

test("Move and Delete report the node and the action", () => {
  const { t, events } = withActions();
  key(node(t, "Mnemo"), "Delete");
  menuItem(t, "Mnemo", "Move to").click();
  expect(events).toEqual([
    { action: "delete", id: "Mnemo", label: "Mnemo" },
    { action: "move", id: "Mnemo", label: "Mnemo" },
  ]);
  t.remove();
});

test("a refused action stays in the menu, disabled, with its reason", () => {
  const { t, events } = withActions();
  const item = menuItem(t, "Design notes", "Delete");
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(item.textContent).toContain("still holds notes");
  expect(item.getAttribute("aria-describedby")).toBe(
    item.querySelector(".tmenu-why")?.id,
  );
  item.click();
  key(node(t, "Design notes"), "Delete");
  expect(events).toEqual([]);
  // The key opens the menu so the reason is read.
  const panel = node(t, "Design notes")
    .closest(".trow")
    ?.querySelector<HTMLElement>(".tmenu");
  expect(panel?.hidden).toBe(false);
  t.remove();
});

test("F2 renames in place: Enter saves and reports, the name stays text", () => {
  const { t, events } = withActions();
  const mnemo = node(t, "Mnemo");
  key(mnemo, "F2");
  expect(mnemo.hidden).toBe(true);
  expect(document.activeElement).toBe(field(t));
  key(typeIn(t, "<b>Mnemo 2</b>"), "Enter");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(mnemo.hidden).toBe(false);
  expect(mnemo.querySelector(".tname")?.textContent).toBe("<b>Mnemo 2</b>");
  expect(t.querySelector(".tree b")).toBeNull();
  expect(events).toEqual([
    { action: "rename", id: "Mnemo", label: "Mnemo", name: "<b>Mnemo 2</b>" },
  ]);
  expect(document.activeElement).toBe(mnemo);
  t.remove();
});

test("Escape cancels a rename and reports nothing", () => {
  const { t, events } = withActions();
  const mnemo = node(t, "Mnemo");
  key(mnemo, "F2");
  key(typeIn(t, "Other"), "Escape");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(mnemo.querySelector(".tname")?.textContent).toBe("Mnemo");
  expect(events).toEqual([]);
  expect(document.activeElement).toBe(mnemo);
  t.remove();
});

test("an empty or duplicate name is refused at the field and the field stays", () => {
  const { t, events } = withActions();
  key(node(t, "Mnemo"), "F2");
  const input = typeIn(t, "  ");
  key(input, "Enter");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const err = t.querySelector(".tedit .err-text");
  expect(err?.textContent).toContain("Type a name");
  expect(input.getAttribute("aria-describedby")).toBe(err?.id);
  typeIn(t, "design NOTES");
  key(input, "Enter");
  expect(t.querySelector(".tedit .err-text")?.textContent).toContain(
    "already exists",
  );
  expect(events).toEqual([]);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(t.querySelector(".err-text")).toBeNull();
  t.remove();
});

test("the screen can add its own rule for a name", () => {
  const { t } = withActions(actionNodes, {
    validateName: (name) =>
      name === "Inbox" ? "Inbox is reserved." : undefined,
  });
  key(node(t, "Mnemo"), "F2");
  key(typeIn(t, "Inbox"), "Enter");
  expect(t.querySelector(".err-text")?.textContent).toContain("reserved");
  t.remove();
});

test("New label creates at the top level, and inside a node from its menu", () => {
  const { t, events } = withActions();
  t.querySelector<HTMLButtonElement>(".tree-new")?.click();
  key(typeIn(t, "Personal"), "Enter");
  menuItem(t, "Mnemo", "New label inside").click();
  expect(node(t, "Mnemo").closest("li")?.querySelector("ul .tedit")).not.toBe(
    null,
  );
  key(typeIn(t, "Sức khoẻ"), "Enter");
  expect(events).toEqual([
    { action: "create", id: null, label: "", name: "Personal" },
    { action: "create", id: "Mnemo", label: "Mnemo", name: "Sức khoẻ" },
  ]);
  expect(t.querySelector(".tedit")).toBeNull();
  t.remove();
});

test("no labels yet shows what to do next, and its button starts a create", () => {
  const { t, events } = withActions([]);
  const box = t.querySelector<HTMLElement>(".state-box");
  expect(box?.textContent).toContain("No labels yet");
  expect(t.querySelector<HTMLElement>(".tree-new")?.hidden).toBe(true);
  box?.querySelector("button")?.click();
  key(typeIn(t, "Work"), "Enter");
  expect(events[0]).toMatchObject({ action: "create", name: "Work" });
  t.remove();
});

test("Shift+F10 and the context menu key open the node menu; Escape closes it back to the node", () => {
  const { t } = withActions();
  const mnemo = node(t, "Mnemo");
  const panel = mnemo.closest(".trow")?.querySelector(".tmenu") as HTMLElement;
  key(mnemo, "F10", { shiftKey: true });
  expect(panel.hidden).toBe(false);
  key(panel, "Escape");
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(mnemo);
  key(mnemo, "ContextMenu");
  expect(panel.hidden).toBe(false);
  t.remove();
});

test("forced states show renaming, the error, the open menu and a held hover", () => {
  const rename = withActions(actionNodes, {
    forced: { id: "Mnemo", state: "renaming" },
  });
  expect(rename.t.querySelector(".tedit input")).not.toBeNull();
  rename.t.remove();
  const err = withActions(actionNodes, {
    forced: { id: "Mnemo", state: "error", value: "Design notes" },
  });
  expect(err.t.querySelector(".tedit .err-text")).not.toBeNull();
  err.t.remove();
  const menu = withActions(actionNodes, {
    forced: { id: "Mnemo", state: "menu" },
  });
  expect(menu.t.querySelectorAll(".tmenu:not([hidden])")).toHaveLength(1);
  menu.t.remove();
  const hover = withActions(actionNodes, {
    forced: { id: "Mnemo", state: "hover" },
  });
  expect(node(hover.t, "Mnemo").classList.contains("is-hover")).toBe(true);
  hover.t.remove();
});

test("a 60 character Vietnamese name keeps its full text in the node and the field", () => {
  const long = "Ghi chú dài về kiến trúc lưu trữ cục bộ và đồng bộ ngoại tuyến";
  const { t } = withActions([{ label: long, kind: "label" }]);
  expect(node(t, long).querySelector<HTMLElement>(".tname")?.title).toBe(long);
  key(node(t, long), "F2");
  expect(field(t).value).toBe(long);
  t.remove();
});
