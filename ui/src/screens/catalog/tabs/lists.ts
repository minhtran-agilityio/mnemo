// The Lists tab: many items at once. This file is the tab's renderer; the Records and Lists agent
// owns it with ds/catalog/lists.ts, ds/catalog/lists.css and ds/components/lists.ts.

import "../../../ds/catalog/lists.css";
import { Link } from "lucide";
import { ref } from "../../../ds/catalog/types";
import {
  createKanbanBoard,
  createKanbanCard,
  createList,
  createListbox,
  createListRow,
  createSectionList,
  createTable,
  createTree,
  type TreeActionsOptions,
  type TreeNode,
} from "../../../ds/index";
import { el, entryRows, state, type TabRenderer } from "../parts";

const TREE: TreeNode[] = [
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
        count: 128,
        children: [{ label: "Agility", kind: "folder", count: 40 }],
      },
    ],
  },
  {
    label: "tiếng việt",
    kind: "label",
    count: 57,
    children: [{ label: "ngữ pháp", kind: "label", count: 9 }],
  },
  { label: "Đọc sau", kind: "folder", count: 42 },
];

const LABELS: TreeNode[] = [
  {
    label: "Work",
    kind: "label",
    expanded: true,
    children: [
      { label: "Mnemo", kind: "label", expanded: true, current: true },
      {
        label: "Design notes",
        kind: "label",
        refused: {
          delete: "This label still holds notes that have no other label",
        },
      },
    ],
  },
  {
    label: "Personal",
    kind: "label",
    expanded: true,
    children: [
      {
        label: "Sức khoẻ",
        kind: "label",
        expanded: true,
        children: [{ label: "Tập luyện buổi sáng", kind: "label" }],
      },
    ],
  },
];

const LONG_LABELS: TreeNode[] = [
  {
    label: "Ghi chú dài về kiến trúc lưu trữ cục bộ và đồng bộ ngoại tuyến",
    kind: "label",
    count: 12,
  },
];

/** Room under a tree whose menu is held open, so the menu does not cover the caption. */
const wrapRoom = (doc: Document, tree: HTMLElement): HTMLElement => {
  const room = el(doc, "div", "lst-menu-room");
  room.append(tree);
  return room;
};

/** The live example: it reports to a toast, the way a screen would do the work. */
const labelActions = (
  toast: (text: string) => void,
  signal: AbortSignal,
): TreeActionsOptions => ({
  signal,
  onAction: (e) =>
    toast(
      `${e.action} ${e.name ?? e.label ?? "top level"}. Catalog only, nothing changed.`,
    ),
});

export const renderLists: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  panel.append(
    entryRows(ctx, "Lists", {
      "list row": () => {
        const listbox = createListbox(doc, "Links", [
          {
            title: "Tauri 2: capabilities and permissions",
            meta: "2 d",
            icon: Link,
          },
          {
            title: "WebKitGTK 2.36 CSS support table (hover)",
            meta: "5 d",
            icon: Link,
            forceState: "hover",
          },
          {
            title: "Source Sans 3 release notes (selected)",
            meta: "1 w",
            icon: Link,
            selected: true,
          },
          {
            title: "Cách đặt tên biến trong Rust cho người mới bắt đầu",
            meta: "3 w",
            icon: Link,
          },
          {
            title:
              "A very long title that is cut off with an ellipsis when the row is too narrow to show all of it",
            meta: "Yesterday",
            icon: Link,
          },
        ]);
        const focus = createList(doc, "Focus example", [
          createListRow(doc, {
            title: "Focus ring (forced)",
            meta: "now",
            forceState: "focus",
          }),
          createListRow(doc, {
            title: "With a second line",
            sub: "The second line is cut off too, with its full text in the tooltip.",
            meta: "3 d",
          }),
        ]);
        return {
          nodes: [
            state(
              doc,
              "default, hover, selected and overflow (arrows move, Enter selects)",
              listbox,
              { grow: true },
            ),
            state(doc, "focus and second line", focus, { grow: true }),
          ],
          column: true,
        };
      },
      list: () => {
        const plain = createList(doc, "Plain list", [
          createListRow(doc, { title: "Read the design notes", meta: "Today" }),
          createListRow(doc, { title: "Plan the week", meta: "Mon" }),
        ]);
        return [state(doc, "list", plain, { grow: true })];
      },
      "kanban column": () => {
        const c = (title: string, ref: string) =>
          createKanbanCard(doc, { title, meta: [ref] });
        const board = createKanbanBoard(
          doc,
          "Board example",
          [
            {
              name: "To do",
              cards: [
                c("Pick an icon set", ref(104)),
                c("Contrast test", ref(104)),
              ],
            },
            {
              name: "Doing",
              cards: [c("Write DESIGN.md", ref(112))],
              over: true,
            },
            {
              name: "Done",
              cards: [],
              emptyText: "Nothing done yet. Drag a card here.",
            },
          ],
          { drag: true },
        );
        return {
          nodes: [
            board,
            el(
              doc,
              "p",
              "cat-note",
              '"Doing" shows the drop-target state, "Done" the empty state. This board has the drag option: drag a card, or press Left or Right.',
            ),
          ],
          column: true,
          wide: true,
        };
      },
      table: () => ({
        wide: true,
        nodes: [
          createTable(doc, {
            label: "Saved links, sortable",
            columns: [
              { label: "Title" },
              { label: "Source" },
              { label: "Saved" },
              { label: "Opens", numeric: true },
            ],
            rows: [
              [
                { text: "Tauri 2: capabilities" },
                { text: "Telegram" },
                { text: "19 Nov", sort: 20261119 },
                { text: "4" },
              ],
              [
                { text: "Hướng dẫn sao lưu dữ liệu" },
                { text: "Zalo" },
                { text: "18 Nov", sort: 20261118 },
                { text: "12" },
              ],
              [
                { text: "Write-ahead log explained" },
                { text: "GitHub" },
                { text: "7 Nov", sort: 20261107 },
                { text: "1" },
              ],
              [
                { text: "Weekly sync notes" },
                { text: "Slack" },
                { text: "30 Oct", sort: 20261030 },
                { text: "0" },
              ],
            ],
            sort: { column: 2, direction: "descending" },
          }),
        ],
      }),
      tree: () => [
        state(
          doc,
          "expanded, collapsed, current (click or use the arrow keys)",
          createTree(doc, "Folders", TREE),
          { grow: true },
        ),
        state(
          doc,
          "with actions, live: F2 renames, Delete is reported, Shift+F10 opens the menu",
          createTree(
            doc,
            "Labels, live example",
            LABELS,
            undefined,
            labelActions(ctx.toast, ctx.signal),
          ),
          { grow: true },
        ),
        state(
          doc,
          "empty: no labels yet",
          createTree(doc, "Labels, empty example", [], undefined, {
            onAction: () => {},
            signal: ctx.signal,
          }),
          { grow: true },
        ),
        state(
          doc,
          "menu open, one action refused with its reason",
          wrapRoom(
            doc,
            createTree(doc, "Labels, menu example", LABELS, undefined, {
              onAction: () => {},
              signal: ctx.signal,
              forced: { id: '["Work","Design notes"]', state: "menu" },
            }),
          ),
          { grow: true },
        ),
        state(
          doc,
          "renaming (Enter saves, Escape cancels)",
          createTree(doc, "Labels, rename example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: { id: '["Work","Mnemo"]', state: "renaming" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "rename refused: duplicate name at the field",
          createTree(doc, "Labels, rename error example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: {
              id: '["Work","Mnemo"]',
              state: "error",
              value: "Design notes",
            },
          }),
          { grow: true },
        ),
        state(
          doc,
          "hover",
          createTree(doc, "Labels, hover example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: { id: '["Work","Mnemo"]', state: "hover" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "focus-visible",
          createTree(doc, "Labels, focus example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: { id: '["Work","Mnemo"]', state: "focus" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "active (pressed)",
          createTree(doc, "Labels, active example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: { id: '["Work","Mnemo"]', state: "active" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "overflow: long Vietnamese name, 60 characters, cut with the full name as title",
          createTree(doc, "Labels, long name example", LONG_LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
          }),
          { grow: true },
        ),
      ],
      "section list": () => {
        const sections = [
          { id: "appearance", label: "Appearance", value: "System" },
          { id: "ai", label: "AI", value: "Not built yet" },
          { id: "data", label: "Data", value: "Not built yet" },
        ];
        const live = createSectionList(doc, {
          label: "Settings sections, live example",
          sections,
          current: "appearance",
          onSelect: (id) => ctx.toast(`Opened ${id}. Catalog only.`),
        });
        const hover = createSectionList(doc, {
          label: "Settings sections, hover example",
          sections,
          current: "appearance",
          forceState: { id: "ai", state: "hover" },
        });
        const focus = createSectionList(doc, {
          label: "Settings sections, focus example",
          sections,
          current: "appearance",
          forceState: { id: "data", state: "focus" },
        });
        const long = createSectionList(doc, {
          label: "Settings sections, long value example",
          sections: [
            {
              id: "folder",
              label: "Save folder",
              value:
                "/home/owner/Documents/Mnemo/attachments/2026/very/long/folder/name",
            },
            { id: "ai", label: "AI", value: "Not built yet" },
          ],
          current: "folder",
        });
        const box = (node: HTMLElement) => {
          const wrap = el(doc, "div", "lst-section");
          wrap.append(node);
          return wrap;
        };
        return [
          state(doc, "default, current (live)", box(live.element)),
          state(doc, "hover", box(hover.element)),
          state(doc, "focus-visible", box(focus.element)),
          state(
            doc,
            "long value: ellipsis, full text in the title",
            box(long.element),
          ),
        ];
      },
    }),
  );
};
