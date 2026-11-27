// The sidebar's content: every group and item with its phase and Later mark, plus the icons.
// Phases come from the roadmap (https://claude.ai/artifact/Q7awHkWEPD75CfJ3xZksJH); Later marks
// are Files (PDF) and Videos (the prototype) and Shared (the roadmap marks LATER-03 as Later).
// There is no Tags group and no count or badge: the owner left them out of APP-02.

/** One SVG shape: its tag and attributes. Icons are drawn from these, never from markup text. */
export type IconShape = readonly [
  tag: "path" | "circle" | "rect",
  attrs: Readonly<Record<string, string>>,
];

/** A link in the sidebar: its name and icon, and a Later mark for a roadmap feature. */
export interface SidebarItem {
  id: string;
  label: string;
  /** True when the roadmap marks the feature Later. */
  later?: boolean;
  icon: readonly IconShape[];
}

/** A roadmap screen: a sidebar item plus the roadmap phase that builds it. */
export interface NavItem extends SidebarItem {
  /** The roadmap phase that builds this screen. */
  phase: number;
}

/** A titled list of sidebar items. */
export interface SidebarGroup {
  id: string;
  label: string;
  items: readonly SidebarItem[];
}

/** A group of roadmap screens. */
export interface NavGroup extends SidebarGroup {
  items: readonly NavItem[];
}

/** The id of the item that opens the Everything screen, which search routes to. */
export const EVERYTHING_ID = "everything";
/** The id of the 'Save or ask' screen. */
export const SAVE_OR_ASK_ID = "save-or-ask";
/** The screen a missing or unknown address opens. */
export const HOME_ID = "today";

export const SAVE_OR_ASK: NavItem = {
  id: SAVE_OR_ASK_ID,
  label: "Save or ask",
  phase: 2,
  icon: [["path", { d: "M12 5v14M5 12h14" }]],
};

export const GROUPS: readonly NavGroup[] = [
  {
    id: "daily",
    label: "Daily",
    items: [
      {
        id: "today",
        label: "Today",
        phase: 3,
        icon: [
          ["circle", { cx: "12", cy: "12", r: "4" }],
          [
            "path",
            {
              d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
            },
          ],
        ],
      },
      {
        id: "ask-mnemo",
        label: "Ask Mnemo",
        phase: 2,
        icon: [
          [
            "path",
            {
              d: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z",
            },
          ],
        ],
      },
      {
        id: "calendar",
        label: "Calendar",
        phase: 3,
        icon: [
          ["rect", { x: "3", y: "5", width: "18", height: "16", rx: "2" }],
          ["path", { d: "M16 3v4M8 3v4M3 10h18" }],
        ],
      },
      {
        id: "daily-digest",
        label: "Daily digest",
        phase: 5,
        icon: [
          ["path", { d: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" }],
          ["circle", { cx: "5", cy: "19", r: "1" }],
        ],
      },
      {
        id: "goals",
        label: "Goals",
        phase: 3,
        icon: [
          ["circle", { cx: "12", cy: "12", r: "9" }],
          ["circle", { cx: "12", cy: "12", r: "5" }],
          ["circle", { cx: "12", cy: "12", r: "1" }],
        ],
      },
      {
        id: "trending",
        label: "Trending",
        phase: 6,
        icon: [
          ["path", { d: "M3 17l6-6 4 4 8-8" }],
          ["path", { d: "M15 7h6v6" }],
        ],
      },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      {
        id: "bookmarks",
        label: "Bookmarks",
        phase: 2,
        icon: [
          ["path", { d: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" }],
        ],
      },
      {
        id: "deep-research",
        label: "Deep research",
        phase: 6,
        icon: [
          ["circle", { cx: "10.5", cy: "10.5", r: "6.5" }],
          ["path", { d: "M20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6" }],
        ],
      },
      {
        id: "notes",
        label: "Notes",
        phase: 3,
        icon: [
          [
            "path",
            { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" },
          ],
          ["path", { d: "M14 3v5h5M9 13h6M9 17h6" }],
        ],
      },
      {
        id: "ideas",
        label: "Ideas",
        phase: 3,
        icon: [
          ["path", { d: "M9 18h6M10 21h4" }],
          [
            "path",
            {
              d: "M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.5 1 2.5h6c0-1 .2-1.8 1-2.5A6 6 0 0 0 12 3z",
            },
          ],
        ],
      },
      {
        id: "projects",
        label: "Projects",
        phase: 3,
        icon: [
          ["rect", { x: "3", y: "4", width: "5", height: "16", rx: "1.5" }],
          ["rect", { x: "10", y: "4", width: "5", height: "10", rx: "1.5" }],
          ["rect", { x: "17", y: "4", width: "4", height: "13", rx: "1.5" }],
        ],
      },
      {
        id: "files",
        label: "Files (PDF)",
        phase: 7,
        later: true,
        icon: [
          [
            "path",
            {
              d: "M21 11.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8",
            },
          ],
        ],
      },
      {
        id: "videos",
        label: "Videos",
        phase: 7,
        later: true,
        icon: [
          ["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }],
          ["path", { d: "M10 9l5 3-5 3z" }],
        ],
      },
      {
        id: "shared",
        label: "Shared",
        phase: 7,
        later: true,
        icon: [
          ["circle", { cx: "9", cy: "8", r: "3" }],
          ["path", { d: "M3 20a6 6 0 0 1 12 0" }],
          ["path", { d: "M16 5.2a3 3 0 0 1 0 5.6M18 14.5a6 6 0 0 1 3 5.5" }],
        ],
      },
      {
        id: "learning",
        label: "Learning",
        phase: 6,
        icon: [
          ["path", { d: "M2 9l10-5 10 5-10 5z" }],
          ["path", { d: "M6 11v5c3 2 9 2 12 0v-5" }],
          ["path", { d: "M22 9v6" }],
        ],
      },
      {
        id: "everything",
        label: "Everything",
        phase: 2,
        icon: [
          [
            "path",
            { d: "M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5" },
          ],
          ["path", { d: "M8 7h7" }],
        ],
      },
    ],
  },
  {
    id: "life",
    label: "Life",
    items: [
      {
        id: "workout",
        label: "Workout",
        phase: 7,
        icon: [["path", { d: "M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" }]],
      },
      {
        id: "diary",
        label: "Diary",
        phase: 7,
        icon: [
          ["rect", { x: "5", y: "11", width: "14", height: "9", rx: "2" }],
          ["path", { d: "M8 11V8a4 4 0 0 1 8 0v3" }],
        ],
      },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    items: [
      {
        id: "about-me",
        label: "About me",
        phase: 6,
        icon: [
          ["circle", { cx: "12", cy: "8", r: "4" }],
          ["path", { d: "M4 21a8 8 0 0 1 16 0" }],
        ],
      },
      {
        id: "graph",
        label: "Graph",
        phase: 6,
        icon: [
          ["circle", { cx: "6", cy: "6", r: "2.5" }],
          ["circle", { cx: "18", cy: "8", r: "2.5" }],
          ["circle", { cx: "10", cy: "18", r: "2.5" }],
          ["path", { d: "M8.2 7.2l7.5.6M7 8.3l2.2 7.3M16.5 10l-5 6" }],
        ],
      },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    items: [
      {
        id: "background-runs",
        label: "Background runs",
        phase: 5,
        icon: [
          ["circle", { cx: "12", cy: "12", r: "9" }],
          ["path", { d: "M12 7v5l3 2" }],
        ],
      },
      {
        id: "needs-approval",
        label: "Needs approval",
        phase: 5,
        icon: [["path", { d: "M4 12l5 5L20 6" }]],
      },
      {
        id: "mnemo-memory",
        label: "Mnemo memory",
        phase: 5,
        icon: [
          ["path", { d: "M6 3h9l3 3v15H6z" }],
          ["path", { d: "M9 10h6M9 14h6M9 18h4" }],
        ],
      },
      {
        id: "daily-report",
        label: "Daily report",
        phase: 4,
        icon: [
          ["path", { d: "M4 4h16v16H4z" }],
          ["path", { d: "M8 9h8M8 13h8M8 17h5" }],
        ],
      },
      {
        id: "quiet-notifications",
        label: "Quiet notifications",
        phase: 5,
        icon: [
          ["path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }],
          ["path", { d: "M10.3 21a1.9 1.9 0 0 0 3.4 0" }],
        ],
      },
    ],
  },
];

/** The id of the UI Catalog screen. Its address is `#/ui-catalog`. */
export const UI_CATALOG_ID = "ui-catalog";

/**
 * The dev-only groups: tools for building Mnemo, not roadmap screens, so their items have no
 * phase. Today that is Storehouse, with one item that opens the UI Catalog. The list is empty in
 * a release build: the `import.meta.env.DEV` test is replaced by `false` there, so the groups,
 * their labels and their items are dropped from the bundle.
 */
export const DEV_GROUPS: readonly SidebarGroup[] = import.meta.env.DEV
  ? [
      {
        id: "storehouse",
        label: "Storehouse",
        items: [
          {
            id: UI_CATALOG_ID,
            label: "UI Catalog",
            icon: [
              ["rect", { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }],
              ["rect", { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }],
              ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "1.5" }],
              [
                "rect",
                { x: "14", y: "14", width: "7", height: "7", rx: "1.5" },
              ],
            ],
          },
        ],
      },
    ]
  : [];

/** The list that opens and closes at the bottom of the sidebar. */
export const APPS_LABEL = "Apps and settings";
export const APPS_ITEMS: readonly NavItem[] = [
  {
    id: "apps-account",
    label: "Apps and account",
    phase: 4,
    icon: [
      ["circle", { cx: "12", cy: "12", r: "3" }],
      ["circle", { cx: "5", cy: "5", r: "2" }],
      ["circle", { cx: "19", cy: "5", r: "2" }],
      ["circle", { cx: "12", cy: "21", r: "1.6" }],
      ["path", { d: "M6.5 6.5l3.3 3.3M17.5 6.5l-3.3 3.3M12 15v4.4" }],
    ],
  },
  {
    id: "ai-control",
    label: "AI control",
    phase: 1,
    icon: [
      ["path", { d: "M4 18a8 8 0 1 1 16 0" }],
      ["path", { d: "M12 18l4-6" }],
    ],
  },
  {
    id: "settings",
    label: "Settings",
    phase: 1,
    icon: [
      ["circle", { cx: "12", cy: "12", r: "3" }],
      [
        "path",
        {
          d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
        },
      ],
    ],
  },
];

/** Every screen the router can open. */
export const ALL_ITEMS: readonly NavItem[] = [
  SAVE_OR_ASK,
  ...GROUPS.flatMap((g) => g.items),
  ...APPS_ITEMS,
];

export function findItem(id: string): NavItem | undefined {
  return ALL_ITEMS.find((item) => item.id === id);
}

/**
 * A page reached from inside a screen, not from the sidebar: it has its own address, and the
 * sidebar marks its parent screen while it is open.
 */
export interface PageItem extends NavItem {
  /** The sidebar item marked while the page is open. */
  parent: string;
}

/** The id of the Import bookmarks page (#29), reached from Bookmarks. Address `#/import`. */
export const IMPORT_ID = "import";

/** Every page outside the sidebar. The router opens them; the sidebar does not list them. */
export const PAGE_ITEMS: readonly PageItem[] = [
  {
    id: IMPORT_ID,
    label: "Import bookmarks",
    phase: 2,
    parent: "bookmarks",
    icon: [],
  },
];

/** The page `id`, or undefined. */
export function findPage(id: string): PageItem | undefined {
  return PAGE_ITEMS.find((item) => item.id === id);
}

/** The sidebar item to mark for `id`: a page's parent, else the item itself. */
export function sidebarIdFor(id: string): string {
  return findPage(id)?.parent ?? id;
}

/** Every group the sidebar shows, in order: the roadmap groups, then the dev-only ones. */
export const SIDEBAR_GROUPS: readonly SidebarGroup[] = [
  ...GROUPS,
  ...DEV_GROUPS,
];

/** The dev-only items. The router opens them too. A release build has none. */
export const DEV_ITEMS: readonly SidebarItem[] = DEV_GROUPS.flatMap(
  (g) => g.items,
);

/** True for a roadmap screen, which has a phase. False for a dev-only tool. */
export function isRoadmapItem(item: SidebarItem): item is NavItem {
  return "phase" in item;
}

/** The address that opens an item. The router reads it back. */
export function hashItemPath(id: string): string {
  return `#/${id}`;
}
