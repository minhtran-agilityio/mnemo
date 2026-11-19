// The Surfaces tab: nav rail, status bar, page header, card, panel, divider, tabs, page, dialogs,
// approval sheet, popover, tooltip and context menu. This file is the tab's renderer; the Surfaces
// agent owns it with ds/catalog/surfaces.ts, ds/catalog/surfaces.css and ds/components/surfaces.ts.

import {
  Bookmark,
  CalendarDays,
  CirclePause,
  FileText,
  Kanban,
  MessageCircle,
  PowerOff,
  Share2,
  StickyNote,
  TriangleAlert,
  Video,
} from "lucide";
import "../../../ds/catalog/surfaces.css";
import {
  createApprovalSample,
  createApprovalSheet,
  createCard,
  createConfirmDialog,
  createConfirmSample,
  createContextMenu,
  createDialog,
  createDialogButton,
  createDialogSample,
  createDivider,
  createNavRail,
  createPage,
  createPageHeader,
  createPanel,
  createPopover,
  createStaticTooltip,
  createStatusBar,
  createTabs,
  createTooltip,
  type NavRailGroup,
} from "../../../ds/index";
import { button, el, entryRows, state, type TabRenderer } from "../parts";

const NAV_GROUPS: readonly NavRailGroup[] = [
  {
    label: "Daily",
    items: [
      { id: "today", label: "Today", icon: CalendarDays },
      { id: "ask", label: "Ask Mnemo", icon: MessageCircle },
    ],
  },
  {
    label: "Library",
    items: [
      { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
      { id: "notes", label: "Notes", icon: StickyNote, hover: true },
      { id: "files", label: "Files (PDF)", icon: FileText, later: true },
      { id: "videos", label: "Videos", icon: Video, later: true },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { id: "board", label: "Board", icon: Kanban },
      { id: "graph", label: "Graph", icon: Share2 },
    ],
  },
];

const NAV_GROUPS_COLLAPSED: readonly NavRailGroup[] = [
  { label: "Daily", items: NAV_GROUPS[0]?.items.slice() ?? [] },
  {
    label: "Library",
    items: (NAV_GROUPS[1]?.items ?? [])
      .filter((i) => i.id !== "videos")
      .map((i) => ({ ...i, hover: false })),
  },
  {
    label: "Knowledge",
    items: [{ id: "board", label: "Board", icon: Kanban }],
  },
];

export const renderSurfaces: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  const text = (cls: string, value: string) => el(doc, "span", cls, value);
  const result = () => {
    const out = el(doc, "span", "srf-result");
    out.setAttribute("role", "status");
    return out;
  };

  panel.append(
    entryRows(ctx, "Surfaces", {
      "nav rail": () => {
        const frame = (rail: HTMLElement, main?: Node) => {
          const box = el(doc, "div", "frame");
          box.append(rail);
          if (main) box.append(main);
          return box;
        };
        const open = createNavRail({
          label: "Main",
          groups: NAV_GROUPS,
          current: "bookmarks",
        });
        const main = el(doc, "div", "frame-main");
        main.append(text("srf-result", "current, hover (Notes), Later"));
        const collapsed = createNavRail({
          label: "Main, collapsed example",
          groups: NAV_GROUPS_COLLAPSED,
          collapsed: true,
          current: "bookmarks",
        });
        return [
          state(
            doc,
            "open (live: the panel button folds it)",
            frame(open.element, main),
            {
              grow: true,
            },
          ),
          state(doc, "collapsed", frame(collapsed.element)),
        ];
      },

      "status bar": () => {
        const bars = [
          {
            caption: "ready",
            items: [
              { dot: "good", text: "AI ready" },
              { mono: true, text: "32% used" },
              { text: "Saved 2 min ago" },
              { push: true, text: "1,284 links · 96 notes" },
            ],
          },
          {
            caption: "busy, near the limit, saving",
            items: [
              { dot: "accent", pulse: true, text: "Summarising 2 links" },
              {
                icon: TriangleAlert,
                mono: true,
                text: "62% used",
                tone: "warn",
              },
              { text: "Saving…" },
            ],
          },
          {
            caption: "AI off",
            items: [
              { icon: PowerOff, text: "AI off" },
              { text: "Saved just now" },
              {
                push: true,
                action: { label: "Turn AI on", onAction: () => {} },
              },
            ],
          },
          {
            caption: "at usage limit",
            items: [
              {
                icon: CirclePause,
                text: "At usage limit · AI resumes at 14:00",
                tone: "bad",
              },
              { text: "Links still save, with no summary" },
            ],
          },
        ] as const;
        return {
          column: true,
          nodes: bars.map((bar) =>
            state(
              doc,
              bar.caption,
              createStatusBar({
                items: bar.items,
                label: `Status, ${bar.caption}`,
              }),
              { grow: true },
            ),
          ),
        };
      },

      "page header": () => {
        const header = createPageHeader({
          crumb: "Library",
          title: "Bookmarks",
          context: "1,284 links · 12 folders",
          actions: [
            button(doc, "btn", "Import"),
            button(doc, "btn btn-primary", "Save link"),
          ],
        });
        return [
          state(doc, "crumb, title, context, actions", header, { grow: true }),
        ];
      },

      card: () => {
        const card = createCard({
          title: "Daily digest",
          children: [
            el(
              doc,
              "p",
              "srf-muted",
              "7 new links from Telegram and Slack since yesterday.",
            ),
            createDivider(doc),
            button(doc, "btn btn-sm", "Open"),
          ],
        });
        return [state(doc, "default", card, { grow: true })];
      },

      panel: () => {
        const sample = createPanel({
          title: "Details",
          children: [
            el(doc, "span", "srf-muted", "Saved 19 Nov 2026, 08:14 from Zalo."),
          ],
        });
        return [state(doc, "default", sample, { grow: true })];
      },

      divider: () => [
        state(doc, "default", createDivider(doc), { grow: true }),
      ],

      tabs: () => {
        const tabs = createTabs({
          label: "Note view",
          tabs: [
            { id: "write", label: "Write" },
            { id: "preview", label: "Preview" },
            { id: "history", label: "History (Later)", disabled: true },
          ],
        });
        return [
          state(
            doc,
            "live: arrows, Home, End; History is disabled",
            tabs.element,
            { grow: true },
          ),
        ];
      },

      page: () => {
        const page = createPage({
          children: [
            el(
              doc,
              "p",
              undefined,
              "The page is the reading column. It keeps lines to about seventy characters so long text stays easy to read.",
            ),
          ],
        });
        return [state(doc, "default", page, { grow: true })];
      },

      dialog: () => {
        const out = result();
        const input = el(doc, "input", "input");
        input.id = "srf-rename";
        input.value = "Đọc sau";
        input.required = true;
        const label = el(doc, "label", "field", "Name");
        label.htmlFor = input.id;
        label.append(input);
        const submitButton = createDialogButton(
          "Rename",
          "primary",
          undefined,
          doc,
        );
        submitButton.type = "submit";
        const dialog = createDialog({
          title: "Rename folder",
          form: {
            onSubmit: () => {
              out.textContent = `Renamed to "${input.value}".`;
            },
          },
          children: [label],
          actions: (close) => [
            createDialogButton("Cancel", "default", close, doc),
            submitButton,
          ],
        });
        ctx.signal.addEventListener("abort", () => dialog.close());
        const open = button(doc, "btn", "Rename folder…");
        open.addEventListener("click", () => dialog.open(open));
        const sample = createDialogSample({
          title: "Rename folder",
          label: "Dialog example",
          children: [el(doc, "p", undefined, "Name: Đọc sau")],
          actions: [
            createDialogButton("Cancel", "default", undefined, doc),
            createDialogButton("Rename", "primary", undefined, doc),
          ],
        });
        return [
          state(doc, "live: focus trapped, Escape closes", [open, out]),
          state(doc, "drawn in the page", sample, { grow: true }),
        ];
      },

      "confirm dialog": () => {
        const out = result();
        const options = {
          title: 'Delete the folder "Đọc sau"?',
          message: "This deletes everything inside it. It cannot be restored:",
          lose: ["42 links", "3 notes"],
          keepLabel: "Keep folder",
          confirmLabel: "Delete 45 items",
          onConfirm: () => {
            out.textContent =
              "Folder deleted. 45 items removed. (Catalog only.)";
          },
          onKeep: () => {
            out.textContent = "Kept.";
          },
        } as const;
        const dialog = createConfirmDialog(options);
        ctx.signal.addEventListener("abort", () => dialog.close());
        const open = button(doc, "btn", "Delete folder…");
        open.addEventListener("click", () => dialog.open(open));
        const sample = createConfirmSample({
          ...options,
          lose: ["42 links", "3 notes"],
          message:
            "This deletes 42 links and 3 notes inside it. They cannot be restored.",
          onConfirm: () => {},
          onKeep: () => {},
        });
        return [
          state(doc, "live: safe button has the focus", [open, out]),
          state(doc, "drawn in the page", sample, { grow: true }),
        ];
      },

      "approval sheet": () => {
        const out = result();
        const options = {
          where: "Google Drive",
          title: 'Move 3 files into "Mnemo / 2026"?',
          plan: [
            [
              "Move ",
              { code: "bao-cao-q3.pdf" },
              " from My Drive to ",
              { code: "Mnemo/2026" },
            ],
            [
              "Move ",
              { code: "hop-dong-thue-nha.pdf" },
              " from My Drive to ",
              { code: "Mnemo/2026" },
            ],
            [
              "Move ",
              { code: "scan_0042.jpg" },
              " from Downloads to ",
              { code: "Mnemo/2026" },
            ],
          ],
          note: "Nothing is deleted. You can move them back in Drive.",
          declineLabel: "Not now",
          approveLabel: "Approve and move 3 files",
          onApprove: () => {
            out.textContent = "Approved. Catalog only: nothing was moved.";
          },
          onDecline: () => {
            out.textContent = "Declined. Nothing changed.";
          },
        } as const;
        const sheet = createApprovalSheet(options);
        ctx.signal.addEventListener("abort", () => sheet.close());
        const open = button(doc, "btn", "Review the plan…");
        open.addEventListener("click", () => sheet.open(open));
        out.textContent = "Waiting: nothing happens until you approve.";
        return [
          state(
            doc,
            "drawn in the page, waiting",
            createApprovalSample({
              ...options,
              onApprove: () => {},
              onDecline: () => {},
            }),
            { grow: true },
          ),
          state(doc, "live (modal)", [open, out]),
        ];
      },

      popover: () => {
        const guess = el(doc, "span", "trust trust-guess", "Guess");
        const pop = createPopover({
          trigger: "Why this folder?",
          label: "Why this folder",
          children: [
            guess,
            el(
              doc,
              "p",
              undefined,
              "The page talks about Tauri and Rust, like 18 links already in Work / Mnemo.",
            ),
          ],
        });
        ctx.signal.addEventListener("abort", () => pop.close(false));
        return [
          state(doc, "live: Escape or a click outside closes", pop.element),
        ];
      },

      tooltip: () => {
        const anchor = button(doc, "btn", "Copy");
        const tip = createTooltip(anchor, "Copy link");
        return [
          state(doc, "live: hover or focus the button", tip.element),
          state(doc, "shown", createStaticTooltip("Copy link")),
        ];
      },

      "context menu": () => {
        const list = el(doc, "ul", "list");
        list.setAttribute("aria-label", "Context menu example");
        const row = el(doc, "li", "row");
        row.tabIndex = 0;
        row.append(
          el(doc, "span", "row-title", "Tauri 2: capabilities and permissions"),
          el(doc, "span", "row-meta", "2 d"),
        );
        list.append(row);
        const out = result();
        const say = (word: string) => () => {
          out.textContent = `Chose "${word}". Catalog only.`;
        };
        const menu = createContextMenu({
          label: "Link actions",
          target: row,
          items: [
            { label: "Open", onSelect: say("Open") },
            { label: "Copy link", onSelect: say("Copy link") },
            { label: "Move to folder…", onSelect: say("Move to folder") },
            {
              label: "Delete…",
              danger: true,
              separated: true,
              onSelect: say("Delete"),
            },
          ],
        });
        ctx.signal.addEventListener("abort", () => menu.destroy());
        return [
          state(
            doc,
            "live: right-click the row, or Shift+F10",
            [list, menu.element, out],
            {
              grow: true,
            },
          ),
        ];
      },
    }),
  );
};
