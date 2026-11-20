// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
import { createTree, type TreeNode } from "./tree";

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
