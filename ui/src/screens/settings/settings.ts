// The Settings screen: a title, a list of sections on the left (each row shows its current value)
// and the open section on the right. Only Appearance has content so far; AI and Data are empty
// until their own tickets. All text goes in as text, never as markup.
import { THEME_LABELS, THEMES, type Theme } from "../../frame/theme";
import { errorMessage } from "../../shared/api";

export interface SettingsDeps {
  /** The theme that is in use now. */
  getTheme(): Theme;
  /** Shows `theme` at once. Nothing is saved here. */
  applyTheme(theme: Theme): void;
  /** Saves `theme`. Rejects when it could not be saved. */
  saveTheme(theme: Theme): Promise<void>;
}

type SectionId = "appearance" | "ai" | "data";

interface Section {
  id: SectionId;
  label: string;
}

const SECTIONS: readonly Section[] = [
  { id: "appearance", label: "Appearance" },
  { id: "ai", label: "AI" },
  { id: "data", label: "Data" },
];

/** What a section without content shows as its value, and in its body. */
const EMPTY_VALUE = "Not built yet";

const HINTS: Readonly<Record<Theme, string>> = {
  system: "Matches your computer, and follows it when it changes.",
  light: "Light background, dark text.",
  dark: "Dark background, light text.",
};

// One save at a time, in order, so the last choice is the value that stays. It lives outside the
// screen, so a save that started before the owner left Settings still finishes in order.
let saving: Promise<void> = Promise.resolve();

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Fills `container` with the Settings screen. */
export function renderSettings(
  container: HTMLElement,
  deps: SettingsDeps,
): void {
  const doc = container.ownerDocument;
  let open: SectionId = "appearance";

  const title = el(doc, "h1", undefined, "Settings");
  const note = el(doc, "p", "settings-note", "Changes are saved at once.");
  const header = el(doc, "header", "settings-head");
  header.append(title, note);

  const list = el(doc, "nav", "settings-sections");
  list.setAttribute("aria-label", "Settings sections");
  const body = el(doc, "div", "settings-body");
  const layout = el(doc, "div", "settings-layout");
  layout.append(list, body);
  container.replaceChildren(header, layout);

  const currentValue = (id: SectionId): string =>
    id === "appearance" ? THEME_LABELS[deps.getTheme()] : EMPTY_VALUE;

  function renderList(): void {
    const rows = SECTIONS.map((section) => {
      const row = el(doc, "button", "settings-row");
      row.type = "button";
      if (section.id === open) row.setAttribute("aria-current", "true");
      row.addEventListener("click", () => {
        open = section.id;
        renderList();
        renderBody();
      });
      // The plain space keeps the name and the value apart for a screen reader and for copy.
      row.append(
        el(doc, "span", "settings-row-name", section.label),
        " ",
        el(doc, "span", "settings-row-value", currentValue(section.id)),
      );
      return row;
    });
    list.replaceChildren(...rows);
  }

  function renderBody(): void {
    if (open === "appearance") body.replaceChildren(appearance());
    else body.replaceChildren(emptySection(open));
  }

  function emptySection(id: SectionId): HTMLElement {
    const label = SECTIONS.find((s) => s.id === id)?.label ?? "";
    const section = el(doc, "section", "card settings-card");
    section.setAttribute("aria-label", label);
    section.append(
      el(doc, "h2", undefined, label),
      el(doc, "p", "settings-empty", "Nothing to set here yet."),
    );
    return section;
  }

  function appearance(): HTMLElement {
    const section = el(doc, "section", "card settings-card");
    section.setAttribute("aria-label", "Appearance");

    const status = el(doc, "p", "settings-status");
    status.setAttribute("role", "status");
    status.hidden = true;

    const group = el(doc, "fieldset", "settings-choices");
    group.append(el(doc, "legend", "settings-legend", "Colours"));
    for (const theme of THEMES) {
      const id = `theme-${theme}`;
      const input = el(doc, "input");
      input.type = "radio";
      input.name = "theme";
      input.id = id;
      input.value = theme;
      input.checked = deps.getTheme() === theme;
      input.setAttribute("aria-describedby", `${id}-hint`);
      input.addEventListener("change", () => {
        if (input.checked) choose(theme, status);
      });
      const label = el(doc, "label", undefined, THEME_LABELS[theme]);
      label.htmlFor = id;
      const hint = el(doc, "span", "settings-hint", HINTS[theme]);
      hint.id = `${id}-hint`;
      const choice = el(doc, "div", "settings-choice");
      choice.append(input, label, hint);
      group.append(choice);
    }

    section.append(el(doc, "h2", undefined, "Appearance"), group, status);
    return section;
  }

  function choose(theme: Theme, status: HTMLElement): void {
    deps.applyTheme(theme);
    renderList();
    saving = saving.then(async () => {
      try {
        await deps.saveTheme(theme);
        status.hidden = true;
        status.textContent = "";
      } catch (error) {
        console.error("could not save the theme:", error);
        status.textContent = `Mnemo could not save the theme, so it applies only until Mnemo quits. ${errorMessage(error)}`;
        status.hidden = false;
      }
    });
  }

  renderList();
  renderBody();
}
