// The Settings screen: a title, a list of sections on the left (each row shows its current value)
// and the open section on the right. Appearance, AI and Data have content. The AI section shows
// the Claude Code check (state, how to fix it, Check again). The Data section shows the data
// folder, the backup commands, Export, Open data folder and Reset. All text goes in as text, never
// as markup. Every part comes from ui/src/ds (section list, card, choice list, text, copy line,
// confirm dialog); settings.css lays them out.

import {
  buildAiOffState,
  buildBanner,
  buildBusyLine,
  buildPill,
  buildText,
  buildTrustLabel,
  type ChoiceList,
  createButton,
  createCard,
  createChoiceList,
  createConfirmDialog,
  createCopyLine,
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
  type DataFolderInfo,
  type ExportSummary,
  errorMessage,
  isAppError,
  RESET_WORD,
  type TestPromptResult,
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
  /** Runs the developer test prompt. Rejects with an AppError (code and plain message). */
  runTestPrompt(): Promise<TestPromptResult>;
  /** Asks for a folder in the native dialog. Null when the owner cancels. */
  pickFolder(): Promise<string | null>;
  /** Exports all data into a new folder inside `folder`. Rejects with an AppError. */
  exportData(folder: string): Promise<ExportSummary>;
  /** Deletes all data. The core accepts only the word `RESET`. Rejects with an AppError. */
  resetData(confirm: string): Promise<void>;
  /** Where the data lives, and the copy commands for a backup. */
  dataFolderInfo(): Promise<DataFolderInfo>;
  /** Opens the data folder in the file manager. Rejects with an AppError. */
  openDataFolder(): Promise<void>;
  /** Runs after a reset worked, or failed part way: forget the cached theme and start the app over. */
  afterReset(): void;
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

/** What the Data row shows as its value. */
const DATA_VALUE = "Export and reset";

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

/** What the developer test prompt shows: nothing yet, a run, its answer, its failure, or the limit. */
type TestPromptView =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; answer: string; durationMs: number }
  | { kind: "failed"; message: string; next: string }
  | { kind: "limit" };

/** What the Data section knows about the data folder. */
type DataInfoView =
  | { kind: "loading" }
  | { kind: "known"; info: DataFolderInfo }
  | { kind: "failed"; text: string };

/** What Export and Reset show: nothing yet, the work, a result, or a failure. */
type ActionView =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

const COUNT_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["notes", "note", "notes"],
  ["bookmarks", "link", "links"],
  ["ideas", "idea", "ideas"],
  ["projects", "project", "projects"],
  ["tasks", "task", "tasks"],
  ["events", "event", "events"],
  ["runs", "run", "runs"],
  ["memories", "memory", "memories"],
  ["labels", "label", "labels"],
  ["links", "connection", "connections"],
  ["files", "file", "files"],
];

/** The plain sentence that names the new folder and what went into it. */
function exportSentence(summary: ExportSummary): string {
  const counts = summary.counts as unknown as Record<string, number>;
  const parts = COUNT_LABELS.flatMap(([key, one, many]) =>
    counts[key] ? [`${counts[key]} ${counts[key] === 1 ? one : many}`] : [],
  );
  const what = parts.length > 0 ? parts.join(", ") : "no records";
  const missing =
    summary.filesMissing > 0
      ? ` ${summary.filesMissing} file${summary.filesMissing === 1 ? " was" : "s were"} missing from the files folder and could not be copied.`
      : "";
  return `Saved in the folder ${summary.folder}. It holds ${what}.${missing}`;
}

/** The export failure sentence. The core's message says what is left of the export folder;
 * "Nothing was changed." is added only when that message does not already say so. */
function exportFailureText(error: unknown): string {
  const message = errorMessage(error);
  const says = /unchanged|nothing was/i.test(message);
  return `Mnemo could not export your data. ${message}${says ? "" : " Nothing was changed."}`;
}

/** How long the reset result stays on screen before the app starts over. */
export const RESET_RESTART_MS = 1500;

const EXPORT_LABEL = "Export";
const RESET_LABEL = "Reset all data";

const TEST_LABEL = "Send test prompt";

/**
 * The test prompt outlives one Settings view. Leaving Settings and coming back while a run is
 * going shows it still running, so a second paid run cannot start, and its answer still shows.
 * `redraw` belongs to the newest view.
 */
const testPromptRun: { view: TestPromptView; redraw: (() => void) | null } = {
  view: { kind: "idle" },
  redraw: null,
};

/** Forgets the test prompt state. For tests only. */
export function resetTestPromptForTests(): void {
  testPromptRun.view = { kind: "idle" };
  testPromptRun.redraw = null;
}

/** The next step for each failure code of the test prompt. */
const NEXT_STEPS: Readonly<Record<string, string>> = {
  timeout: "Try again in a moment.",
  schema_mismatch: "Try again. If it keeps happening, update Claude Code.",
  exit_error:
    "Choose Check again to see if Claude Code is signed in, then try again.",
  unavailable:
    "Choose Check again to see if Claude Code is installed, then try again.",
};
const DEFAULT_NEXT_STEP = "Try again in a moment.";

/** The time a run took, as a short plain text. */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

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
  let dataInfo: DataInfoView = { kind: "loading" };
  let exportView: ActionView = { kind: "idle" };
  let resetView: ActionView = { kind: "idle" };
  let openFolderFailure: string | null = null;

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
        : DATA_VALUE;

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
    else body.replaceChildren(dataSection());
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

  // ---- Data ----

  function redrawData(): void {
    if (open === "data" && body.isConnected) renderBody();
  }

  function statusBanner(view: ActionView, busyText: string): Node[] {
    if (view.kind === "running")
      return [buildBanner({ tone: "info", message: busyText })];
    if (view.kind === "done")
      return [buildBanner({ tone: "info", lead: "Done.", message: view.text })];
    if (view.kind === "failed")
      return [buildBanner({ tone: "bad", message: view.text })];
    return [];
  }

  function dataSection(): HTMLElement {
    const exportRunning = exportView.kind === "running";
    const resetRunning = resetView.kind === "running";
    const exportButton = createButton(doc, {
      label: EXPORT_LABEL,
      variant: "primary",
      onClick: () => void exportAll(),
    });
    if (exportRunning)
      setButtonBusy(exportButton, true, { label: EXPORT_LABEL });
    const exportBox = doc.createElement("div");
    exportBox.className = "settings-data-block";
    exportBox.append(
      buildText(doc, {
        tone: "muted",
        content:
          "Export saves your notes, links, ideas, projects, tasks, events, runs, memories, labels and files as Markdown, JSON and copied files, in a new folder inside the folder you pick. It never overwrites a folder.",
      }),
      exportButton,
      ...(exportView.kind === "done"
        ? [
            buildBanner({
              tone: "info",
              lead: "Exported.",
              message: exportView.text,
            }),
          ]
        : statusBanner(exportView, "Exporting...")),
    );

    const folderBox = doc.createElement("div");
    folderBox.className = "settings-data-block";
    const openButton = createButton(doc, {
      label: "Open data folder",
      onClick: () => void openFolder(),
    });
    if (dataInfo.kind === "known")
      folderBox.append(
        createCopyLine(doc, { label: "Data folder", text: dataInfo.info.path }),
      );
    else
      folderBox.append(
        buildText(doc, {
          tone: "muted",
          content:
            dataInfo.kind === "loading"
              ? "Reading where the data folder is."
              : dataInfo.text,
        }),
      );
    folderBox.append(openButton);
    if (openFolderFailure)
      folderBox.append(
        buildBanner({ tone: "bad", message: openFolderFailure }),
      );

    const backupBox = doc.createElement("div");
    backupBox.className = "settings-data-block";
    backupBox.append(
      buildText(doc, {
        tone: "muted",
        content:
          "To back up everything, close Mnemo first, then run one of these commands in a terminal. It copies the whole data folder. Close Mnemo first, so the copy is complete.",
      }),
    );
    if (dataInfo.kind === "known")
      backupBox.append(
        createCopyLine(doc, {
          label: "macOS",
          text: dataInfo.info.macosCommand,
        }),
        createCopyLine(doc, {
          label: "Ubuntu",
          text: dataInfo.info.ubuntuCommand,
        }),
      );

    const resetButton = createButton(doc, {
      label: RESET_LABEL,
      variant: "danger",
      onClick: () => askReset(resetButton),
    });
    if (resetRunning) setButtonBusy(resetButton, true, { label: RESET_LABEL });
    const resetBox = doc.createElement("div");
    resetBox.className = "settings-data-block";
    resetBox.append(
      buildText(doc, {
        tone: "muted",
        content:
          "Reset deletes the Mnemo database and the saved files and starts empty, like a first start. The error log and the AI run output are kept. It makes no backup.",
      }),
      resetButton,
      ...statusBanner(resetView, "Resetting..."),
    );
    return card("Data", [exportBox, folderBox, backupBox, resetBox]);
  }

  async function exportAll(): Promise<void> {
    if (exportView.kind === "running") return;
    exportView = { kind: "running" };
    redrawData();
    try {
      const folder = await deps.pickFolder();
      if (folder === null) {
        // The owner cancelled the folder dialog: nothing happens.
        exportView = { kind: "idle" };
        return;
      }
      const summary = await deps.exportData(folder);
      exportView = { kind: "done", text: exportSentence(summary) };
    } catch (error) {
      console.error("the export failed:", error);
      exportView = {
        kind: "failed",
        text: exportFailureText(error),
      };
    } finally {
      redrawData();
    }
  }

  async function openFolder(): Promise<void> {
    try {
      await deps.openDataFolder();
      openFolderFailure = null;
    } catch (error) {
      console.error("could not open the data folder:", error);
      openFolderFailure = `Mnemo could not open the data folder. ${errorMessage(error)}`;
    }
    redrawData();
  }

  function askReset(opener: HTMLElement): void {
    if (resetView.kind === "running") return;
    createConfirmDialog({
      doc,
      title: "Reset all Mnemo data?",
      message:
        "This deletes the Mnemo database and the saved files folder. The error log and the AI run output are kept. Mnemo makes no backup first, and this cannot be undone. Use Export or the backup command first if you want to keep a copy.",
      lose: [
        "All notes, links, ideas, projects, tasks, events, runs, memories and labels",
        "All saved files",
        "Your settings, the theme included",
      ],
      keepLabel: "Cancel",
      confirmLabel: RESET_LABEL,
      typeToConfirm: {
        word: RESET_WORD,
        label: `Type ${RESET_WORD} to confirm`,
      },
      onConfirm: () => void resetAll(),
    }).open(opener);
  }

  async function resetAll(): Promise<void> {
    if (resetView.kind === "running") return;
    resetView = { kind: "running" };
    redrawData();
    try {
      await deps.resetData(RESET_WORD);
    } catch (error) {
      console.error("the reset failed:", error);
      // "reset_failed" means the delete got as far as starting, so part of the data may be
      // gone and the screens may show stale rows. Reload so the app shows what is really left.
      const partial = isAppError(error) && error.code === "reset_failed";
      resetView = {
        kind: "failed",
        text: `Mnemo could not reset your data. ${errorMessage(error)}${partial ? " Mnemo is reloading to show what is left." : ""}`,
      };
      redrawData();
      if (partial) setTimeout(() => deps.afterReset(), RESET_RESTART_MS);
      return;
    }
    // The core is empty now. Say so for a moment, then start the app over like a first start.
    resetView = {
      kind: "done",
      text: "All data was deleted. Mnemo is starting over.",
    };
    redrawData();
    setTimeout(() => deps.afterReset(), RESET_RESTART_MS);
  }

  deps
    .dataFolderInfo()
    .then((info) => {
      dataInfo = { kind: "known", info };
      redrawData();
    })
    .catch((error: unknown) => {
      console.error("could not read the data folder:", error);
      dataInfo = {
        kind: "failed",
        text: `Mnemo could not find its data folder. ${errorMessage(error)}`,
      };
      redrawData();
    });

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
      return card("AI", [
        ...fakeBanner,
        status,
        line(ai.health.message),
        ...testBlock(),
      ]);
    }
    if (ai.kind === "checking") {
      status.append(buildPill({ text: "Checking" }), button);
      return card("AI", [
        ...fakeBanner,
        status,
        line("Mnemo is checking Claude Code."),
        ...testBlock(),
      ]);
    }
    status.append(button);
    return card("AI", [...fakeBanner, status, line(ai.text), ...testBlock()]);
  }

  // The developer test prompt follows shared rule 3: it is offered only when AI can run (Ready,
  // or the fake) and the limit was not reached. Otherwise the AI-off or limit state shows
  // instead, and the rest of the app keeps working.
  function testBlock(): Node[] {
    if (testPromptRun.view.kind === "limit")
      return [buildAiOffState({ reason: "limit" })];
    const ready = ai.kind === "known" && ai.health.state === "ready";
    if (!ready && aiMode !== "fake")
      return ai.kind === "checking" ? [] : [buildAiOffState()];
    const box = doc.createElement("div");
    box.className = "settings-ai-test";
    const running = testPromptRun.view.kind === "running";
    const send = createButton(doc, {
      label: TEST_LABEL,
      onClick: () => void sendTestPrompt(),
    });
    if (running) setButtonBusy(send, true, { label: TEST_LABEL });
    box.append(
      buildText(doc, {
        tone: "muted",
        content:
          aiMode === "fake"
            ? "Developer test. Fake AI answers with fixed test data."
            : "Developer test. Each click runs a real Claude prompt and uses Claude usage.",
      }),
      send,
    );
    if (testPromptRun.view.kind === "running") {
      box.append(buildBusyLine("Waiting for Claude…"));
    } else if (testPromptRun.view.kind === "done") {
      box.append(
        buildText(doc, { content: testPromptRun.view.answer }),
        buildTrustLabel("ai"),
        buildText(doc, {
          tone: "muted",
          size: "sm",
          content: `Answered in ${formatDuration(testPromptRun.view.durationMs)}.`,
        }),
      );
    } else if (testPromptRun.view.kind === "failed") {
      // The reason is written by Mnemo, not read from Claude, so it is marked as a guess.
      box.append(
        buildBanner({
          tone: "bad",
          lead: "Test prompt failed.",
          message: `${testPromptRun.view.message} Nothing changed. ${testPromptRun.view.next}`,
        }),
        buildTrustLabel("guess"),
      );
    }
    return [box];
  }

  // This view is the newest: a run that ends draws its result here.
  testPromptRun.redraw = () => {
    if (open === "ai" && body.isConnected) renderBody();
  };

  async function sendTestPrompt(): Promise<void> {
    if (testPromptRun.view.kind === "running") return;
    testPromptRun.view = { kind: "running" };
    if (open === "ai" && body.isConnected) renderBody();
    try {
      const result = await deps.runTestPrompt();
      testPromptRun.view = {
        kind: "done",
        answer: String(result.answer),
        durationMs: Number(result.durationMs),
      };
    } catch (error) {
      console.error("the test prompt failed:", error);
      testPromptRun.view =
        isAppError(error) && error.code === "usage_limit"
          ? { kind: "limit" }
          : {
              kind: "failed",
              message: errorMessage(error),
              next:
                (isAppError(error) ? NEXT_STEPS[error.code] : undefined) ??
                DEFAULT_NEXT_STEP,
            };
    }
    // The view on screen now may be a newer one than the view that started the run.
    testPromptRun.redraw?.();
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
      const health = await deps.checkAiHealth();
      // A new check lets the owner try the test prompt again after the limit.
      if (testPromptRun.view.kind === "limit")
        testPromptRun.view = { kind: "idle" };
      showAi({ kind: "known", health });
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
