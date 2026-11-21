// The Settings screen: a title, a list of sections on the left (each row shows its current value)
// and the open section on the right. Appearance and AI have content; Data is empty until its own
// ticket. The AI section shows the Claude Code check (state, how to fix it, Check again). All text goes in as text, never as markup. Every part comes from
// ui/src/ds (section list, card, choice list, text); settings.css lays them out.

import {
  buildBanner,
  buildPill,
  buildText,
  type ChoiceList,
  createButton,
  createCard,
  createChoiceList,
  createSectionList,
  type PillTint,
  setButtonBusy,
} from "../../ds";
import { findItem } from "../../frame/nav";
import { THEME_LABELS, THEMES, type Theme } from "../../frame/theme";
import {
  type AiHealth,
  type AiMode,
  type AiState,
  errorMessage,
} from "../../shared/api";

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
  /** The latest Claude Code check, or null while the first one is still running. */
  getAiHealth(): Promise<AiHealth | null>;
  /** Which AI runner the app uses. Rejects when it could not be read. */
  getAiMode(): Promise<AiMode>;
  /** Checks Claude Code again. Rejects when the check could not be asked for. */
  checkAiHealth(): Promise<AiHealth>;
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

const AI_LABELS: Readonly<Record<AiState, string>> = {
  ready: "Ready",
  not_installed: "Not installed",
  not_signed_in: "Not signed in",
  version_problem: "Version problem",
};

const AI_TINTS: Readonly<Record<AiState, PillTint>> = {
  ready: "good",
  not_installed: "bad",
  not_signed_in: "warn",
  version_problem: "warn",
};

/** What the AI section knows: the first check is running, it is known, or it could not be read. */
type AiView =
  | { kind: "checking" }
  | { kind: "known"; health: AiHealth }
  | { kind: "failed"; text: string };

/**
 * How often, and how many times, the first check is asked for while it is still running. The
 * core may take up to 20 seconds (two commands, 10 seconds each), so the polling lasts longer.
 */
const AI_POLL_MS = 1000;
const AI_POLL_TRIES = 25;

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
  let ai: AiView = { kind: "checking" };
  let aiBusy = false;
  let aiMode: AiMode = "real";

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

  const aiValue = (): string =>
    ai.kind === "known"
      ? AI_LABELS[ai.health.state]
      : ai.kind === "checking"
        ? "Checking"
        : "Unknown";

  const currentValue = (id: SectionId): string =>
    id === "appearance"
      ? THEME_LABELS[deps.getTheme()]
      : id === "ai"
        ? aiValue()
        : EMPTY_VALUE;

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
    else if (open === "ai") body.replaceChildren(aiSection());
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

  function aiSection(): HTMLElement {
    const status = doc.createElement("div");
    status.className = "settings-ai-status";
    const line = (text: string) =>
      buildText(doc, { tone: "muted", content: text });
    const button = createButton(doc, {
      label: "Check again",
      onClick: () => void checkAgain(),
    });
    if (aiBusy) setButtonBusy(button, true, { label: "Check again" });
    // Only when AI is fake: the owner must never mistake fixed test answers for real ones.
    const fakeBanner: Node[] =
      aiMode === "fake"
        ? [
            buildBanner({
              tone: "warn",
              lead: "Fake AI",
              message: "answers are fixed test data, no Claude usage",
            }),
          ]
        : [];
    if (ai.kind === "known") {
      status.append(
        buildPill({
          text: AI_LABELS[ai.health.state],
          tint: AI_TINTS[ai.health.state],
        }),
        button,
      );
      return card("AI", [...fakeBanner, status, line(ai.health.message)]);
    }
    if (ai.kind === "checking") {
      status.append(buildPill({ text: "Checking" }), button);
      return card("AI", [
        ...fakeBanner,
        status,
        line("Mnemo is checking Claude Code."),
      ]);
    }
    status.append(button);
    return card("AI", [...fakeBanner, status, line(ai.text)]);
  }

  function showAi(next: AiView): void {
    ai = next;
    renderList();
    if (open === "ai" && body.isConnected) renderBody();
  }

  async function checkAgain(): Promise<void> {
    if (aiBusy) return;
    aiBusy = true;
    if (open === "ai") renderBody();
    try {
      showAi({ kind: "known", health: await deps.checkAiHealth() });
    } catch (error) {
      console.error("could not check Claude Code:", error);
      showAi({
        kind: "failed",
        text: `Mnemo could not check Claude Code. ${errorMessage(error)}`,
      });
    } finally {
      aiBusy = false;
      if (open === "ai") renderBody();
    }
  }

  // The first result is read at once, so the AI row shows its state without opening the section.
  // While the first check is still running the answer is null: ask again every second, for a
  // short time, and stop when the owner leaves Settings.
  function readFirstCheck(left: number): void {
    deps
      .getAiHealth()
      .then((health) => {
        if (health) showAi({ kind: "known", health });
        else if (ai.kind === "checking" && body.isConnected) {
          if (left > 0) setTimeout(() => readFirstCheck(left - 1), AI_POLL_MS);
          else
            showAi({
              kind: "failed",
              text: "Mnemo is still waiting for the Claude Code check. Choose Check again to try once more.",
            });
        }
      })
      .catch((error: unknown) => {
        console.error("could not read the Claude Code check:", error);
        showAi({
          kind: "failed",
          text: `Mnemo could not read the Claude Code check. ${errorMessage(error)}`,
        });
      });
  }
  readFirstCheck(AI_POLL_TRIES);

  // The mode is read once. When it cannot be read the banner stays off, and the error is logged.
  deps
    .getAiMode()
    .then((mode) => {
      aiMode = mode;
      if (mode === "fake" && open === "ai" && body.isConnected) renderBody();
    })
    .catch((error: unknown) => {
      console.error("could not read the AI mode:", error);
    });

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
