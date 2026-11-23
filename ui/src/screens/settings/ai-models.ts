// The "Model and effort per feature" card of the AI section in Settings (#24). One row per AI
// feature with two dropdowns (model, effort), and "Reset to defaults". The Rust core owns the
// list of features, the defaults and the allowed values; this card only shows them and asks the
// core to save. A change is saved at once and used by the next run of that feature.
// Every part comes from ui/src/ds (card, settings row, select, button, banner, skeleton, text).

import {
  buildBanner,
  buildSkeleton,
  buildText,
  createButton,
  createCard,
  createSelect,
  createSettingsRow,
  createSettingsRows,
  setButtonBusy,
  setSettingsRowDisabled,
  setSettingsRowError,
} from "../../ds";
import {
  type AiChoice,
  type AiEffort,
  type AiModel,
  type AiModelRow,
  type AiModelTable,
  errorMessage,
} from "../../shared/api";

export interface AiModelsDeps {
  /** Every feature's model and effort. Rejects when it could not be read. */
  listAiModels(): Promise<AiModelTable>;
  /** Saves one feature's choice. Rejects (and changes nothing) for an unknown value. */
  setAiModel(
    feature: string,
    model: AiModel,
    effort: AiEffort,
  ): Promise<AiModelTable>;
  /** Puts every feature back to its default. */
  resetAiModels(): Promise<AiModelTable>;
}

export interface AiModelsCard {
  readonly element: HTMLElement;
  /** Shows or hides the note that AI is off now. The rows stay editable either way. */
  setAiOff(off: boolean): void;
}

export const MODELS_TITLE = "Model and effort per feature";
const RESET_LABEL = "Reset to defaults";

type View =
  | { kind: "loading" }
  | { kind: "ready"; table: AiModelTable }
  | { kind: "failed"; text: string };

const labelOf = <T extends string>(choices: AiChoice<T>[], value: T): string =>
  choices.find((c) => c.value === value)?.label ?? value;

const choiceValue = <T extends string>(
  choices: AiChoice<T>[],
  label: string,
): T | undefined => choices.find((c) => c.label === label)?.value;

/** Builds the card and starts reading the rows. */
export function createAiModelsCard(
  doc: Document,
  deps: AiModelsDeps,
): AiModelsCard {
  let view: View = { kind: "loading" };
  let resetting = false;
  let resetError: string | null = null;

  const reset = createButton(doc, {
    label: RESET_LABEL,
    variant: "ghost",
    size: "sm",
    onClick: () => void resetAll(),
  });
  const head = doc.createElement("div");
  head.className = "settings-models-head";
  head.append(
    buildText(doc, {
      tone: "muted",
      content:
        "Haiku 5.5 is fast and uses the least of your limit. Sonnet 5.5 is smarter and uses more. Opus 5.5 uses the most. More effort means more thinking, which also uses more. How fast each model uses the limit is Unverified.",
    }),
    reset,
  );
  const offNote = doc.createElement("div");
  offNote.className = "settings-models-note";
  const content = doc.createElement("div");
  content.className = "settings-models-rows";
  const resetNote = doc.createElement("div");
  resetNote.className = "settings-models-note";

  const element = createCard({
    doc,
    element: "section",
    label: MODELS_TITLE,
    title: MODELS_TITLE,
    level: 2,
    children: [head, offNote, content, resetNote],
  });
  element.classList.add("settings-card");

  function draw(): void {
    reset.disabled = view.kind !== "ready";
    resetNote.replaceChildren(
      ...(resetError
        ? [
            buildBanner({
              tone: "bad",
              lead: "Could not reset.",
              message: `${resetError} Your choices did not change.`,
            }),
          ]
        : []),
    );
    if (view.kind === "loading") {
      content.replaceChildren(
        buildText(doc, { tone: "muted", content: "Reading the AI models…" }),
        buildSkeleton(),
      );
      return;
    }
    if (view.kind === "failed") {
      content.replaceChildren(
        buildBanner({
          tone: "bad",
          lead: "Could not read the AI models.",
          message: `${view.text} Each feature uses its default model.`,
          action: { label: "Try again", onClick: () => void load() },
        }),
      );
      return;
    }
    const table = view.table;
    content.replaceChildren(
      createSettingsRows(doc, {
        label: MODELS_TITLE,
        rows: table.rows.map((row) => buildRow(table, row)),
      }),
    );
  }

  function buildRow(table: AiModelTable, start: AiModelRow): HTMLElement {
    // What the core has saved for this row; a refused change goes back to it.
    let saved = { model: start.model, effort: start.effort };
    const model = createSelect(doc, {
      options: table.models.map((c) => c.label),
      value: labelOf(table.models, saved.model),
      inline: true,
    });
    model.select.setAttribute("aria-label", `Model for ${start.label}`);
    const effort = createSelect(doc, {
      options: table.efforts.map((c) => c.label),
      value: labelOf(table.efforts, saved.effort),
      inline: true,
    });
    effort.select.setAttribute("aria-label", `Effort for ${start.label}`);
    const row = createSettingsRow(doc, {
      label: start.label,
      controls: [model.wrap, effort.wrap],
    });

    const putBack = (): void => {
      model.select.value = labelOf(table.models, saved.model);
      effort.select.value = labelOf(table.efforts, saved.effort);
    };

    const save = async (): Promise<void> => {
      const nextModel = choiceValue(table.models, model.select.value);
      const nextEffort = choiceValue(table.efforts, effort.select.value);
      if (!nextModel || !nextEffort) {
        putBack();
        setSettingsRowError(row, "That choice is not allowed.");
        return;
      }
      setSettingsRowDisabled(row, true);
      try {
        const next = await deps.setAiModel(
          start.feature,
          nextModel,
          nextEffort,
        );
        view = { kind: "ready", table: next };
        saved = { model: nextModel, effort: nextEffort };
        setSettingsRowError(row, null);
      } catch (error) {
        console.error("could not save the AI model:", error);
        putBack();
        setSettingsRowError(
          row,
          `Mnemo could not save this choice. ${errorMessage(error)} The old choice stays.`,
        );
      } finally {
        setSettingsRowDisabled(row, false);
      }
    };
    model.select.addEventListener("change", () => void save());
    effort.select.addEventListener("change", () => void save());
    return row;
  }

  async function load(): Promise<void> {
    view = { kind: "loading" };
    draw();
    try {
      view = { kind: "ready", table: await deps.listAiModels() };
    } catch (error) {
      console.error("could not read the AI models:", error);
      view = { kind: "failed", text: errorMessage(error) };
    }
    draw();
  }

  async function resetAll(): Promise<void> {
    if (resetting || view.kind !== "ready") return;
    resetting = true;
    setButtonBusy(reset, true, {
      label: RESET_LABEL,
      variant: "ghost",
      size: "sm",
    });
    try {
      view = { kind: "ready", table: await deps.resetAiModels() };
      resetError = null;
    } catch (error) {
      console.error("could not reset the AI models:", error);
      resetError = `Mnemo could not reset the models. ${errorMessage(error)}`;
    } finally {
      resetting = false;
      setButtonBusy(reset, false, {
        label: RESET_LABEL,
        variant: "ghost",
        size: "sm",
      });
      draw();
    }
  }

  function setAiOff(off: boolean): void {
    offNote.replaceChildren(
      ...(off
        ? [
            buildBanner({
              tone: "info",
              message:
                "AI is off now. You can still change these choices; each feature uses them when AI runs again.",
            }),
          ]
        : []),
    );
  }

  void load();
  return { element, setAiOff };
}
