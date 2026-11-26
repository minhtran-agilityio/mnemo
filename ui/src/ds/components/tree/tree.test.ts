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
    onAction: (e) => {
      events.push(e);
    },
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
    { action: "delete", id: '[["Work",0],["Mnemo",0]]', label: "Mnemo" },
    { action: "move", id: '[["Work",0],["Mnemo",0]]', label: "Mnemo" },
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

test("F2 renames in place: Enter closes the field and only reports; the name stays as given", () => {
  const { t, events } = withActions();
  const mnemo = node(t, "Mnemo");
  key(mnemo, "F2");
  expect(mnemo.hidden).toBe(true);
  expect(document.activeElement).toBe(field(t));
  key(typeIn(t, "<b>Mnemo 2</b>"), "Enter");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(mnemo.hidden).toBe(false);
  // The tree does not rename: the screen re-renders from its own data.
  expect(mnemo.querySelector(".tname")?.textContent).toBe("Mnemo");
  expect(
    mnemo.closest(".trow")?.querySelector(".tmore")?.getAttribute("aria-label"),
  ).toBe("Actions for Mnemo");
  expect(events).toEqual([
    {
      action: "rename",
      id: '[["Work",0],["Mnemo",0]]',
      label: "Mnemo",
      name: "<b>Mnemo 2</b>",
    },
  ]);
  expect(document.activeElement).toBe(mnemo);
  t.remove();
});

test("leaving the field keeps a typed name open and cancels only an empty or unchanged one", () => {
  const { t, events } = withActions();
  const out = (el: Element) =>
    el.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Design notes");
  out(field(t));
  expect(t.querySelector(".tedit")).not.toBeNull();
  expect(field(t).getAttribute("aria-invalid")).toBe("true");
  typeIn(t, "Mnemo 3");
  out(field(t));
  expect(t.querySelector(".tedit")).not.toBeNull();
  expect(events).toEqual([]);
  typeIn(t, "Mnemo");
  out(field(t));
  expect(t.querySelector(".tedit")).toBeNull();
  t.querySelector<HTMLButtonElement>(".tree-new")?.click();
  out(field(t));
  expect(t.querySelector(".tedit")).toBeNull();
  t.remove();
});

test("another action cancels a kept field and then runs; New label does too", () => {
  const { t, events } = withActions();
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  field(t).dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  expect(t.querySelector(".tedit")).not.toBeNull(); // kept: a changed name
  key(node(t, "Work"), "Delete");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(events).toEqual([
    { action: "delete", id: '[["Work",0]]', label: "Work" },
  ]);
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  menuItem(t, "Work", "Move to").click();
  expect(t.querySelector(".tedit")).toBeNull();
  expect(events.at(-1)).toMatchObject({ action: "move" });
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  menuItem(t, "Design notes", "New label inside").click();
  expect(t.querySelectorAll(".tedit")).toHaveLength(1);
  expect(
    node(t, "Design notes").closest("li")?.querySelector("ul .tedit"),
  ).not.toBeNull();
  key(field(t), "Escape");
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  t.querySelector<HTMLButtonElement>(".tree-new")?.click();
  expect(t.querySelectorAll(".tedit")).toHaveLength(1);
  expect(node(t, "Mnemo").hidden).toBe(false);
  t.remove();
});

test("Escape in the tree cancels a kept field", () => {
  const { t, events } = withActions();
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  field(t).dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  key(node(t, "Work"), "Escape");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(node(t, "Mnemo").hidden).toBe(false);
  expect(events).toEqual([]);
  t.remove();
});

test("one key press opens a node menu once, and with a field open the field is cancelled and one menu opens", () => {
  const { t } = withActions();
  const mnemo = node(t, "Mnemo");
  const panel = mnemo.closest(".trow")?.querySelector(".tmenu") as HTMLElement;
  key(mnemo, "ContextMenu");
  mnemo.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  expect(panel.hidden).toBe(false);
  key(panel, "Escape");
  key(node(t, "Design notes"), "F2");
  typeIn(t, "Design notes 2");
  key(mnemo, "ContextMenu");
  mnemo.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  expect(t.querySelector(".tedit")).toBeNull();
  expect(
    [...t.querySelectorAll<HTMLElement>(".tmenu")].filter((m) => !m.hidden),
  ).toHaveLength(1);
  t.remove();
});

test("error messages have unique ids", () => {
  const a = withActions(actionNodes, {
    forced: {
      id: '[["Work",0],["Mnemo",0]]',
      state: "error",
      value: "Design notes",
    },
  });
  const b = withActions(actionNodes, {
    forced: {
      id: '[["Work",0],["Mnemo",0]]',
      state: "error",
      value: "Design notes",
    },
  });
  expect(a.t.querySelector(".err-text")?.id).not.toBe(
    b.t.querySelector(".err-text")?.id,
  );
  a.t.remove();
  b.t.remove();
});

test("the held-open menu is the popover's own: a click on its button closes it", async () => {
  const { t } = withActions(actionNodes, {
    forced: { id: '[["Work",0],["Mnemo",0]]', state: "menu" },
  });
  await new Promise((r) => setTimeout(r, 0));
  const trigger = node(t, "Mnemo")
    .closest(".trow")
    ?.querySelector<HTMLButtonElement>(".tmore");
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  trigger?.click();
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  t.remove();
});

test("without actions createTree is typed as the plain list; with actions as the box", () => {
  const plain: HTMLUListElement = createTree(document, "x", []);
  expect(plain.tagName).toBe("UL");
  const box: HTMLElement = createTree(document, "x", [], undefined, {
    onAction: () => {},
  });
  expect(box.classList.contains("tree-box")).toBe(true);
});

test("on an empty tree focus returns to the empty state button after Escape and after a save", () => {
  const { t } = withActions([]);
  const emptyButton = t.querySelector<HTMLButtonElement>(".state-box button");
  emptyButton?.click();
  key(field(t), "Escape");
  expect(document.activeElement).toBe(emptyButton);
  emptyButton?.click();
  key(typeIn(t, "Work"), "Enter");
  expect(document.activeElement).toBe(emptyButton);
  t.remove();
});

test("a held renaming example stays open when focus leaves", () => {
  const { t } = withActions(actionNodes, {
    forced: { id: '[["Work",0],["Mnemo",0]]', state: "renaming" },
  });
  field(t).dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  expect(t.querySelector(".tedit")).not.toBeNull();
  t.remove();
});

test("the screen can refuse a rename at once: the name is kept out and the message shows", () => {
  const { t } = withActions(actionNodes, {
    onAction: () => "Could not save: the file is locked.",
  });
  const mnemo = node(t, "Mnemo");
  key(mnemo, "F2");
  key(typeIn(t, "Mnemo 2"), "Enter");
  expect(t.querySelector(".tedit .err-text")?.textContent).toContain(
    "file is locked",
  );
  expect(mnemo.querySelector(".tname")?.textContent).toBe("Mnemo");
  expect(field(t).value).toBe("Mnemo 2");
  t.remove();
});

test("a handler that throws shows a plain line and keeps the field open", () => {
  const { t } = withActions(actionNodes, {
    onAction: () => {
      throw new Error("boom");
    },
  });
  const mnemo = node(t, "Mnemo");
  key(mnemo, "F2");
  key(typeIn(t, "Mnemo 2"), "Enter");
  expect(t.querySelector(".tedit .err-text")?.textContent).toContain(
    "Could not save. Try again.",
  );
  expect(field(t).value).toBe("Mnemo 2");
  expect(mnemo.querySelector(".tname")?.textContent).toBe("Mnemo");
  t.remove();
});

test("the follow-up contextmenu from a menu item or the ... button is ours, not the browser's; a field keeps the native menu", () => {
  const { t } = withActions();
  const mnemo = node(t, "Mnemo");
  key(mnemo, "ContextMenu");
  const item = menuItem(t, "Mnemo", "Rename");
  const fire = (el: Element) => {
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  expect(fire(item)).toBe(true);
  expect(
    mnemo.closest(".trow")?.querySelector<HTMLElement>(".tmenu")?.hidden,
  ).toBe(false);
  expect(fire(mnemo.closest(".trow")?.querySelector(".tmore") as Element)).toBe(
    true,
  );
  key(node(t, "Design notes"), "F2");
  expect(fire(field(t))).toBe(false);
  t.remove();
});

test("an empty string from the handler counts as success", () => {
  const { t } = withActions(actionNodes, { onAction: () => "" });
  key(node(t, "Mnemo"), "F2");
  key(typeIn(t, "Mnemo 2"), "Enter");
  expect(t.querySelector(".tedit")).toBeNull();
  t.remove();
});

test("a create inside a collapsed folder opens it, and Escape puts it back", () => {
  const { t, events } = withActions([
    {
      label: "Work",
      kind: "label",
      expanded: false,
      children: [{ label: "Mnemo", kind: "label" }],
    },
  ]);
  const work = node(t, "Work");
  menuItem(t, "Work", "New label inside").click();
  expect(work.getAttribute("aria-expanded")).toBe("true");
  key(field(t), "Escape");
  expect(work.getAttribute("aria-expanded")).toBe("false");
  expect(work.closest("li")?.querySelector("ul")?.hidden).toBe(true);
  menuItem(t, "Work", "New label inside").click();
  key(typeIn(t, "Plans"), "Enter");
  expect(work.getAttribute("aria-expanded")).toBe("true");
  expect(events).toHaveLength(1);
  t.remove();
});

test("a label with a slash in its name does not clash with a nested path", () => {
  const { t, events } = withActions([
    {
      label: "A/B",
      kind: "label",
      children: [{ label: "C", kind: "label" }],
      expanded: true,
    },
    {
      label: "A",
      kind: "label",
      expanded: true,
      children: [{ label: "B/C", kind: "label" }],
    },
  ]);
  key(node(t, "C"), "Delete");
  key(node(t, "B/C"), "Delete");
  expect(events[0].id).not.toBe(events[1].id);
  t.remove();
});

test("opening a node menu closes the one that is open", () => {
  const { t } = withActions();
  const panels = [...t.querySelectorAll<HTMLElement>(".tmenu")];
  key(node(t, "Mnemo"), "F10", { shiftKey: true });
  node(t, "Design notes").dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  expect(panels.filter((p) => !p.hidden)).toHaveLength(1);
  key(node(t, "Work"), "ContextMenu");
  expect(panels.filter((p) => !p.hidden)).toHaveLength(1);
  t.remove();
});

test("a rename check compares nodes: another sibling with the same name is refused, the node's own name is not", () => {
  const { t, events } = withActions([
    { label: "Notes", kind: "label" },
    { label: "Notes", kind: "label" },
  ]);
  const both = [...t.querySelectorAll<HTMLButtonElement>(".tnode")];
  key(both[1], "F2");
  key(typeIn(t, "Notes"), "Enter"); // its own name, unchanged: no error, no event
  expect(t.querySelector(".tedit")).toBeNull();
  expect(events).toEqual([]);
  key(both[1], "F2");
  key(typeIn(t, "notes"), "Enter");
  expect(t.querySelector(".tedit .err-text")?.textContent).toContain(
    "already exists",
  );
  t.remove();
});

test("a refused action with a field open: the field is cancelled and the menu opens", () => {
  const { t } = withActions();
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  field(t).dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  const refused = node(t, "Design notes");
  key(refused, "Delete"); // refused for this node: it opens the menu, which says why
  expect(t.querySelector(".tedit")).toBeNull();
  const panel = refused.closest(".trow")?.querySelector<HTMLElement>(".tmenu");
  expect(panel?.hidden).toBe(false);
  key(panel as HTMLElement, "Escape");
  key(node(t, "Mnemo"), "F2");
  typeIn(t, "Mnemo 3");
  key(node(t, "Work"), "ContextMenu");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(
    node(t, "Work").closest(".trow")?.querySelector<HTMLElement>(".tmenu")
      ?.hidden,
  ).toBe(false);
  t.remove();
});

test("a rejected promise from the handler shows a note and leaves no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const catcher = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", catcher);
  const { t, events } = withActions(actionNodes, {
    onAction: () => Promise.reject(new Error("boom")),
  });
  key(node(t, "Mnemo"), "Delete");
  key(node(t, "Mnemo"), "F2");
  key(typeIn(t, "Mnemo 2"), "Enter");
  await new Promise((r) => setTimeout(r, 10));
  expect(events).toEqual([]);
  // One note only: the second replaced the first. The field closed as a success.
  expect(t.querySelectorAll(".tnote")).toHaveLength(1);
  expect(t.querySelector(".tnote")?.textContent).toContain("Try again");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(unhandled).toEqual([]);
  // A note goes away when a field opens.
  key(node(t, "Mnemo"), "F2");
  expect(t.querySelector(".tnote")).toBeNull();
  process.off("unhandledRejection", catcher);
  t.remove();
});

test("a resolved promise, even with a string, counts as success", async () => {
  const { t } = withActions(actionNodes, {
    onAction: () => Promise.resolve("Not now."),
  });
  key(node(t, "Mnemo"), "F2");
  key(typeIn(t, "Mnemo 2"), "Enter");
  await new Promise((r) => setTimeout(r, 10));
  expect(t.querySelector(".tedit")).toBeNull();
  expect(t.querySelector(".tnote")).toBeNull();
  t.remove();
});

test("two siblings with the same label get different default ids", () => {
  const { t, events } = withActions([
    { label: "Notes", kind: "label" },
    { label: "Notes", kind: "label" },
  ]);
  const both = [...t.querySelectorAll<HTMLButtonElement>(".tnode")];
  key(both[0], "Delete");
  key(both[1], "Delete");
  expect(events[0].id).not.toBe(events[1].id);
  t.remove();
});

test("a refusal or a throw from Move or Delete shows under the node", () => {
  const { t } = withActions(actionNodes, {
    onAction: () => {
      throw new Error("boom");
    },
  });
  key(node(t, "Mnemo"), "Delete");
  expect(t.querySelector(".tnote")?.textContent).toContain(
    "Could not save. Try again.",
  );
  t.remove();
  const refused = withActions(actionNodes, { onAction: () => "Not now." });
  key(node(refused.t, "Mnemo"), "Delete");
  expect(refused.t.querySelector(".tnote")?.textContent).toContain("Not now.");
  refused.t.remove();
});

test("two labels with the same name under different parents get different ids", () => {
  const { t, events } = withActions([
    {
      label: "A",
      kind: "label",
      expanded: true,
      children: [{ label: "Notes", kind: "label" }],
    },
    {
      label: "B",
      kind: "label",
      expanded: true,
      children: [{ label: "Notes", kind: "label" }],
    },
    { label: "C", kind: "label", id: "c-1" },
  ]);
  const notes = [...t.querySelectorAll<HTMLButtonElement>(".tnode")].filter(
    (b) => b.querySelector(".tname")?.textContent === "Notes",
  );
  key(notes[1], "Delete");
  key(node(t, "C"), "Delete");
  expect(events).toEqual([
    { action: "delete", id: '[["B",1],["Notes",0]]', label: "Notes" },
    { action: "delete", id: "c-1", label: "C" },
  ]);
  t.remove();
  const forced = withActions(
    [
      {
        label: "A",
        kind: "label",
        expanded: true,
        children: [{ label: "Notes", kind: "label" }],
      },
      {
        label: "B",
        kind: "label",
        expanded: true,
        children: [{ label: "Notes", kind: "label" }],
      },
    ],
    { forced: { id: '[["B",1],["Notes",0]]', state: "hover" } },
  );
  const hovered = [
    ...forced.t.querySelectorAll<HTMLElement>(".tnode.is-hover"),
  ];
  expect(hovered).toHaveLength(1);
  expect(
    hovered[0].closest("li")?.parentElement?.closest("li")?.textContent,
  ).toContain("B");
  forced.t.remove();
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
    {
      action: "create",
      id: '[["Work",0],["Mnemo",0]]',
      label: "Mnemo",
      name: "Sức khoẻ",
    },
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

test("forced states show renaming, the error, the open menu and a held hover", async () => {
  const rename = withActions(actionNodes, {
    forced: { id: '[["Work",0],["Mnemo",0]]', state: "renaming" },
  });
  expect(rename.t.querySelector(".tedit input")).not.toBeNull();
  rename.t.remove();
  const err = withActions(actionNodes, {
    forced: {
      id: '[["Work",0],["Mnemo",0]]',
      state: "error",
      value: "Design notes",
    },
  });
  expect(err.t.querySelector(".tedit .err-text")).not.toBeNull();
  err.t.remove();
  const menu = withActions(actionNodes, {
    forced: { id: '[["Work",0],["Mnemo",0]]', state: "menu" },
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(menu.t.querySelectorAll(".tmenu:not([hidden])")).toHaveLength(1);
  menu.t.remove();
  const hover = withActions(actionNodes, {
    forced: { id: '[["Work",0],["Mnemo",0]]', state: "hover" },
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

// Flat folder mode (issue 192): folder words, Rename and Delete only.
const UNSORTED_WHY = "Unsorted is fixed. It holds what has no folder.";
const folders: TreeNode[] = [
  { label: "AI and agents", kind: "folder", count: 12, id: "f1" },
  { label: "Dev tools", kind: "folder", count: 8, id: "f2" },
  { label: "Design", kind: "folder", count: 3, id: "f3" },
  { label: "Reading", kind: "folder", count: 5, id: "f4" },
  {
    label: "Unsorted",
    kind: "folder",
    count: 2,
    id: "unsorted",
    refused: { rename: UNSORTED_WHY, delete: UNSORTED_WHY },
  },
];
const flatFolders = (
  list: TreeNode[] = folders,
  extra: Partial<TreeActionsOptions> = {},
) => withActions(list, { noun: "folder", flat: true, ...extra });
const menuTexts = (t: HTMLElement, owner: string) =>
  [
    ...(node(t, owner)
      .closest("li")
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ].map((i) => i.firstChild?.textContent ?? "");

test("flat folders: each row shows its count, in the order given, with Unsorted last", () => {
  const { t } = flatFolders();
  const rows = [...t.querySelectorAll<HTMLButtonElement>(".tnode")];
  expect(rows.map((r) => r.querySelector(".tname")?.textContent)).toEqual([
    "AI and agents",
    "Dev tools",
    "Design",
    "Reading",
    "Unsorted",
  ]);
  expect(rows.map((r) => r.querySelector(".cnt")?.textContent)).toEqual([
    "12",
    "8",
    "3",
    "5",
    "2",
  ]);
  expect(t.classList.contains("is-flat")).toBe(true);
  t.remove();
});

test("flat folders: the menu has Rename and Delete only, named for the row", () => {
  const { t } = flatFolders();
  const items = menuTexts(t, "Design");
  expect(items).toHaveLength(2);
  expect(items[0]).toContain("Rename");
  expect(items[1]).toContain("Delete");
  expect(menuItem(t, "Design", "New")).toBeUndefined();
  expect(menuItem(t, "Design", "Move")).toBeUndefined();
  expect(
    node(t, "Design")
      .closest(".trow")
      ?.querySelector(".tmore")
      ?.getAttribute("aria-label"),
  ).toBe("Actions for Design");
  t.remove();
});

test("flat folders: the button, the field and the empty state say folder", () => {
  const { t, events } = flatFolders();
  const add = t.querySelector<HTMLButtonElement>(".tree-new");
  expect(add?.textContent).toBe("New folder");
  add?.click();
  expect(field(t).getAttribute("aria-label")).toBe("New folder name");
  key(typeIn(t, "Recipes"), "Enter");
  expect(events).toEqual([
    { action: "create", id: null, label: "", name: "Recipes" },
  ]);
  t.remove();
  const empty = flatFolders([]);
  const box = empty.t.querySelector<HTMLElement>(".state-box");
  expect(box?.textContent).toContain("No folders yet");
  expect(box?.textContent).not.toContain("nest");
  expect(box?.querySelector("button")?.textContent).toBe("New folder");
  empty.t.remove();
});

test("flat folders: Unsorted refuses Rename and Delete with its reason, by menu and by key", () => {
  const { t, events } = flatFolders();
  for (const text of ["Rename", "Delete"]) {
    const item = menuItem(t, "Unsorted", text);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.querySelector(".tmenu-why")?.textContent).toBe(UNSORTED_WHY);
    expect(item.getAttribute("aria-describedby")).toBe(
      item.querySelector(".tmenu-why")?.id,
    );
    item.click();
  }
  const unsorted = node(t, "Unsorted");
  key(unsorted, "F2");
  key(unsorted, "Delete");
  expect(t.querySelector(".tedit")).toBeNull();
  expect(events).toEqual([]);
  expect(
    unsorted.closest(".trow")?.querySelector<HTMLElement>(".tmenu")?.hidden,
  ).toBe(false);
  t.remove();
});

test("flat folders: F2 and Delete work on a folder; arrows move between rows", () => {
  const { t, events } = flatFolders();
  const design = node(t, "Design");
  design.focus();
  key(design, "ArrowDown");
  expect(document.activeElement).toBe(node(t, "Reading"));
  key(node(t, "Reading"), "ArrowUp");
  expect(document.activeElement).toBe(design);
  key(design, "Delete");
  key(design, "F2");
  key(typeIn(t, "Design systems"), "Enter");
  expect(events).toEqual([
    { action: "delete", id: "f3", label: "Design" },
    { action: "rename", id: "f3", label: "Design", name: "Design systems" },
  ]);
  t.remove();
});

test("flat folders: an empty or duplicate name is refused at the field in folder words", () => {
  const { t, events } = flatFolders();
  t.querySelector<HTMLButtonElement>(".tree-new")?.click();
  key(typeIn(t, "  "), "Enter");
  expect(t.querySelector(".tedit .err-text")?.textContent).toContain(
    "Type a name",
  );
  key(typeIn(t, "dev TOOLS"), "Enter");
  expect(t.querySelector(".tedit .err-text")?.textContent).toBe(
    'A folder named "dev TOOLS" already exists.',
  );
  expect(field(t).getAttribute("aria-invalid")).toBe("true");
  expect(events).toEqual([]);
  t.remove();
});

test("flat folders: children are not drawn and no row has a chevron", () => {
  const { t } = flatFolders([
    {
      label: "Reading",
      kind: "folder",
      expanded: true,
      children: [{ label: "Hidden child", kind: "folder" }],
    },
  ]);
  expect(node(t, "Hidden child")).toBeUndefined();
  expect(node(t, "Reading").hasAttribute("aria-expanded")).toBe(false);
  expect(t.querySelector(".chev")).toBeNull();
  t.remove();
});

test("flat folders: a long name, a Vietnamese name and 30 folders keep their full text", () => {
  const long = `${"Thư mục đọc sau về kiến trúc phần mềm ".repeat(3)}end`;
  const many: TreeNode[] = Array.from({ length: 30 }, (_, i) => ({
    label: `Folder ${i + 1}`,
    kind: "folder",
    count: i,
  }));
  const { t } = flatFolders([
    { label: long, kind: "folder", count: 1 },
    { label: "Sức khoẻ", kind: "folder", count: 4 },
    ...many,
  ]);
  expect(node(t, long).querySelector<HTMLElement>(".tname")?.title).toBe(long);
  expect(node(t, "Sức khoẻ")).toBeDefined();
  expect(t.querySelectorAll(".tnode")).toHaveLength(32);
  key(node(t, long), "F2");
  expect(field(t).value).toBe(long);
  t.remove();
});

test("the default stays nested labels: label words and four menu actions", () => {
  const { t } = withActions();
  expect(t.classList.contains("is-flat")).toBe(false);
  expect(t.querySelector(".tree-new")?.textContent).toBe("New label");
  expect(menuTexts(t, "Mnemo")).toHaveLength(4);
  expect(menuItem(t, "Mnemo", "New label inside")).toBeDefined();
  t.remove();
});

test("flat folders: the flat rule hides the chevron spacer", () => {
  const rule = cssRule(
    import.meta.dirname,
    "tree.css",
    ".tree-box.is-flat .spacer",
  );
  expect(rule.display).toBe("none");
});
