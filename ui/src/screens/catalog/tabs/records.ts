// The Records tab: one item in each shape. This file is the tab's renderer; the Records and
// Lists agent owns it with ds/catalog/records.ts, ds/catalog/records.css and
// ds/components/records.ts.

import "../../../ds/catalog/records.css";
import { ref } from "../../../ds/catalog/types";
import {
  APP_LABELS,
  type AppId,
  buildTrustLabel,
  createAnswer,
  createAppBadge,
  createCite,
  createKanbanCard,
  createLinkCard,
  createLinkView,
  createList,
  createMetaLine,
  createMissingCite,
  createNoteRow,
  createSegmented,
  createSourceList,
  createTagList,
  createTaskRow,
  type LinkItem,
  type LinkView,
} from "../../../ds/index";
import {
  el,
  entryRows,
  state,
  type TabContext,
  type TabRenderer,
} from "../parts";

const LINKS: LinkItem[] = [
  {
    title: "Tauri 2: capabilities and permissions, explained with examples",
    url: "v2.tauri.app/security/capabilities",
    app: "telegram",
    age: "2 d",
    summary:
      "Each window gets a list of allowed commands. Anything not listed is refused at the core.",
  },
  {
    title: "Hướng dẫn sao lưu dữ liệu an toàn khi đang ghi",
    url: "viblo.asia/p/sao-luu-du-lieu",
    app: "zalo",
    age: "3 h",
    summary:
      "Dùng API sao lưu trực tuyến thay vì sao chép tệp. Ở chế độ WAL cần checkpoint trước.",
  },
  {
    title: "medium.com/@x/9f2c1a",
    url: "medium.com/@x/9f2c1a",
    app: "slack",
    age: "1 h",
  },
];

const VIEWS: readonly [LinkView, string][] = [
  ["list", "List"],
  ["cards", "Cards"],
  ["compact", "Compact"],
];

/** The three-way switch of the Bookmarks view: the segmented choice of the Controls tab. */
function viewSwitch(
  doc: Document,
  out: HTMLElement,
  initial: LinkView,
): HTMLElement {
  const show = (view: LinkView) =>
    out.replaceChildren(createLinkView(doc, view, LINKS));
  const labelOf = (view: LinkView) => VIEWS.find(([v]) => v === view)?.[1];
  show(initial);
  return createSegmented(doc, {
    label: "Bookmarks view",
    options: VIEWS.map(([, text]) => text),
    value: labelOf(initial),
    onChange: (text) => {
      const hit = VIEWS.find(([, t]) => t === text);
      if (hit) show(hit[0]);
    },
  });
}

function linkCardRow(ctx: TabContext) {
  const doc = ctx.doc;
  const out = el(doc, "div");
  const sw = viewSwitch(doc, out, "cards");
  const base = LINKS[1];
  const states = el(doc, "div", "rec-wrap");
  const card = (item: LinkItem, caption: string) =>
    state(doc, caption, createLinkCard(doc, item), { grow: true });
  states.append(
    card(
      {
        title: "Đang đọc trang…",
        url: "thanhnien.vn/cong-nghe/ai-viet-nam",
        app: "telegram",
        age: "2 min",
        status: "reading",
      },
      "reading",
    ),
    card({ ...LINKS[2] }, "could not read"),
    card({ ...base, summary: undefined, status: "ai-off" }, "AI off"),
    card(
      {
        ...base,
        summaryKind: "guess",
        summary: "Probably a guide to safe data backups.",
      },
      "guessed text, labelled",
    ),
    card(
      {
        title:
          "A very long title that keeps going, with averyveryveryveryveryverylongwordinit and more words after it",
        url: "example.com/a/very/long/path/that/is/cut/off/with/an/ellipsis/and/shows/in/full/in/its/tooltip",
        app: "github",
        age: "5 d",
        summary:
          "The title wraps to two lines. The URL is cut off and its tooltip has the full address.",
      },
      "long title and URL",
    ),
  );
  return { nodes: [sw, out, states], column: true };
}

function noteRows(ctx: TabContext) {
  const doc = ctx.doc;
  const notes = createList(doc, "Notes example", [
    createNoteRow(doc, {
      title: "Kế hoạch chuyển dữ liệu sang ui/src/ds",
      meta: "Edited today · 3 links",
    }),
    createNoteRow(doc, {
      title: "FTS5 notes",
      meta: "Edited 2 d ago",
      byAi: true,
      forceState: "hover",
    }),
  ]);
  return [
    state(doc, "default, hover and written by AI", notes, { grow: true }),
  ];
}

function taskRows(ctx: TabContext) {
  const doc = ctx.doc;
  const tasks = createList(doc, "Tasks example", [
    createTaskRow(doc, {
      id: "cat-task-1",
      title: "Check the contrast test on Ubuntu",
      meta: "Due today",
      badge: { text: "Today", tone: "warn" },
    }),
    createTaskRow(doc, {
      id: "cat-task-2",
      title: "Write DESIGN.md",
      meta: "Done yesterday",
      done: true,
    }),
    createTaskRow(doc, {
      id: "cat-task-3",
      title: "Reply to Lan about the export",
      meta: "Due 12 Nov",
      badge: { text: "Overdue", tone: "bad" },
    }),
  ]);
  return [
    state(doc, "open, done and overdue (tick a box to try)", tasks, {
      grow: true,
    }),
  ];
}

export const renderRecords: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  const rows = entryRows(ctx, "Records", {
    "link card": linkCardRow,
    "note row": noteRows,
    "task row": taskRows,
    "kanban card": () => {
      const k = (opts: Parameters<typeof createKanbanCard>[1], cap: string) =>
        state(doc, cap, createKanbanCard(doc, opts));
      return [
        k({ title: "Bundle fonts locally", meta: [ref(104), "2 d"] }, "rest"),
        k(
          {
            title: "Bundle fonts locally",
            meta: [ref(104)],
            forceState: "hover",
          },
          "hover",
        ),
        k(
          {
            title: "Bundle fonts locally",
            meta: [ref(104)],
            forceState: "focus",
          },
          "focus",
        ),
        k(
          {
            title: "Bundle fonts locally",
            meta: [ref(104)],
            forceState: "dragging",
          },
          "dragging",
        ),
        k(
          { title: "Summarise the WebKitGTK notes", working: true },
          "AI running",
        ),
        k(
          {
            title: "Garden robot that waters by soil moisture",
            meta: ["3 of 4 checks", "2 tags"],
            onOpen: () => {},
          },
          "button",
        ),
        k(
          {
            title: "Garden robot that waters by soil moisture",
            meta: ["3 of 4 checks", "2 tags"],
            onOpen: () => {},
            current: true,
          },
          "open now",
        ),
        k(
          {
            title: "Garden robot that waters by soil moisture",
            meta: ["3 of 4 checks", "2 tags"],
            onOpen: () => {},
            forceState: "focus",
          },
          "button focus",
        ),
        k(
          {
            title: "x".repeat(60),
            meta: ["3 of 4 checks", "2 tags"],
            onOpen: () => {},
            current: true,
          },
          "open, long unbroken title",
        ),
      ];
    },
    citation: () => {
      const answer = createAnswer(doc, [
        buildTrustLabel("ai"),
        " You saved two guides on data backups. Both say to use the online backup API instead of copying the file ",
        createCite(doc, 1, "#/ui-catalog"),
        ". One adds that WAL mode needs a checkpoint first ",
        createCite(doc, 2, "#/ui-catalog"),
        ". Restore time was not measured in either ",
        createMissingCite(doc),
        ".",
      ]);
      const sources = createSourceList(doc, [
        { title: "Hướng dẫn sao lưu dữ liệu an toàn", app: "zalo", age: "3 h" },
        { title: "Write-ahead log explained", app: "github", age: "12 d" },
      ]);
      return { nodes: [answer, sources], column: true };
    },
    "tag list": () => [
      state(doc, "tags", createTagList(doc, ["rust", "search", "tiếng việt"])),
      state(
        doc,
        "with overflow",
        createTagList(
          doc,
          ["rust", "search", "tiếng việt", "a", "b", "c", "d"],
          { max: 3 },
        ),
      ),
    ],
    "metadata line": () => {
      const apps = el(doc, "div", "rec-hstack");
      for (const id of Object.keys(APP_LABELS) as AppId[])
        apps.append(createAppBadge(doc, id));
      return {
        nodes: [
          createMetaLine(doc, [
            "3 h ago",
            "12 links",
            createAppBadge(doc, "telegram"),
          ]),
          apps,
        ],
        column: true,
      };
    },
  });
  panel.append(rows);
};
