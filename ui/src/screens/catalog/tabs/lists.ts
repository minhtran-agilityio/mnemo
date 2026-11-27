// The Lists tab: many items at once. This file is the tab's renderer; the Records and Lists agent
// owns it with ds/catalog/lists.ts, ds/catalog/lists.css and ds/components/lists.ts.

import "../../../ds/catalog/lists.css";
import { Link } from "lucide";
import { ref } from "../../../ds/catalog/types";
import {
  createFolderHeading,
  createKanbanBoard,
  createKanbanCard,
  createList,
  createListbox,
  createListRow,
  createSectionList,
  createSelect,
  createSettingsRow,
  createSettingsRows,
  createTable,
  createTree,
  setSettingsRowError,
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

/** The flat folder list of the Bookmarks screen (#192): Unsorted is last and refuses changes. */
const UNSORTED_WHY = "Unsorted is fixed. It holds bookmarks with no folder.";
const FOLDERS: TreeNode[] = [
  {
    label: "AI and agents",
    kind: "folder",
    count: 12,
    id: "f1",
    current: true,
  },
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
const MANY_FOLDERS: TreeNode[] = [
  {
    label: "Thư mục đọc sau về kiến trúc phần mềm và hệ thống phân tán cục bộ",
    kind: "folder",
    count: 41,
    id: "long",
  },
  { label: "Sức khoẻ và tập luyện", kind: "folder", count: 7, id: "vi" },
  ...Array.from(
    { length: 27 },
    (_, i): TreeNode => ({
      label: `Folder ${i + 1}`,
      kind: "folder",
      count: i % 9,
      id: `n${i + 1}`,
    }),
  ),
  FOLDERS[4],
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
      `${e.action} ${e.label || e.name || "top level"}. Catalog only, nothing changed.`,
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
              forced: { id: '[["Work",0],["Design notes",1]]', state: "menu" },
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
            forced: { id: '[["Work",0],["Mnemo",0]]', state: "renaming" },
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
              id: '[["Work",0],["Mnemo",0]]',
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
            forced: { id: '[["Work",0],["Mnemo",0]]', state: "hover" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "focus-visible",
          createTree(doc, "Labels, focus example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: { id: '[["Work",0],["Mnemo",0]]', state: "focus" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "active (pressed)",
          createTree(doc, "Labels, active example", LABELS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            forced: { id: '[["Work",0],["Mnemo",0]]', state: "active" },
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
        state(
          doc,
          "flat folders, live: 5 folders with counts, Unsorted last",
          createTree(doc, "Folders, live example", FOLDERS, undefined, {
            ...labelActions(ctx.toast, ctx.signal),
            noun: "folder",
            flat: true,
          }),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, empty: no folders yet",
          createTree(doc, "Folders, empty example", [], undefined, {
            onAction: () => {},
            signal: ctx.signal,
            noun: "folder",
            flat: true,
          }),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, empty: Unsorted only",
          createTree(
            doc,
            "Folders, Unsorted only example",
            [FOLDERS[4]],
            undefined,
            {
              onAction: () => {},
              signal: ctx.signal,
              noun: "folder",
              flat: true,
            },
          ),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, menu open: Rename and Delete only",
          wrapRoom(
            doc,
            createTree(doc, "Folders, menu example", FOLDERS, undefined, {
              onAction: () => {},
              signal: ctx.signal,
              noun: "folder",
              flat: true,
              forced: { id: "f3", state: "menu" },
            }),
          ),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, disabled: Unsorted refuses Rename and Delete with a reason",
          wrapRoom(
            doc,
            createTree(
              doc,
              "Folders, Unsorted menu example",
              FOLDERS,
              undefined,
              {
                onAction: () => {},
                signal: ctx.signal,
                noun: "folder",
                flat: true,
                forced: { id: "unsorted", state: "menu" },
              },
            ),
          ),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, error: duplicate name at the field",
          createTree(doc, "Folders, rename error example", FOLDERS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            noun: "folder",
            flat: true,
            forced: { id: "f3", state: "error", value: "Dev tools" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, hover",
          createTree(doc, "Folders, hover example", FOLDERS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            noun: "folder",
            flat: true,
            forced: { id: "f2", state: "hover" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, focus-visible",
          createTree(doc, "Folders, focus example", FOLDERS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            noun: "folder",
            flat: true,
            forced: { id: "f2", state: "focus" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, active (pressed)",
          createTree(doc, "Folders, active example", FOLDERS, undefined, {
            onAction: () => {},
            signal: ctx.signal,
            noun: "folder",
            flat: true,
            forced: { id: "f2", state: "active" },
          }),
          { grow: true },
        ),
        state(
          doc,
          "flat folders, overflow: a long name, a Vietnamese name, 30 folders",
          createTree(
            doc,
            "Folders, overflow example",
            MANY_FOLDERS,
            undefined,
            {
              onAction: () => {},
              signal: ctx.signal,
              noun: "folder",
              flat: true,
            },
          ),
          { grow: true },
        ),
      ],
      "settings row": () => {
        const models = ["Haiku 5.5", "Sonnet 5.5"];
        const efforts = ["Low effort", "Medium effort"];
        // Each example has its own scope, so no two controls on the tab share a name.
        let scope = "default";
        const controls = (name: string, model: string, effort: string) =>
          [
            {
              label: `${scope}: ${name}, model`,
              options: models,
              value: model,
            },
            {
              label: `${scope}: ${name}, effort`,
              options: efforts,
              value: effort,
            },
          ].map((c) => {
            const { wrap, select } = createSelect(doc, {
              options: c.options,
              value: c.value,
            });
            select.setAttribute("aria-label", c.label);
            return wrap;
          });
        const feature = (
          label: string,
          sub: string,
          model: string,
          effort: string,
          extra: { error?: string; disabled?: boolean } = {},
        ) =>
          createSettingsRow(doc, {
            label,
            sub,
            controls: controls(label, model, effort),
            ...extra,
          });
        const card = (label: string, rows: HTMLElement[]) => {
          const wrap = el(doc, "div", "lst-settings");
          wrap.append(createSettingsRows(doc, { label, rows }));
          return wrap;
        };
        const H = "Haiku 5.5";
        const S = "Sonnet 5.5";
        const LOW = "Low effort";
        const MED = "Medium effort";
        const withScope = <T>(name: string, make: () => T): T => {
          scope = name;
          return make();
        };
        const eight = withScope("default", () => [
          feature("Save a link", "Summary, tags and folder", H, LOW),
          feature("Ask Mnemo", "Answers with sources", S, MED),
          feature(
            "Weekly digest and roast",
            '"Why now" lines and roast words',
            S,
            MED,
          ),
          feature("Note summary", "One paragraph per note", H, LOW),
          feature("Tag suggestions", "Tags from the text", H, LOW),
          feature("Folder suggestions", "Where a link belongs", H, LOW),
          feature("Idea cards", "Next step for each idea", S, MED),
          feature("Task extraction", "Tasks found in notes", S, MED),
        ]);
        // Exactly 120 characters.
        const longLabel =
          "Một nhãn rất dài về mô hình cho tính năng này, được viết ra để thử cách xuống dòng của một hàng cài đặt khi chữ quá dài.";
        const grown = (text: string, node: HTMLElement) =>
          state(doc, text, node, { grow: true });
        const live = withScope("live", () => {
          const row = feature("Ask Mnemo", "Answers with sources", S, MED);
          const select = row.querySelector("select");
          select?.addEventListener("change", () =>
            setSettingsRowError(
              row,
              select.value === S
                ? null
                : "Could not save. The next run keeps the old choice.",
            ),
          );
          return card("Live example", [row]);
        });
        return [
          grown(
            "default: eight rows in a card, two selects each",
            card("Model and effort per feature", eight),
          ),
          grown(
            "overflow: a 120-character label and a long sub-line wrap",
            withScope("overflow", () =>
              card("Long label example", [
                feature(
                  longLabel,
                  "A long sub-line that wraps onto a second line instead of being cut with an ellipsis, and keeps its words whole.",
                  S,
                  MED,
                ),
                feature("x".repeat(120), "Unbroken text wraps too", H, LOW),
              ]),
            ),
          ),
          grown(
            "error: one line under the row",
            withScope("error", () =>
              card("Error example", [
                feature("Ask Mnemo", "Answers with sources", S, MED, {
                  error: "Could not save. The next run keeps the old choice.",
                }),
              ]),
            ),
          ),
          grown(
            "live error: pick Haiku 5.5 to show the line on this row, pick Sonnet 5.5 to clear it",
            live,
          ),
          grown(
            "disabled: a save is pending",
            withScope("disabled", () =>
              card("Disabled example", [
                feature("Save a link", "Summary, tags and folder", H, LOW, {
                  disabled: true,
                }),
              ]),
            ),
          ),
          grown(
            "narrow: under the text width the controls drop under the label",
            withScope("narrow", () => {
              const wrap = card("Narrow example", [
                feature("Save a link", "Summary, tags and folder", H, LOW),
              ]);
              wrap.classList.add("lst-settings-narrow");
              return wrap;
            }),
          ),
        ];
      },
      "folder heading": () => {
        const make = (o: Parameters<typeof createFolderHeading>[1]) => {
          const wrap = el(doc, "div", "lst-folder");
          wrap.append(createFolderHeading(doc, o).element);
          return wrap;
        };
        const sample = { name: "Đọc sau", count: 7 };
        return [
          state(
            doc,
            "collapsed (live)",
            make({ name: "Kỹ thuật / Rust", count: 24 }),
          ),
          state(doc, "expanded", make({ ...sample, expanded: true })),
          state(doc, "hover", make({ ...sample, forceState: "hover" })),
          state(doc, "focus-visible", make({ ...sample, forceState: "focus" })),
          state(doc, "active", make({ ...sample, forceState: "pressed" })),
          state(
            doc,
            "overflow: 60-character name, count 500",
            make({
              name: "Thư mục có tên rất dài để thử việc xuống dòng của tiêu đề ok",
              count: 500,
            }),
          ),
          state(
            doc,
            "no toggle (all items show)",
            make({ ...sample, canToggle: false }),
          ),
        ];
      },
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
