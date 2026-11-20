// The Controls tab: buttons, text fields and ways to choose. This file is the tab's renderer; the
// Controls agent owns it with ds/catalog/controls.ts, ds/catalog/controls.css and
// ds/components/controls.ts. Every part is the real component from the design system.

import { Ellipsis, Plus, X } from "lucide";
import "../../../ds/catalog/controls.css";
import {
  type ButtonOptions,
  createButton,
  createCheckbox,
  createChip,
  createChoiceList,
  createDialog,
  createDialogButton,
  createField,
  createKbd,
  createLabelPicker,
  createLink,
  createMenu,
  createMenuPanel,
  createMultiSelect,
  createPopover,
  createRadioGroup,
  createSearch,
  createSegmented,
  createSelect,
  createShortcut,
  createTagInput,
  createTextarea,
  createTextInput,
  createToggle,
  createTooltip,
  type LabelPickerNode,
  setButtonBusy,
} from "../../../ds/index";
import {
  button,
  el,
  entryRows,
  state,
  type TabContext,
  type TabRenderer,
} from "../parts";

const AI_OFF = "AI is off. Turn it on in Settings › AI.";

/** The theme choices of Settings, the sample content of the choice list. */
const THEME_CHOICES = [
  {
    value: "system",
    label: "System",
    hint: "Matches your computer, and follows it when it changes.",
  },
  { value: "light", label: "Light", hint: "Light background, dark text." },
  { value: "dark", label: "Dark", hint: "Dark background, light text." },
] as const;
const LINK = "https://vnexpress.net/ai";

/** The label tree of the label picker's sample content. */
const LABEL_TREE: readonly LabelPickerNode[] = [
  { name: "Work", children: [{ name: "Mnemo", current: true }] },
  { name: "Personal" },
  { name: "Cá nhân", children: [{ name: "Sức khoẻ" }] },
];
const LABEL_CHOSEN = ["Work / Mnemo", "Cá nhân / Sức khoẻ"];

/** A line of states that wraps, like the prototype's nested example rows. */
function line(doc: Document, ...states: HTMLElement[]): HTMLElement {
  const box = el(doc, "div", "cat-ex");
  box.append(...states);
  return box;
}

function menuItems(onChoose?: () => void) {
  return [
    { label: "Open", shortcut: "↵", onSelect: onChoose },
    { label: "Move to folder…", onSelect: onChoose },
    { label: "Summarise again (AI off)", disabled: true },
    "separator",
    { label: "Delete…", danger: true, onSelect: onChoose },
  ] as const;
}

function buttonRow(ctx: TabContext) {
  const doc = ctx.doc;
  const b = (options: ButtonOptions, caption: string) =>
    state(doc, caption, createButton(doc, options));
  const forcedSet = (
    label: string,
    variant: ButtonOptions["variant"],
    first: string,
  ) => [
    b({ label, variant }, first),
    b({ label, variant, forced: "hover" }, "hover"),
    b({ label, variant, forced: "focus" }, "focus"),
    b({ label, variant, forced: "pressed" }, "pressed"),
    b({ label, variant, disabled: true }, "disabled"),
  ];
  const moreTrigger = createButton(doc, {
    label: "More actions",
    icon: Ellipsis,
    iconOnly: true,
  });
  const moreTip = createTooltip(moreTrigger, "More actions", doc);

  const demoOptions: ButtonOptions = {
    label: "Summarise link",
    variant: "primary",
  };
  const count = el(doc, "span", "cat-num", "0");
  let runs = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const busyDemo = createButton(doc, {
    ...demoOptions,
    onClick: () => {
      runs += 1;
      count.textContent = String(runs);
      setButtonBusy(busyDemo, true, { ...demoOptions, label: "Summarising…" });
      timer = setTimeout(
        () => setButtonBusy(busyDemo, false, demoOptions),
        2200,
      );
    },
  });
  ctx.signal.addEventListener("abort", () => clearTimeout(timer));
  const live = el(doc, "span", "cap");
  live.append("live: ", count, " runs started");
  const busyBox = el(doc, "div", "st");
  busyBox.append(busyDemo, live);

  const aiOff = createButton(doc, {
    label: "Summarise link",
    disabled: true,
  });
  aiOff.title = AI_OFF;
  const aiBox = state(doc, "AI off: disabled + reason", [
    aiOff,
    el(doc, "span", "cat-hint", AI_OFF),
  ]);

  return {
    column: true,
    nodes: [
      line(doc, ...forcedSet("Cancel", "default", "default")),
      line(doc, ...forcedSet("Save link", "primary", "primary")),
      line(
        doc,
        b({ label: "Open", variant: "ghost" }, "ghost"),
        b({ label: "Open", variant: "ghost", forced: "hover" }, "ghost hover"),
        b(
          { label: "Open", variant: "ghost", disabled: true },
          "ghost disabled",
        ),
      ),
      line(
        doc,
        b({ label: "Delete 3 links", variant: "danger" }, "danger"),
        b(
          { label: "Delete 3 links", variant: "danger", forced: "hover" },
          "hover",
        ),
        b(
          { label: "Delete 3 links", variant: "danger", disabled: true },
          "disabled",
        ),
      ),
      line(
        doc,
        b({ label: "Rename", size: "sm" }, "small 32 px"),
        b({ label: "Accept", size: "sm", variant: "primary" }, "small primary"),
        b({ label: "New note", icon: Plus }, "with icon"),
        state(doc, "icon only + tooltip", moreTip.element),
        b(
          {
            label: "Remove",
            icon: X,
            iconOnly: true,
            size: "sm",
            variant: "ghost",
          },
          "small icon",
        ),
      ),
      line(
        doc,
        state(
          doc,
          "busy (fixed)",
          createButton(doc, {
            label: "Summarising…",
            variant: "primary",
            busy: true,
          }),
        ),
        busyBox,
        aiBox,
      ),
    ],
  };
}

function inputRow(ctx: TabContext) {
  const doc = ctx.doc;
  const make = (
    caption: string,
    inputOptions: Parameters<typeof createTextInput>[1],
    extra: { hint?: string; error?: string } = {},
  ) => {
    const input = createTextInput(doc, { type: "url", ...inputOptions });
    return state(
      doc,
      caption,
      createField(doc, { label: "Link", control: input, ...extra }),
      { grow: true },
    );
  };
  return [
    make(
      "empty",
      { placeholder: "https://" },
      { hint: "Paste any web address." },
    ),
    make("hover", { value: LINK, forced: "hover" }),
    make("focus", { value: LINK, forced: "focus" }),
    make(
      "error",
      { value: "vnexpress net/ai" },
      {
        error: "This is not a web address. Check the dot after the site name.",
      },
    ),
    make("disabled", { value: LINK, disabled: true }),
  ];
}

export const renderControls: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;

  panel.append(
    entryRows(ctx, "Controls", {
      button: buttonRow,
      input: inputRow,
      textarea: () => {
        const note = createTextarea(doc, {
          value: "Đọc lại phần về chỉ mục FTS5 trước thứ Sáu.",
        });
        const off = createTextarea(doc, { disabled: true });
        return [
          state(
            doc,
            "textarea",
            createField(doc, {
              label: "Note",
              control: note,
              hint: "Markdown works.",
            }),
            { grow: true },
          ),
          state(
            doc,
            "AI off",
            createField(doc, {
              label: "Summary",
              control: off,
              hint: "AI is off. Write your own summary or leave it empty.",
            }),
            { grow: true },
          ),
        ];
      },
      search: () => {
        const { wrap, input } = createSearch(doc, {
          placeholder: "Search links, notes, tasks",
        });
        return [
          state(
            doc,
            "search",
            createField(doc, {
              label: "Search everything",
              control: wrap,
              target: input,
            }),
            { grow: true },
          ),
        ];
      },
      checkbox: () => [
        state(doc, "off", createCheckbox(doc, { label: "Off" }).label),
        state(
          doc,
          "on",
          createCheckbox(doc, { label: "On", checked: true }).label,
        ),
        state(
          doc,
          "mixed",
          createCheckbox(doc, { label: "Some of 12", mixed: true }).label,
        ),
        state(
          doc,
          "disabled",
          createCheckbox(doc, { label: "Disabled", disabled: true }).label,
        ),
      ],
      radio: () => [
        state(
          doc,
          "group",
          createRadioGroup(doc, {
            legend: "Save to",
            name: "cat-save-to",
            options: [
              { label: "Inbox", value: "inbox", checked: true },
              { label: "Reading list", value: "reading" },
              { label: "Shared (Later)", value: "shared", disabled: true },
            ],
          }),
        ),
      ],
      toggle: () => [
        state(doc, "off (live)", createToggle(doc, { label: "Daily digest" })),
        state(
          doc,
          "on (live)",
          createToggle(doc, { label: "Summaries", on: true }),
        ),
        state(
          doc,
          "disabled",
          createToggle(doc, { label: "Auto-file", disabled: true }),
        ),
      ],
      segmented: () => [
        state(
          doc,
          "segmented (live, arrows)",
          createSegmented(doc, {
            label: "Sort by",
            options: ["Newest", "Oldest", "A to Z"],
          }),
        ),
      ],
      "filter chip": () => {
        const group = el(doc, "div", "cat-hstack");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "Filter by source");
        group.append(
          createChip(doc, { label: "Telegram", pressed: true }),
          createChip(doc, { label: "Zalo" }),
          createChip(doc, { label: "Slack", forced: "hover" }),
          createChip(doc, { label: "Gmail (not connected)", disabled: true }),
        );
        return [state(doc, "on · off · hover · disabled (live)", group)];
      },
      select: () => {
        const one = createSelect(doc, {
          options: ["Inbox", "Đọc sau", "Work / Mnemo"],
        });
        const many = createMultiSelect(doc, {
          label: "Labels",
          options: [
            { label: "research", checked: true },
            { label: "tiếng việt", checked: true },
            { label: "to read" },
          ],
          signal: ctx.signal,
          summarise: (n) =>
            n === 0 ? "No labels" : n === 1 ? "1 label" : `${n} labels`,
        });
        const manyLabel = el(doc, "span", "cat-hint", "Labels");
        const trigger = many.anchor.querySelector("button");
        manyLabel.id = "cat-many-label";
        trigger?.setAttribute("aria-describedby", manyLabel.id);
        return [
          state(
            doc,
            "pick one (native)",
            createField(doc, {
              label: "Folder",
              control: one.wrap,
              target: one.select,
            }),
            { grow: true },
          ),
          state(doc, "pick many (live)", [manyLabel, many.anchor]),
        ];
      },
      menu: () => {
        const live = createMenu(doc, {
          label: "Actions",
          items: menuItems(),
          signal: ctx.signal,
        });
        const open = createMenuPanel(
          doc,
          [
            { label: "Open", shortcut: "↵" },
            { label: "Move to folder…", highlighted: true },
            { label: "Summarise again (AI off)", disabled: true },
            "separator",
            { label: "Delete…", danger: true },
          ],
          { static: true, ariaLabel: "Menu example, open" },
        );
        return [
          state(doc, "menu (live, arrows)", live.anchor),
          state(doc, "menu open, item highlighted", open),
        ];
      },
      popover: () => {
        const trigger = createButton(doc, { label: "Why this folder?" });
        const panelEl = el(doc, "div", "popover");
        panelEl.setAttribute("role", "dialog");
        panelEl.setAttribute("aria-label", "Why this folder");
        panelEl.append(
          el(
            doc,
            "p",
            "cat-small",
            "Guess. The page talks about Tauri and Rust, like 18 links already in Work / Mnemo.",
          ),
        );
        const pop = createPopover(doc, {
          trigger,
          panel: panelEl,
          haspopup: "dialog",
          signal: ctx.signal,
        });
        const staticPanel = el(doc, "div", "popover static");
        staticPanel.setAttribute("role", "dialog");
        staticPanel.setAttribute("aria-label", "Popover example, open");
        staticPanel.append(
          el(doc, "p", "cat-small", "A short note about a guess."),
        );
        return [
          state(doc, "popover (live)", pop.anchor),
          state(doc, "open", staticPanel),
        ];
      },
      "tag input": () => {
        const tags = createTagInput(doc, {
          tags: ["rust", "tauri"],
          placeholder: "Add a tag",
        });
        return [
          state(
            doc,
            "live",
            createField(doc, {
              label: "Tags",
              control: tags.wrap,
              target: tags.input,
            }),
            { grow: true },
          ),
        ];
      },
      link: () => {
        // A sample must not leave the catalog: the click is stopped and says so.
        const demo = (event: MouseEvent) => {
          event.preventDefault();
          ctx.toast("Sample link: nothing opens from the catalog.");
        };
        const sentence = el(doc, "p", "cat-small");
        sentence.append(
          "Read ",
          createLink(doc, {
            label: "the Tauri guide",
            href: "#/ui-catalog",
            onClick: demo,
          }),
          " before Friday.",
        );
        const stand = (caption: string, forced?: "hover" | "focus") =>
          state(
            doc,
            caption,
            createLink(doc, {
              label: "Open the reading list",
              href: "#/ui-catalog",
              variant: "standalone",
              forced,
              onClick: demo,
            }),
          );
        return [
          state(doc, "inline", sentence),
          stand("standalone"),
          stand("hover", "hover"),
          stand("focus", "focus"),
          state(
            doc,
            "external",
            createLink(doc, {
              label: "vnexpress.net",
              href: LINK,
              external: true,
              onClick: demo,
              variant: "standalone",
            }),
          ),
          state(
            doc,
            "unavailable: text + reason",
            createLink(doc, {
              label: "Open in Telegram",
              href: "https://t.me/",
              variant: "standalone",
              unavailable: "Telegram is not connected.",
            }),
          ),
        ];
      },
      "choice list": () => {
        // Each example has its own name, so the radio groups and the ids never clash.
        const live = createChoiceList(doc, {
          legend: "Colours",
          name: "cat-choice-live",
          choices: THEME_CHOICES,
          value: "system",
          onChange: (value) => ctx.toast(`Chose ${value}. Catalog only.`),
        });
        const focus = createChoiceList(doc, {
          legend: "Colours",
          name: "cat-choice-focus",
          choices: THEME_CHOICES,
          value: "dark",
          forceState: { value: "dark", state: "focus" },
        });
        const disabled = createChoiceList(doc, {
          legend: "Colours",
          name: "cat-choice-off",
          choices: THEME_CHOICES,
          value: "light",
          disabled: true,
        });
        const error = createChoiceList(doc, {
          legend: "Colours",
          name: "cat-choice-error",
          choices: THEME_CHOICES,
          value: "dark",
        });
        error.setError(
          "Mnemo could not save the theme, so it applies only until Mnemo quits. The data file could not be written.",
        );
        const long = createChoiceList(doc, {
          legend: "Summary length for links saved from very long pages",
          name: "cat-choice-long",
          choices: [
            {
              value: "short",
              label: "Short",
              hint: "Two or three sentences that say what the page is about, written by AI and labelled as a guess so you can tell it from your own notes.",
            },
            {
              value: "none",
              label: "No summary",
              hint: "Saves the link only.",
            },
          ],
          value: "short",
        });
        return [
          state(doc, "default, checked (live)", live.element),
          state(doc, "focus-visible", focus.element),
          state(doc, "disabled", disabled.element),
          state(doc, "error", error.element),
          state(doc, "long hint", long.element),
        ];
      },
      "label picker": () => {
        const single = createLabelPicker(doc, {
          label: "Move “Design notes” under",
          mode: "single",
          topLevel: true,
          nodes: LABEL_TREE,
          value: ["Work / Mnemo"],
          onChange: (p) =>
            ctx.toast(`Chose ${p[0] || "(Top level)"}. Catalog only.`),
        });
        const forced = (label: string, st: "hover" | "focus" | "active") =>
          createLabelPicker(doc, {
            label,
            mode: "single",
            nodes: LABEL_TREE,
            forceState: { path: "Personal", state: st },
          });
        const disabledNodes = createLabelPicker(doc, {
          label: "Move “Work” under",
          mode: "single",
          topLevel: true,
          value: [""],
          nodes: [
            {
              name: "Work",
              disabled: "A label cannot go under itself.",
              children: [
                {
                  name: "Mnemo",
                  disabled: "A label cannot go under its own child.",
                  current: true,
                },
              ],
            },
            { name: "Personal" },
          ],
        });
        const multiple = createLabelPicker(doc, {
          label: "Labels",
          mode: "multiple",
          nodes: LABEL_TREE,
          value: LABEL_CHOSEN,
        });
        const error = createLabelPicker(doc, {
          label: "Labels",
          mode: "multiple",
          nodes: LABEL_TREE,
        });
        error.setError("Choose at least one label before saving");
        const empty = createLabelPicker(doc, {
          label: "Labels",
          mode: "multiple",
          nodes: [],
        });
        const off = createLabelPicker(doc, {
          label: "Labels",
          mode: "multiple",
          nodes: LABEL_TREE,
          value: LABEL_CHOSEN,
          disabled: true,
        });
        const long = createLabelPicker(doc, {
          label: "Labels",
          mode: "multiple",
          value: [
            "Dự án nghiên cứu / Tài liệu tham khảo về trí tuệ nhân tạo và học máy / Ghi chú rất dài của tháng mười",
          ],
          nodes: [
            {
              name: "Dự án nghiên cứu",
              children: [
                {
                  name: "Tài liệu tham khảo về trí tuệ nhân tạo và học máy",
                  children: [
                    { name: "Ghi chú rất dài của tháng mười" },
                    { name: "Nguyễn Thị Minh Khai" },
                  ],
                },
              ],
            },
            ...Array.from({ length: 12 }, (_, i) => ({
              name: `Label ${i + 1}`,
            })),
          ],
        });
        const dialogPicker = createLabelPicker(doc, {
          label: "Move “Design notes” under",
          mode: "single",
          topLevel: true,
          nodes: LABEL_TREE,
          value: ["Work / Mnemo"],
        });
        const dialog = createDialog({
          title: "Move label",
          children: [dialogPicker.element],
          actions: (close) => [
            createDialogButton("Cancel", "default", close, doc),
            createDialogButton("Move label", "primary", close, doc),
          ],
        });
        ctx.signal.addEventListener("abort", () => dialog.close());
        const open = button(doc, "btn", "Move label…");
        open.addEventListener("click", () => dialog.open(open));
        return [
          state(doc, "single, current parent, default (live)", single.element),
          state(doc, "hover", forced("Hover", "hover").element),
          state(doc, "focus-visible", forced("Focus-visible", "focus").element),
          state(doc, "active", forced("Active", "active").element),
          state(doc, "disabled nodes with reason", disabledNodes.element),
          state(doc, "multiple, chosen chips (live)", multiple.element),
          state(doc, "error: no label chosen", error.element),
          state(doc, "empty", empty.element),
          state(doc, "disabled", off.element),
          state(doc, "overflow, deep and long Vietnamese paths", long.element),
          state(doc, "in a dialog (Escape cancels, focus trapped)", open),
        ];
      },
      "shortcut hint": () => {
        const row = el(doc, "div", "cat-hstack");
        row.append(
          createShortcut(doc, "Save link", ["⌘", "S"]),
          createShortcut(doc, "Search", ["Ctrl", "K"]),
        );
        const single = el(doc, "div", "cat-hstack");
        single.append(createKbd(doc, "Esc"));
        return [
          state(doc, "shortcut hint (Mac / Ubuntu)", row),
          state(doc, "single key", single),
        ];
      },
    }),
  );
};
