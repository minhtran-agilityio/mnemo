// The Surfaces tab: nav rail, status bar, page header, card, panel, divider, tabs, page, dialogs,
// approval sheet, tooltip and context menu (the popover is on the Controls tab). This file is the tab's renderer; the Surfaces
// agent owns it with ds/catalog/surfaces.ts, ds/catalog/surfaces.css and ds/components/surfaces.ts.

import {
  Bell,
  Bookmark,
  CalendarDays,
  CirclePause,
  FileText,
  Gauge,
  Kanban,
  MessageCircle,
  Network,
  Plus,
  PowerOff,
  Settings,
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
  createSidebar,
  createStaticTooltip,
  createStatusBar,
  createTabs,
  createTooltip,
  type NavRailGroup,
  type SidebarLink,
  type SidebarOptions,
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

/** The sample content of the sidebar: a few of the app's own items. Links stay on the page. */
const sbLink = (
  id: string,
  label: string,
  icon: SidebarLink["icon"],
  extra: Partial<SidebarLink> = {},
): SidebarLink => ({ id, label, href: "#/ui-catalog", icon, ...extra });

function sidebarSample(
  prefix: string,
  options: {
    collapsed?: boolean;
    bottomOpen?: boolean;
    hover?: string;
    focus?: string;
    longLabel?: boolean;
  } = {},
): SidebarOptions {
  const force = (id: string) =>
    options.hover === id
      ? { forceState: "hover" as const }
      : options.focus === id
        ? { forceState: "focus" as const }
        : {};
  return {
    label: `Main, ${prefix} example`,
    brand: "Mnemo",
    brandMark: "M",
    quick: sbLink("save", "Save or ask", Plus),
    searchLabel: "Search everything",
    idPrefix: prefix,
    collapsed: options.collapsed ?? false,
    bottomOpen: options.bottomOpen,
    groups: [
      {
        id: "daily",
        label: "Daily",
        items: [
          sbLink("today", "Today", CalendarDays, force("today")),
          sbLink("ask", "Ask Mnemo", MessageCircle, force("ask")),
        ],
      },
      {
        id: "library",
        label: "Library",
        items: [
          sbLink("bookmarks", "Bookmarks", Bookmark, force("bookmarks")),
          sbLink("notes", "Notes", StickyNote, force("notes")),
          sbLink("videos", "Videos", Video, { later: true }),
          sbLink(
            "quiet",
            options.longLabel
              ? "Quiet notifications from every connected app and calendar"
              : "Quiet notifications",
            Bell,
          ),
        ],
      },
    ],
    bottom: {
      label: "Apps and settings",
      icon: Network,
      items: [
        sbLink("apps", "Apps and account", Network),
        sbLink("ai", "AI control", Gauge),
        sbLink("settings", "Settings", Settings),
      ],
    },
  };
}

export const renderSurfaces: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  const text = (cls: string, value: string) => el(doc, "span", cls, value);
  // A result of a demo shows as a real toast from the Feedback toast region.
  const result = (message: string) => ctx.toast(message);

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
        main.append(text("srf-muted", "current, hover (Notes), Later"));
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

      sidebar: () => {
        const framed = (options: SidebarOptions, current: string) => {
          const bar = createSidebar(doc, options);
          bar.setCurrent(current);
          const box = el(doc, "div", "frame frame-sidebar");
          box.append(bar.element);
          return box;
        };
        return [
          state(
            doc,
            "open, current, hover (Notes), Later (live: the toggle folds it)",
            framed(
              sidebarSample("cat-sb-open", { hover: "notes" }),
              "bookmarks",
            ),
          ),
          state(
            doc,
            "collapsed: icons with tooltips",
            framed(
              sidebarSample("cat-sb-collapsed", { collapsed: true }),
              "bookmarks",
            ),
          ),
          state(
            doc,
            "focus-visible (Ask Mnemo), bottom list open",
            framed(
              sidebarSample("cat-sb-focus", { focus: "ask", bottomOpen: true }),
              "settings",
            ),
          ),
          state(
            doc,
            "long label: one line, cut by the sidebar",
            framed(sidebarSample("cat-sb-long", { longLabel: true }), "quiet"),
          ),
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
          wide: true,
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
              result(`Renamed to "${input.value}".`);
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
          state(doc, "live: focus trapped, Escape closes", [open]),
          state(doc, "drawn in the page", sample, { grow: true }),
        ];
      },

      "confirm dialog": () => {
        const options = {
          title: 'Delete the folder "Đọc sau"?',
          message: "This deletes everything inside it. It cannot be restored:",
          lose: ["42 links", "3 notes"],
          keepLabel: "Keep folder",
          confirmLabel: "Delete 45 items",
          onConfirm: () => {
            result("Folder deleted. 45 items removed. (Catalog only.)");
          },
          onKeep: () => {
            result("Kept.");
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
        const resetOptions = {
          title: "Reset Mnemo?",
          message:
            "This deletes everything and makes no backup. Use Export or the backup command first.",
          lose: [
            "all notes, links, ideas, projects, tasks, events, runs, memories, labels, files and settings (theme included)",
          ],
          keepLabel: "Cancel",
          confirmLabel: "Reset",
          typeToConfirm: { word: "RESET", label: "Type RESET to confirm" },
          onConfirm: () => {
            result("Reset. (Catalog only.)");
          },
          onKeep: () => {
            result("Cancelled.");
          },
        } as const;
        const resetDialog = createConfirmDialog(resetOptions);
        ctx.signal.addEventListener("abort", () => resetDialog.close());
        const openReset = button(doc, "btn", "Reset Mnemo…");
        openReset.addEventListener("click", () => resetDialog.open(openReset));
        const resetSample = createConfirmSample({
          ...resetOptions,
          onConfirm: () => {},
          onKeep: () => {},
        });
        const enabledSample = createConfirmSample({
          ...resetOptions,
          onConfirm: () => {},
          onKeep: () => {},
        });
        const typedInput = enabledSample.querySelector("input");
        if (typedInput) {
          typedInput.value = "RESET";
          typedInput.dispatchEvent(new Event("input"));
        }
        return [
          state(doc, "live: safe button has the focus", [open]),
          state(doc, "drawn in the page", sample, { grow: true }),
          state(
            doc,
            "type to confirm, word typed: confirm enabled",
            enabledSample,
            {
              grow: true,
            },
          ),
          state(doc, "type to confirm, live: confirm off until RESET", [
            openReset,
          ]),
          state(doc, "type to confirm, drawn in the page", resetSample, {
            grow: true,
          }),
        ];
      },

      "approval sheet": () => {
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
            result("Approved. Catalog only: nothing was moved.");
          },
          onDecline: () => {
            result("Declined. Nothing changed.");
          },
        } as const;
        const sheet = createApprovalSheet(options);
        ctx.signal.addEventListener("abort", () => sheet.close());
        const open = button(doc, "btn", "Review the plan…");
        open.addEventListener("click", () => sheet.open(open));
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
          state(doc, "live (modal)", [open]),
        ];
      },

      tooltip: () => {
        const anchor = button(doc, "btn", "Copy");
        const tip = createTooltip(anchor, "Copy link");
        // Room above the anchor, so the tip is drawn inside the example and no scroll box cuts it.
        const room = el(doc, "div", "tip-room");
        room.append(tip.element);
        return [
          state(doc, "live: hover or focus the button", room),
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
        const say = (word: string) => () => {
          result(`Chose "${word}". Catalog only.`);
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
            [list, menu.element],
            {
              grow: true,
            },
          ),
        ];
      },
    }),
  );
};
