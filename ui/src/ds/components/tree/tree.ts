// A tree for folders and nested labels. A node with children is a button with aria-expanded that
// opens and closes its group. The current node has aria-current. Arrow Up and Down move between
// the visible nodes, Arrow Right opens and Arrow Left closes; Tab and Enter work as on any button.
import { ChevronRight, Folder, type IconNode, Tag } from "lucide";
import { createRecordIcon } from "../record-icon/record-icon";
import "./tree.css";

export interface TreeNode {
  readonly label: string;
  readonly kind: "folder" | "label";
  readonly count?: number;
  readonly children?: readonly TreeNode[];
  readonly expanded?: boolean;
  readonly current?: boolean;
}

const ICONS: Record<TreeNode["kind"], IconNode> = {
  folder: Folder,
  label: Tag,
};

function buildNodes(
  doc: Document,
  nodes: readonly TreeNode[],
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
      btn.append(createRecordIcon(ChevronRight, "chev"));
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
    btn.append(createRecordIcon(ICONS[node.kind], "rec-ic-muted"), name);
    if (node.count !== undefined) {
      const cnt = doc.createElement("span");
      cnt.className = "cnt";
      cnt.textContent = String(node.count);
      btn.append(cnt);
    }
    li.append(btn);
    if (hasKids) {
      const sub = buildNodes(doc, node.children ?? []);
      sub.hidden = node.expanded !== true;
      li.append(sub);
    }
    ul.append(li);
  }
  return ul;
}

export function createTree(
  doc: Document,
  label: string,
  nodes: readonly TreeNode[],
  onSelect?: (label: string) => void,
): HTMLUListElement {
  const tree = buildNodes(doc, nodes);
  tree.classList.add("tree");
  tree.setAttribute("aria-label", label);
  const visible = () =>
    [...tree.querySelectorAll<HTMLButtonElement>(".tnode")].filter(
      (b) => !b.closest("ul[hidden]"),
    );
  const setOpen = (btn: HTMLElement, open: boolean) => {
    btn.setAttribute("aria-expanded", String(open));
    const sub = btn.nextElementSibling as HTMLElement | null;
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
    }
  });
  return tree;
}
