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
  createButton,
  createCite,
  createCompactRow,
  createKanbanCard,
  createLinkCard,
  createLinkRow,
  createLinkView,
  createList,
  createMarkdownView,
  createMetaLine,
  createMissingCite,
  createNoteRow,
  createSegmented,
  createSourceList,
  createTagList,
  createTaskRow,
  type LinkItem,
  type LinkRowOptions,
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
  const card = (item: LinkItem, caption: string, action?: Node) =>
    state(doc, caption, createLinkCard(doc, item, { action }), { grow: true });
  // A card with more than one action (issue 179). `narrow` holds the card in a narrow column, so
  // its buttons wrap.
  const cardWith = (
    item: LinkItem,
    caption: string,
    actions: readonly Node[],
    narrow = false,
  ) => {
    // `grow` also stretches the card to its column; .rec-narrow then caps the column.
    const box = state(doc, caption, createLinkCard(doc, item, { actions }), {
      grow: true,
    });
    if (narrow) box.classList.add("rec-narrow");
    return box;
  };
  const act = (
    label: string,
    more: {
      busy?: boolean;
      disabled?: boolean;
      forced?: "hover" | "focus" | "pressed";
      variant?: "ghost";
    } = {},
  ) =>
    createButton(doc, {
      label,
      size: "sm",
      ...more,
      onClick: () => ctx.toast(`${label}: an example action`),
    });
  // Every action after the main one is quieter (issue 179).
  const ghost = { variant: "ghost" } as const;
  // The request's sample (issue 169): a link pasted into Mnemo, so no source app.
  const pasted: LinkItem = {
    title: "Tauri 2 capabilities",
    url: "v2.tauri.app/security/capabilities",
    site: "v2.tauri.app",
    saved: "25 Nov 2026",
    status: "done",
    summary: "Each window gets a list of allowed commands.",
    tags: ["tauri", "security"],
    reason: "It may matter for the Mnemo command allow-list.",
  };
  const unread = { summary: undefined, tags: undefined, reason: undefined };
  states.append(
    card(pasted, "done: summary, tags, reason (Guess)"),
    card({ ...pasted, ...unread, status: "pending" }, "pending"),
    card({ ...pasted, ...unread, status: "reading" }, "reading"),
    card(
      { ...pasted, ...unread, status: "unreadable" },
      "could not read, with its action",
      act("Paste the text"),
    ),
    card(
      { ...pasted, ...unread, status: "ai-off" },
      "AI off, with its action",
      act("Summarize later"),
    ),
    card(
      { ...pasted, ...unread, status: "ai-off" },
      "action busy",
      act("Summarize later", { busy: true }),
    ),
    card(
      { ...pasted, ...unread, status: "unreadable" },
      "action disabled",
      act("Paste the text", { disabled: true }),
    ),
    // Issue 179, the owner's "Offer both": a pending card whose page could not be reached. A list
    // holds many cards and a view has one primary action, so no card button is primary: the main
    // action is a default sm button and the other one a quieter ghost sm button.
    cardWith(
      { ...pasted, ...unread, status: "pending" },
      "two actions: pending, the main one default, the other ghost",
      [act("Summarize later"), act("Paste the text", ghost)],
    ),
    cardWith(
      { ...pasted, ...unread, status: "pending" },
      "two actions on a narrow card: they wrap",
      [act("Summarize later"), act("Paste the text", ghost)],
      true,
    ),
    cardWith(
      {
        ...pasted,
        ...unread,
        status: "pending",
        title: "Hướng dẫn quyền trong Tauri 2",
      },
      "overflow: two long Vietnamese labels on a narrow card",
      [
        act("Tóm tắt sau khi có mạng trở lại"),
        act("Dán toàn bộ nội dung của trang vào đây", ghost),
      ],
      true,
    ),
    cardWith(
      { ...pasted, ...unread, status: "pending" },
      "two actions: the first busy",
      [act("Summarize later", { busy: true }), act("Paste the text", ghost)],
    ),
    cardWith(
      { ...pasted, ...unread, status: "pending" },
      "two actions: the first disabled",
      [
        act("Summarize later", { disabled: true }),
        act("Paste the text", ghost),
      ],
    ),
    cardWith(
      { ...pasted, ...unread, status: "pending" },
      "two actions: focus-visible on the second",
      [
        act("Summarize later"),
        act("Paste the text", { ...ghost, forced: "focus" }),
      ],
    ),
    cardWith(
      { ...pasted, ...unread, status: "pending" },
      "two actions: hover on the first, active on the second",
      [
        act("Summarize later", { forced: "hover" }),
        act("Paste the text", { ...ghost, forced: "pressed" }),
      ],
    ),
    card(
      { ...pasted, tags: undefined, reason: undefined },
      "partial: summary only",
    ),
    card({ ...pasted, reason: undefined }, "partial: tags, no reason"),
    card(
      { ...pasted, tagsKind: "owner", reasonKind: "owner" },
      "the owner's tags and reason: no label",
    ),
    card(
      {
        ...pasted,
        title:
          "Hướng dẫn đầy đủ về quyền và khả năng trong Tauri 2 — Ở ĐÂU, KHI NÀO, VÌ SAO cần giới hạn lệnh?",
        url: "rất-nhiều-tên-miền-con.tài-liệu.v2.tauri.app/security/capabilities/permissions/scopes/very/long/path",
        site: "rất-nhiều-tên-miền-con.tài-liệu.v2.tauri.app",
        tags: [
          "tauri",
          "security",
          "rust",
          "ipc",
          "capabilities",
          "windows",
          "đặc-tả",
          "lưu-trữ",
        ],
        reason:
          "Có thể liên quan đến danh sách lệnh được phép của Mnemo, vì mỗi cửa sổ chỉ gọi được những lệnh đã khai báo trong tệp capabilities.",
      },
      "overflow: long title, host, many tags, long reason",
    ),
    card({ ...LINKS[2] }, "could not read (from an app)"),
    card(
      { ...base, summary: undefined, status: "ai-off" },
      "AI off (from an app)",
    ),
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
  // The note and the folder line (issue 186) start their own group of examples.
  const notices = el(doc, "div", "rec-wrap");
  notices.append(...noticeFolderStates(doc));
  return {
    nodes: [sw, out, states, notices, ...linkRowStates(doc, pasted)],
    column: true,
  };
}

/**
 * The card's "Already saved" note and its folder line (issue 186), with the request's sample (renamed: ui files never name the database engine): a
 * done card, "Embedded database - Wikipedia", filed by the app in "Dev tools".
 */
function noticeFolderStates(doc: Document): HTMLElement[] {
  const wiki: LinkItem = {
    title: "Embedded database - Wikipedia",
    url: "https://en.wikipedia.org/wiki/Embedded_database",
    site: "en.wikipedia.org",
    saved: "26 Nov 2026",
    status: "done",
    summary: "A database engine built into the app that uses it.",
  };
  const filed: LinkItem = {
    ...wiki,
    folder: "Dev tools",
    folderIsGuess: true,
  };
  const unread = { summary: undefined };
  const card = (item: LinkItem, caption: string, narrow = false) => {
    const box = state(doc, caption, createLinkCard(doc, item), { grow: true });
    if (narrow) box.classList.add("rec-narrow");
    return box;
  };
  return [
    card(wiki, "folder: none, no note"),
    card({ ...wiki, alreadySaved: true }, "already saved"),
    card(
      { ...filed, alreadySaved: true },
      "already saved, with a folder (Guess)",
    ),
    card(filed, "folder: Guess, on a done card"),
    card({ ...filed, ...unread, status: "pending" }, "folder: pending"),
    card({ ...filed, ...unread, status: "reading" }, "folder: reading"),
    card(
      {
        ...filed,
        ...unread,
        status: "unreadable",
        folder: "Unsorted",
        folderIsGuess: false,
      },
      "folder: could not read",
    ),
    card(
      {
        ...wiki,
        ...unread,
        status: "ai-off",
        folder: "Unsorted",
        folderIsGuess: false,
      },
      "folder: AI off, Unsorted, no label",
    ),
    card(
      {
        ...filed,
        folder:
          "Databases, storage engines and everything about local-first desktop apps",
      },
      "folder: long name on a narrow card",
      true,
    ),
    card(
      { ...filed, folder: "Cơ sở dữ liệu nhúng và công cụ phát triển" },
      "folder: Vietnamese name",
    ),
    ...folderReasonStates(wiki, card),
  ];
}

/**
 * The app's reason for the folder (issue 193), with the request's sample: "Dev tools" (Guess),
 * "It is a reference page for a database engine."
 */
function folderReasonStates(
  wiki: LinkItem,
  card: (item: LinkItem, caption: string, narrow?: boolean) => HTMLElement,
): HTMLElement[] {
  const why: LinkItem = {
    ...wiki,
    folder: "Dev tools",
    folderIsGuess: true,
    folderReason: "It is a reference page for a database engine.",
  };
  const unread = { summary: undefined };
  return [
    card(why, "folder reason: Guess, on a done card"),
    card(
      { ...why, ...unread, status: "pending" },
      "folder reason: pending, hidden (rule 1)",
    ),
    card(
      { ...why, ...unread, status: "unreadable" },
      "folder reason: could not read, hidden (rule 1)",
    ),
    card(
      { ...why, folderIsGuess: false },
      "folder reason: the owner moved it, not shown",
    ),
    card(
      {
        ...why,
        ...unread,
        status: "ai-off",
        folder: "Unsorted",
        folderIsGuess: false,
        folderReason: undefined,
      },
      "folder reason: AI off, Unsorted, none",
    ),
    card(
      {
        ...why,
        folderReason:
          "It is a reference page for a database engine that runs inside the app, with notes on storage formats, write-ahead logs and averyveryveryverylongwordthatwraps.",
      },
      "folder reason: long, on a narrow card",
      true,
    ),
    card(
      {
        ...why,
        folder: "Công cụ phát triển",
        folderReason:
          "Đây là trang tham khảo về một hệ quản trị cơ sở dữ liệu nhúng.",
      },
      "folder reason: Vietnamese",
    ),
  ];
}

/**
 * The List and Compact rows in each state (issue 171): the List row labels its summary, and both
 * rows leave out tags and the reason.
 */
function linkRowStates(doc: Document, pasted: LinkItem): HTMLElement[] {
  const unread = { summary: undefined, tags: undefined, reason: undefined };
  const overflow: LinkItem = {
    ...pasted,
    title:
      "Hướng dẫn đầy đủ về quyền và khả năng trong Tauri 2 — Ở ĐÂU, KHI NÀO, VÌ SAO cần giới hạn lệnh?",
    site: "rất-nhiều-tên-miền-con.tài-liệu.v2.tauri.app",
    summary:
      "Mỗi cửa sổ chỉ gọi được những lệnh đã khai báo trong tệp capabilities; lệnh nào không có trong danh sách sẽ bị lõi từ chối.",
    tags: ["tauri", "security", "rust", "ipc", "capabilities", "đặc-tả"],
    reason:
      "Có thể liên quan đến danh sách lệnh được phép của Mnemo, vì mỗi cửa sổ chỉ gọi được những lệnh đã khai báo.",
  };
  type Case = [LinkItem, string, LinkRowOptions?];
  // The request's samples (issue 172): a Telegram link, and links with no site, whose host comes
  // from the URL with or without its scheme.
  const telegram: LinkItem = { ...pasted, app: "telegram" };
  const noSite: LinkItem = {
    ...pasted,
    site: undefined,
    url: "https://v2.tauri.app/security/capabilities",
  };
  const noScheme: LinkItem = {
    ...noSite,
    url: "v2.tauri.app/security/capabilities",
  };
  // Hosts shorter than --size-link-site-min (8ch): the site's box is its own text width.
  const shortTg: LinkItem = {
    ...telegram,
    site: "t.me",
    url: "https://t.me/tauri_apps/1234",
  };
  const shortX: LinkItem = {
    ...pasted,
    site: "x.com",
    url: "https://x.com/tauriapps/status/1",
  };
  const listCases: Case[] = [
    [pasted, "done: summary Written by AI; tags and reason left out"],
    [
      telegram,
      "Telegram badge, site and date: on a narrow line the site and date wrap under the badge, together",
    ],
    [shortTg, "short host t.me with a Telegram badge: no gap before the date"],
    [shortX, "short host x.com: no gap before the date"],
    [noSite, "partial: no site, the host from a URL with https://"],
    [noScheme, "partial: no site, the host from a URL with no scheme"],
    [
      {
        ...pasted,
        summaryKind: "guess",
        summary: "Probably a guide to window permissions.",
      },
      "done: guessed summary, labelled Guess",
    ],
    [{ ...pasted, ...unread, status: "pending" }, "pending: no label"],
    [
      { ...pasted, ...unread, status: "reading" },
      "reading: spinner and words as a status, no label",
    ],
    [
      { ...pasted, ...unread, status: "unreadable" },
      "could not read: link only, no label",
    ],
    [
      { ...pasted, ...unread, status: "ai-off" },
      "AI off: no summary, no label",
    ],
    [
      { ...pasted, tags: undefined, reason: undefined },
      "partial: summary only",
    ],
    [
      { ...pasted, tagsKind: "owner", reasonKind: "owner" },
      "the owner's tags and reason: left out too",
    ],
    [
      overflow,
      "overflow: long title, summary and host; many tags and a long reason left out",
    ],
    [pasted, "hover", { forceState: "hover" }],
    [pasted, "focus-visible", { forceState: "focus" }],
    [
      overflow,
      "focus-visible: a cut host shows in full, wrapped",
      { forceState: "focus" },
    ],
    [pasted, "active", { forceState: "active" }],
  ];
  // The Compact row shows no summary, tags or reason, so it has no label in any status.
  const compactCases: Case[] = [
    [pasted, "done: title, site, date; nothing the app wrote, so no label"],
    [shortTg, "short host t.me"],
    [shortX, "short host x.com"],
    [noSite, "partial: no site, the host from a URL with https://"],
    [noScheme, "partial: no site, the host from a URL with no scheme"],
    [
      { ...pasted, site: undefined, url: "file:///home/me/notes/tauri.pdf" },
      "partial: no host (a file link), the date at the row's end",
    ],
    [{ ...pasted, ...unread, status: "pending" }, "pending"],
    [
      { ...pasted, ...unread, status: "reading" },
      "reading: spinner after the title, named Reading the page",
    ],
    [{ ...pasted, ...unread, status: "unreadable" }, "could not read"],
    [{ ...pasted, ...unread, status: "ai-off" }, "AI off"],
    [
      overflow,
      "overflow: long Vietnamese title and host; the title keeps 8ch and the host is cut first, the date wraps under the title in a narrow column",
    ],
    [
      { ...overflow, site: "t.me", url: "https://t.me/tauri_apps/1234" },
      "overflow: long title, short host t.me kept whole",
    ],
    [
      { ...overflow, title: "Go" },
      "short title, long host: the title box stops at 8ch, the host takes the rest",
    ],
    [
      { ...overflow, ...unread, status: "reading" },
      "reading, long title and host: the spinner stays on the title's line",
    ],
    [
      {
        ...pasted,
        ...unread,
        status: "reading",
        site: "github.io",
        url: "https://github.io/tauri-apps/plugins",
      },
      "reading, medium host github.io: in a narrow column the site and date wrap under the title, from its edge",
    ],
    [
      {
        ...pasted,
        ...unread,
        status: "reading",
        site: "example.org",
        url: "https://example.org/tauri/capabilities",
      },
      "reading, medium host example.org: in a narrow column the site and date wrap under the title, from its edge",
    ],
    [pasted, "hover", { forceState: "hover" }],
    [pasted, "focus-visible", { forceState: "focus" }],
    [
      overflow,
      "focus-visible: a cut host shows in full, wrapped",
      { forceState: "focus" },
    ],
    [pasted, "active", { forceState: "active" }],
  ];
  const block = (
    label: string,
    cases: Case[],
    build: (item: LinkItem, options?: LinkRowOptions) => HTMLElement,
  ) =>
    // Each row at the full width of the example column, as in the Bookmarks list.
    cases.map(([item, caption, options]) =>
      state(
        doc,
        `${label}: ${caption}`,
        createList(doc, `${label}, ${caption}`, [build(item, options)]),
        { grow: true },
      ),
    );
  return [
    ...block("List row", listCases, (item, options) =>
      createLinkRow(doc, item, options),
    ),
    ...block("Compact row", compactCases, (item, options) =>
      createCompactRow(doc, item, options),
    ),
  ];
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
    "markdown view": () => {
      const sample =
        "# Kế hoạch tuần 47\n- [ ] Viết test cho nhãn lồng nhau\n- [x] Đọc lại DEC-03\n\n```ts\nconst x = 1;\n```\n> Ghi chú: <script>alert(1)</script> <img src=x onerror=alert(1)>";
      const rich =
        "## Marks and lists\nSome **bold**, some *italic* and `inline code`, then a [link](https://example.com/docs) that only reports its click.\n\n- one\n  - nested\n    - deeper\n- two\n\n1. first\n2. second\n\n---\n\nAfter the rule.";
      const long = `${"averyveryveryverylongwordwithoutspaces".repeat(4)} and a URL https://example.com/${"a/very/long/path/".repeat(8)}\n\n\`\`\`ts\nconst wide = "${"x".repeat(120)}";\n\`\`\``;
      const md = (source: string, caption: string, extra = {}) =>
        state(doc, caption, createMarkdownView(doc, { source, ...extra }), {
          grow: true,
        });
      const focused = (source: string) => {
        const view = createMarkdownView(doc, { source });
        view.querySelector("a")?.classList.add("is-focus");
        view.querySelector("pre")?.classList.add("is-focus");
        return state(doc, "focus-visible on a link and a code block", view, {
          grow: true,
        });
      };
      return {
        nodes: [
          md(sample, "default, sample with script and onerror shown as text"),
          md(rich, "marks, lists, rule and a link"),
          md("", "empty"),
          md(long, "overflow: long word, long URL, wide code"),
          focused(
            "[the docs](https://example.com/docs)\n\n```ts\nconst x = 1;\n```",
          ),
        ],
        column: true,
      };
    },
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
