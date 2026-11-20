// The Limits tab: messy content and small windows, drawn with the real parts. The narrow preview
// has a width slider, the owner's sidebar choice and 200% zoom; the 1000 rows are built on request.

import { Bell, Link, Plus } from "lucide";
import "../../../ds/catalog/limits.css";
import {
  buildBanner,
  buildPill,
  buildProgress,
  buildSpinner,
  buildTrustLabel,
  createButton,
  createCheckbox,
  createChoiceList,
  createKanbanCard,
  createKanbanColumn,
  createLinkCard,
  createList,
  createListRow,
  createMetaLine,
  createNavRail,
  createPageHeader,
  createSectionList,
  createSidebar,
  createSourceList,
  createStatusBar,
  createTagList,
  createTree,
  type PillTint,
} from "../../../ds/index";
import {
  el,
  entryRows,
  state,
  type TabContext,
  type TabRenderer,
} from "../parts";

/** The window sizes the preview marks: the smallest the app allows and the size it starts at. */
const SMALLEST = 800;
const START = 900;
/** What the open and the collapsed sidebar leave of the window (the shipped sidebar widths). */
const RAIL_OPEN = 260;
const RAIL_COLLAPSED = 72;
/** Below this much room for the page the preview says so. */
const ROOM_WARN = 480;

const LONG_TITLE =
  "How we cut cold start from 1.8 s to 240 ms in a Tauri 2 desktop app on Ubuntu 22.04 with WebKitGTK, and what we learned about lazy-loading screens, bundling fonts locally, and keeping the Rust core small (part 3 of 7)";

const URLS = [
  "https://www.example.com/a/very/long/path/with-segments/that-never-end/2026/11/19/bai-viet-ve-tieng-viet?utm_source=newsletter&utm_medium=email&utm_campaign=autumn_2026&fbclid=IwAR3xYz_9kLmN0pQ&ref=xyz#section-%C4%91%E1%BA%A7u-ti%C3%AAn",
  "https://vi.wikipedia.org/wiki/Th%C3%A0nh_ph%E1%BB%91_H%E1%BB%93_Ch%C3%AD_Minh",
  "https://xn--ngn-hng-nh-nc-qrb7a.vn/tin-tuc",
  "docs.google.com/document/d/1aBcD3fGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing&ouid=10293847561029384756",
  "HTTP://EXAMPLE.COM:8080/../a//b/./c?x=1&x=2&&y=",
];

const WORDS = [
  "Tauri",
  "Rust",
  "WebKitGTK",
  "Tiếng Việt",
  "FTS5",
  "Kanban",
  "Ghi chú",
  "Đọc sau",
  "Telegram",
  "Zalo",
];

/** A button that shows or hides the full value under it. */
function fullValue(
  ctx: TabContext,
  value: string,
  closed: string,
  open: string,
): Node[] {
  const doc = ctx.doc;
  const box = el(doc, "div", "lim-full", value);
  box.hidden = true;
  const toggle = createButton(doc, {
    label: closed,
    size: "sm",
    variant: "ghost",
    onClick: () => {
      box.hidden = !box.hidden;
      toggle.setAttribute("aria-expanded", String(!box.hidden));
      toggle.textContent = box.hidden ? closed : open;
    },
  });
  toggle.setAttribute("aria-expanded", "false");
  toggle.classList.add("lim-self-start");
  return [toggle, box];
}

/** The narrow-width preview: a mini window whose width, sidebar and zoom the owner sets. */
function narrowPreview(ctx: TabContext): Node[] {
  const doc = ctx.doc;
  const idBase = "lim-wid";

  const range = el(doc, "input");
  range.type = "range";
  range.id = idBase;
  range.min = "600";
  range.max = "1280";
  range.step = "10";
  range.value = String(START);
  range.setAttribute("list", `${idBase}-marks`);
  const marks = el(doc, "datalist");
  marks.id = `${idBase}-marks`;
  for (const v of [SMALLEST, START]) {
    const o = el(doc, "option");
    o.value = String(v);
    o.label = String(v);
    marks.append(o);
  }
  const widthLabel = el(doc, "label", "lim-label", "Window width ");
  widthLabel.htmlFor = idBase;
  const out = el(doc, "output", "mono num");
  out.setAttribute("for", idBase);
  widthLabel.append(out);

  const collapse = createCheckbox(doc, {
    label: "Sidebar collapsed (owner's choice)",
  });
  const zoom = createCheckbox(doc, { label: "Zoom 200%" });
  const status = el(doc, "span", "lim-status");
  status.setAttribute("role", "status");

  const ctl = el(doc, "div", "lim-ctl");
  ctl.append(widthLabel, range, marks, collapse.label, zoom.label, status);

  const legend = el(doc, "div", "lim-marks");
  for (const [n, text] of [
    [SMALLEST, "smallest window"],
    [START, "start size"],
  ] as const) {
    const m = el(doc, "span");
    m.append(el(doc, "b", "mono", String(n)), ` ${text}`);
    legend.append(m);
  }

  const rail = createNavRail({
    doc,
    label: "Preview menu",
    groups: [
      {
        label: "Library",
        items: [
          { id: "bookmarks", label: "Bookmarks", icon: Link },
          { id: "notes", label: "Notes", icon: Link },
          { id: "videos", label: "Videos", icon: Link, later: true },
        ],
      },
    ],
    current: "bookmarks",
    onToggle: (collapsed) => {
      collapse.input.checked = collapsed;
      update();
    },
  });
  const main = el(doc, "div", "frame-main");
  main.append(
    createPageHeader({
      doc,
      crumb: "Library",
      title: "Bookmarks",
      actions: [
        createButton(doc, {
          label: "Save link",
          variant: "primary",
          icon: Plus,
        }),
      ],
    }),
    buildBanner({
      tone: "warn",
      lead: "62% of usage used.",
      message: "Background jobs pause at 95%.",
      action: { label: "See usage", onClick: () => {} },
    }),
    createList(doc, "Preview links", [
      createListRow(doc, {
        title:
          "Tổng hợp những bài viết hay nhất về kiến trúc phần mềm năm 2026",
        meta: "2 d",
        icon: Link,
      }),
    ]),
  );
  const mini = el(doc, "div", "lim-mini");
  mini.append(rail.element, main);
  const preview = el(doc, "div", "lim-preview");
  preview.append(
    mini,
    createStatusBar({
      doc,
      label: "Preview status",
      items: [
        { dot: "good", text: "AI ready" },
        { text: "32% used", mono: true },
        { text: "Saved 2 min ago" },
      ],
    }),
  );
  const scroll = el(doc, "div", "lim-scroll");
  scroll.append(preview);

  function update() {
    const w = Number(range.value);
    const z = zoom.input.checked ? 2 : 1;
    const eff = Math.round(w / z);
    const col = collapse.input.checked;
    preview.style.width = `${w}px`;
    preview.classList.toggle("lim-zoom", z === 2);
    preview.classList.toggle("lim-below", eff < SMALLEST);
    out.textContent = `${w} px${z === 2 ? `, acts like ${eff} px` : ""}`;
    rail.setCollapsed(col);
    const room = eff - (col ? RAIL_COLLAPSED : RAIL_OPEN);
    const below = eff < SMALLEST;
    const tint: PillTint = below ? "bad" : room < ROOM_WARN ? "warn" : "good";
    status.replaceChildren(
      buildPill({
        tint,
        text: below
          ? `Below the smallest window (${SMALLEST} px)`
          : `${room} px left for the page`,
      }),
    );
  }
  range.addEventListener("input", update);
  zoom.input.addEventListener("change", update);
  collapse.input.addEventListener("change", update);
  update();
  return [ctl, legend, scroll];
}

/** The 1000 rows: built on request, with the time this browser took. */
function manyRows(ctx: TabContext): Node[] {
  const doc = ctx.doc;
  const list = createList(doc, "1000 example links");
  list.classList.add("lim-rows");
  list.tabIndex = 0;
  const time = el(doc, "span", "lim-time num", "Not built yet.");
  time.setAttribute("role", "status");
  const build = createButton(doc, {
    label: "Build 1000 rows",
    onClick: () => {
      const t0 = performance.now();
      const frag = doc.createDocumentFragment();
      for (let i = 1; i <= 1000; i++) {
        frag.append(
          createListRow(doc, {
            title: `#${i} ${WORDS[i % 10]}: ${WORDS[(i * 7) % 10]} và ${WORDS[(i * 3) % 10]}`,
            meta: `${i % 30} d`,
            focusable: false,
          }),
        );
      }
      list.replaceChildren(frag);
      requestAnimationFrame(() => {
        time.textContent = `1000 rows built and painted in ${Math.round(performance.now() - t0)} ms in this browser. Not measured in the app.`;
      });
    },
  });
  const bar = el(doc, "div", "lim-bar");
  bar.append(build, time);
  return [bar, list];
}

export const renderLimits: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  panel.append(
    entryRows(ctx, "Limits", {
      "narrow width, 200%": () => ({
        nodes: narrowPreview(ctx),
        column: true,
        wide: true,
      }),

      "very long title": () => {
        const rowList = createList(doc, "Long title, row", [
          createListRow(doc, { title: LONG_TITLE, meta: "2 d", icon: Link }),
        ]);
        const card = createLinkCard(doc, {
          title: LONG_TITLE.slice(0, 150),
          url: "tauri.app/blog",
          app: "telegram",
          age: "2 d",
        });
        card.classList.add("lim-narrow");
        const kcard = createKanbanCard(doc, {
          title:
            "Supercalifragilisticexpialidocious_without_any_spaces_at_all_from_a_filename.pdf",
        });
        return {
          nodes: [
            rowList,
            card,
            ...fullValue(ctx, LONG_TITLE, "Show full title", "Hide full title"),
            kcard,
          ],
          column: true,
        };
      },

      "messy urls": () => ({
        nodes: URLS.flatMap((url) => {
          const card = createLinkCard(doc, {
            title: "Link",
            url,
            app: "slack",
            age: "1 h",
          });
          card.classList.add("lim-wide");
          const holder = el(doc, "div", "lim-stack");
          holder.append(
            card,
            ...fullValue(ctx, url, "Show full address", "Hide full address"),
          );
          return [holder];
        }),
        column: true,
      }),

      "vietnamese, stacked marks": () => {
        const tight = el(doc, "div", "lim-tight", "ỖỘỔ ỮỰỬ ẪẬẨ ẴẶẲ ỄỆỂ");
        const card = createLinkCard(doc, {
          title:
            "Những điều ẩn giấu trong việc tối ưu hoá truy vấn — Ở ĐÂU, KHI NÀO, VÌ SAO?",
          url: "viblo.asia/p/toi-uu-truy-van",
          app: "zalo",
          age: "hôm qua",
          summary:
            "Người dùng đã lưu 12 liên kết về “Đặc tả kỹ thuật”. Bài viết giải thích cách đánh chỉ mục, lưỡng lự giữa ưu và nhược điểm.",
        });
        card.classList.add("lim-wide");
        const line = el(doc, "div", "lim-bar");
        line.append(
          buildPill({ text: "ĐẪ ĐỘC ĐỖ", tint: "warn" }),
          buildTrustLabel("unverified"),
          createButton(doc, { label: "LƯU LIÊN KẾT", size: "sm" }),
          createTagList(doc, ["ngữ pháp"]),
        );
        return {
          nodes: [
            createList(doc, "Vietnamese capitals", [
              createListRow(doc, {
                title:
                  "TỔNG HỢP KỸ THUẬT LƯU TRỮ DỮ LIỆU: ẨN, ẪN, ẬT, ỖNG, ỮA, ỰC, ỄNH, ẲNG",
                meta: "1 h",
                icon: Link,
              }),
            ]),
            card,
            line,
            state(
              doc,
              "counter-example: line height 1.1 + overflow hidden, marks clipped",
              tight,
            ),
          ],
          column: true,
        };
      },

      "long values in parts": () => {
        const word = `${"ẪẬẲỖỮỰ".repeat(6)}${"x".repeat(70)}`;
        const marks = "ỖỘỔ ỮỰỬ ẪẬẨ ẴẶẲ ỄỆỂ";
        const sidebar = createSidebar(doc, {
          label: "Main, long label example",
          brand: "Mnemo",
          brandMark: "M",
          quick: {
            id: "save",
            label: "Save or ask",
            href: "#save",
            icon: Plus,
          },
          searchLabel: "Search everything",
          groups: [
            {
              id: "long",
              label: "Library",
              items: [
                {
                  id: "word",
                  label: word,
                  href: "#word",
                  icon: Bell,
                },
                {
                  id: "marks",
                  label: `${marks} thông báo lặng lẽ từ mọi ứng dụng và lịch`,
                  href: "#marks",
                  icon: Bell,
                },
              ],
            },
          ],
          bottom: {
            label: "Apps and settings",
            icon: Plus,
            items: [],
          },
          collapsed: false,
          idPrefix: "lim-sb",
        });
        const frame = el(doc, "div", "frame");
        frame.append(sidebar.element);
        return {
          column: true,
          nodes: [
            state(
              doc,
              "tag list",
              createTagList(doc, [word, marks, "ngữ pháp"], {
                label: "Long tags",
              }),
            ),
            state(
              doc,
              "choice list",
              createChoiceList(doc, {
                legend: "Long hints",
                name: "lim-choice",
                value: "a",
                choices: [
                  { value: "a", label: marks, hint: word },
                  {
                    value: "b",
                    label: "Ghi chú",
                    hint: "Một dòng giải thích dài, có dấu chồng: ỖỘỔ ẪẬẨ, không bị cắt.",
                  },
                ],
              }).element,
            ),
            state(
              doc,
              "source list",
              createSourceList(doc, [
                { title: word, app: "zalo", age: "1 h" },
                {
                  title: `${marks} ${marks} ${marks}`,
                  app: "telegram",
                  age: "2 d",
                },
              ]),
            ),
            state(
              doc,
              "section list",
              createSectionList(doc, {
                label: "Long values",
                current: "a",
                sections: [
                  { id: "a", label: "Appearance", value: word },
                  { id: "b", label: "Ngôn ngữ", value: `${marks} ${marks}` },
                ],
              }).element,
            ),
            state(
              doc,
              "folder tree",
              createTree(doc, "Long folders", [
                { label: word, kind: "folder", count: 12 },
                { label: `${marks} / ${marks}`, kind: "label", count: 3 },
              ]),
            ),
            state(
              doc,
              "list row, second line",
              createList(doc, "Long second line", [
                createListRow(doc, { title: "Row", sub: word, meta: "1 h" }),
                createListRow(doc, {
                  title: "Hàng",
                  sub: `${marks} ${marks}`,
                  meta: "2 h",
                }),
              ]),
            ),
            state(doc, "sidebar, long labels", frame),
          ],
        };
      },

      "empty content": () => {
        const card = createLinkCard(doc, {
          title: "Untitled link",
          url: "example.com",
          app: "slack",
          age: "just now",
        });
        card.classList.add("lim-narrow");
        return {
          wide: true,
          nodes: [
            card,
            createKanbanColumn(doc, {
              name: "Waiting",
              cards: [],
              emptyText: "Nothing here.",
            }),
            createMetaLine(doc, ["just now", "0 links"]),
          ],
        };
      },

      "1000 rows": () => ({ nodes: manyRows(ctx), column: true }),

      "reduced motion": () => {
        const note = el(doc, "span", "lim-time");
        note.setAttribute("role", "status");
        const spin = buildSpinner("lg");
        spin.classList.add("lim-spin");
        const show = () => {
          const reduce =
            typeof ctx.doc.defaultView?.matchMedia === "function" &&
            ctx.doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)")
              .matches;
          const off = ctx.root.getAttribute("data-motion") === "off";
          note.textContent = reduce
            ? "Your system asks for reduced motion, so nothing moves."
            : off
              ? "Motion is off: the spinner stands still."
              : "Motion is on: the spinner turns.";
        };
        show();
        const watch = new MutationObserver(show);
        watch.observe(ctx.root, {
          attributes: true,
          attributeFilter: ["data-motion"],
        });
        ctx.signal.addEventListener("abort", () => watch.disconnect());
        const bar = buildProgress({ label: "Example" });
        bar.classList.add("lim-progress");
        return [spin, bar, note];
      },
    }),
  );
};
