// The Settings screen: a title, a list of sections on the left (each row shows its current value)
// and the open section on the right. Only Appearance has content so far; AI and Data are empty
// until their own tickets. All text goes in as text, never as markup. Every part comes from
// ui/src/ds (section list, card, choice list, text); settings.css lays them out.

import {
  buildText,
  type ChoiceList,
  createCard,
  createChoiceList,
  createSectionList,
} from "../../ds";
import { findItem } from "../../frame/nav";
import { THEME_LABELS, THEMES, type Theme } from "../../frame/theme";
import { errorMessage } from "../../shared/api";

export interface SettingsDeps {
  /** The theme that is in use now. */
  getTheme(): Theme;
  /** Shows `theme` at once. Nothing is saved here. */
  applyTheme(theme: Theme): void;
  /** Saves `theme`. Rejects when it could not be saved. */
  saveTheme(theme: Theme): Promise<void>;
  /**
   * Hears a save result when the owner has left Settings, so the line has no screen to show on.
   * `null` means a save worked, and clears an earlier failure line. The caller shows the text
   * somewhere that is still on screen.
   */
  onDetachedSave?(failure: string | null): void;
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

/** Fills `container` with the Settings screen. */
export function renderSettings(
  container: HTMLElement,
  deps: SettingsDeps,
): void {
  const doc = container.ownerDocument;
  let open: SectionId = "appearance";

  const title = doc.createElement("h1");
  title.textContent = "Settings";
  const header = doc.createElement("header");
  header.className = "settings-head";
  header.append(
    title,
    buildText(doc, {
      tone: "muted",
      size: "base",
      content: "Changes are saved at once.",
    }),
  );
  const phase = findItem("settings")?.phase;
  if (phase !== undefined)
    header.append(
      buildText(doc, {
        tone: "muted",
        size: "base",
        content: `Phase ${phase}`,
      }),
    );

  const currentValue = (id: SectionId): string =>
    id === "appearance" ? THEME_LABELS[deps.getTheme()] : EMPTY_VALUE;

  // The section list builds its rows once and updates them in place, so the row that has
  // keyboard focus keeps it.
  const list = createSectionList(doc, {
    label: "Settings sections",
    sections: SECTIONS.map((section) => ({
      ...section,
      value: currentValue(section.id),
    })),
    current: open,
    onSelect: (id) => {
      open = id as SectionId;
      renderList();
      renderBody();
    },
  });
  const body = doc.createElement("div");
  body.className = "settings-body";
  const layout = doc.createElement("div");
  layout.className = "settings-layout";
  layout.append(list.element, body);
  container.replaceChildren(header, layout);

  function renderList(): void {
    for (const section of SECTIONS)
      list.setValue(section.id, currentValue(section.id));
    list.setCurrent(open);
  }

  function renderBody(): void {
    if (open === "appearance") body.replaceChildren(appearance());
    else body.replaceChildren(emptySection(open));
  }

  function card(label: string, children: Node[]): HTMLElement {
    const section = createCard({
      doc,
      element: "section",
      label,
      title: label,
      level: 2,
      children,
    });
    section.classList.add("settings-card");
    return section;
  }

  function emptySection(id: SectionId): HTMLElement {
    const label = SECTIONS.find((s) => s.id === id)?.label ?? "";
    return card(label, [
      buildText(doc, { tone: "muted", content: "Nothing to set here yet." }),
    ]);
  }

  function appearance(): HTMLElement {
    const choices: ChoiceList<Theme> = createChoiceList<Theme>(doc, {
      legend: "Colours",
      name: "theme",
      choices: THEMES.map((theme) => ({
        value: theme,
        label: THEME_LABELS[theme],
        hint: HINTS[theme],
      })),
      value: deps.getTheme(),
      onChange: (theme) => choose(theme, choices),
    });
    return card("Appearance", [choices.element]);
  }

  function choose(theme: Theme, choices: ChoiceList<Theme>): void {
    deps.applyTheme(theme);
    renderList();
    saving = saving.then(async () => {
      try {
        await deps.saveTheme(theme);
        choices.setError(null);
        // A failure shown after the owner left Settings is cleared by any later good save.
        deps.onDetachedSave?.(null);
      } catch (error) {
        console.error("could not save the theme:", error);
        const text = `Mnemo could not save the theme, so it applies only until Mnemo quits. ${errorMessage(error)}`;
        choices.setError(text);
        // The owner may have left Settings, so this line would be on a screen nobody sees.
        if (!choices.element.isConnected) deps.onDetachedSave?.(text);
      }
    });
  }

  renderBody();
}
