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
        const idea = (title: string, current = false) =>
          createKanbanCard(doc, {
            title,
            meta: ["3 of 4 checks", "2 tags"],
            onOpen: () => {},
            current,
          });
        const stage = (name: string, cards: HTMLElement[]) => ({
          name,
          cards,
          emptyText: "No idea here yet.",
        });
        const garden = "Garden robot that waters by soil moisture";
        const ideas = createKanbanBoard(
          doc,
          "Idea board example",
          [
            stage("Spark", [
              idea(garden, true),
              idea(
                "A very long idea title that keeps going to show how a title wraps inside the card",
              ),
            ]),
            stage("Shape", [idea("Weekly review ritual")]),
            stage("Ready", []),
            stage("Project", [idea("Reading list export")]),
          ],
          { move: false },
        );
        const many = createKanbanBoard(
          doc,
          "Idea board with many cards",
          [
            stage(
              "Spark",
              Array.from({ length: 12 }, (_, i) =>
                idea(`Idea number ${i + 1}`),
              ),
            ),
          ],
          { move: false },
        );
        return {
          nodes: [
            board,
            el(
              doc,
              "p",
              "cat-note",
              "No-move board (move: false), button cards: click, Enter or Space opens an idea; the open one has a check and aria-current. Ready shows the empty state; the last board shows many cards scrolling in the column.",
            ),
            ideas,
            many,
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
