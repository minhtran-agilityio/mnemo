// The Foundations tab: type scale, colour roles, spacing, radius, shadow, focus ring, control
// border, icons and motion. All values come from ds/tokens.css. This file is the tab's renderer;
// the registry rows are in ds/catalog/foundations.ts and the looks in ds/catalog/foundations.css.

import "../../../ds/catalog/foundations.css";
import {
  Bell,
  Bookmark,
  Check,
  CircleHelp,
  CircleX,
  Ellipsis,
  FileText,
  Folder,
  type IconNode,
  Info,
  Kanban,
  Link,
  MessageCircle,
  Pause,
  Plus,
  Power,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide";
import { createIcon } from "../../../ds/index";
import { button, el, entryRows, state, type TabRenderer } from "../parts";

const ICONS: ReadonlyArray<[string, IconNode]> = [
  ["plus", Plus],
  ["search", Search],
  ["link", Link],
  ["bookmark", Bookmark],
  ["note", FileText],
  ["board", Kanban],
  ["ask", MessageCircle],
  ["graph", Share2],
  ["folder", Folder],
  ["tag", Tag],
  ["trash", Trash2],
  ["undo", Undo2],
  ["check", Check],
  ["x", X],
  ["info", Info],
  ["warn", TriangleAlert],
  ["error", CircleX],
  ["ai", Sparkles],
  ["guess", CircleHelp],
  ["unverified", ShieldAlert],
  ["off", Power],
  ["pause", Pause],
  ["settings", Settings],
  ["more", Ellipsis],
  ["bell", Bell],
];

/** [token, what it is for]: the colour roles of the prototype. */
const ROLES: ReadonlyArray<[string, string]> = [
  ["--paper", "page"],
  ["--card", "card"],
  ["--head", "header, hover"],
  ["--ink", "text"],
  ["--muted", "secondary text"],
  ["--line", "divider"],
  ["--accent", "action, focus"],
  ["--accent-soft", "selected"],
  ["--good", "success"],
  ["--warn-soft", "warning ground"],
  ["--bad", "error"],
  ["--hl", "highlight"],
];

/** [token, how the sample is drawn, caption]: the type scale of the prototype. */
const SCALE: ReadonlyArray<[string, string, string, string]> = [
  ["--text-2xl", "--weight-bold", "Bookmarks", "22 / 700"],
  ["--text-xl", "--weight-semibold", "Folder suggestions", "20 / 600"],
  [
    "--text-base",
    "--weight-regular",
    "Mnemo saved the link and read the page.",
    "16 / 400",
  ],
  ["--text-lg", "--weight-semibold", "Save link", "15 / 600"],
  [
    "--text-md",
    "--weight-regular",
    "Saved 2 min ago from Telegram",
    "14 / 400",
  ],
  [
    "--text-sm",
    "--weight-regular",
    "Unverified: not checked against the source",
    "12.5 / 400",
  ],
  ["--text-xs", "--weight-bold", "Library", "11 / 700"],
];

export const renderFoundations: TabRenderer = (panel, ctx) => {
  const { doc, root } = ctx;
  const value = (name: string) =>
    doc.defaultView?.getComputedStyle(root).getPropertyValue(name).trim() ?? "";

  panel.append(
    entryRows(ctx, "Foundations", {
      type: () => {
        const scale = el(doc, "div", "typescale");
        for (const [size, weight, sample, caption] of SCALE) {
          const line = el(doc, "div");
          const text = el(
            doc,
            "span",
            size === "--text-xs" ? "cat-caps" : undefined,
            sample,
          );
          text.style.fontSize = `var(${size})`;
          text.style.fontWeight = `var(${weight})`;
          line.append(el(doc, "span", "cap", `${size} ${caption}`), text);
          scale.append(line);
        }
        const mono = el(doc, "div");
        const monoText = el(
          doc,
          "span",
          undefined,
          "claude -p · 62% used · 14 runs",
        );
        monoText.style.fontFamily = "var(--font-mono)";
        monoText.style.fontSize = "var(--text-sm)";
        mono.append(el(doc, "span", "cap", "--font-mono 12.5"), monoText);
        const body = el(doc, "div");
        const bodyText = el(doc, "span", undefined, "Source Sans 3 for text");
        bodyText.style.fontFamily = "var(--font-body)";
        body.append(el(doc, "span", "cap", "--font-body"), bodyText);
        scale.append(body, mono);
        return [scale];
      },
      colour: () =>
        ROLES.map(([name, role]) => {
          const swatch = el(doc, "span", "sw sw-role");
          swatch.style.background = `var(${name})`;
          const box = state(doc, name, swatch);
          box.append(el(doc, "span", "cat-note", role));
          return box;
        }),
      spacing: () => {
        const rows: Node[] = [];
        for (let n = 1; n <= 6; n++) {
          const name = `--space-${n}`;
          const row = el(doc, "div", "cat-ex");
          const bar = el(doc, "span", "spacebar");
          bar.style.width = `calc(var(${name}) * 4)`;
          row.append(
            el(doc, "span", "space-label", name),
            bar,
            el(
              doc,
              "span",
              "cat-note cat-num",
              value(name) || "4 times the step",
            ),
          );
          rows.push(row);
        }
        return { nodes: rows, column: true };
      },
      radius: () =>
        ["sm", "md", "lg", "pill"].map((size) => {
          const box = el(doc, "div", "radbox");
          box.style.borderRadius = `var(--radius-${size})`;
          return state(doc, `--radius-${size}`, box);
        }),
      shadow: () => {
        const sample = (shadow: string | null, caption: string) => {
          const box = el(doc, "div", "shbox");
          if (shadow) box.style.boxShadow = `var(${shadow})`;
          return state(doc, caption, box);
        };
        return [
          sample(null, "none"),
          sample("--sh1", "--sh1"),
          sample("--sh2", "--sh2"),
        ];
      },
      "focus ring": () => {
        // A real focus-visible ring is hard to hold still, so this button wears the same outline.
        const focused = button(doc, "btn", "Save link");
        focused.style.outline = "var(--focus-ring) solid var(--accent)";
        focused.style.outlineOffset = "2px";
        return [state(doc, "focus-visible", focused)];
      },
      "control border": () => {
        const input = (label: string, text: string, edge: string | null) => {
          const field = el(doc, "input", "input");
          field.value = text;
          field.setAttribute("aria-label", label);
          if (edge) field.style.borderColor = `var(${edge})`;
          return field;
        };
        return [
          state(
            doc,
            "--line · 1.28:1 on card (light) · fails 3:1",
            input(
              "Example field with the --line border",
              "Before: --line",
              "--line",
            ),
            { grow: true },
          ),
          state(
            doc,
            "--control-edge · 3.19 to 3.70:1 light · 3.27 to 3.94:1 dark",
            input(
              "Example field with the --control-edge border",
              "After: --control-edge",
              null,
            ),
            { grow: true },
          ),
        ];
      },
      icons: () =>
        ICONS.map(([name, node]) => {
          const cell = state(doc, name, [
            createIcon(node, "sm"),
            createIcon(node, "md"),
          ]);
          cell.classList.add("icon-cell");
          return cell;
        }),
      motion: () => {
        const track = el(doc, "div", "cat-indet");
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", "Example: loading");
        track.append(el(doc, "span"));
        const spinner = el(doc, "span", "cat-spin");
        const pulse = el(doc, "span", "cat-pulse");
        spinner.setAttribute("aria-hidden", "true");
        pulse.setAttribute("aria-hidden", "true");
        return [
          state(doc, "--dur-slow 1200 ms: spin", spinner),
          state(doc, "--dur-slow 1200 ms: pulse", pulse),
          state(doc, "ease: --ease", track, { grow: true }),
        ];
      },
    }),
  );
};
