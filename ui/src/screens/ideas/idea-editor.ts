// The idea editor of the Ideas screen (#34): the fields of one idea, the four plain checks and
// "Turn into project". Every part comes from ui/src/ds (parts confirmed by the Storehouse keeper);
// ideas.css lays them out. All text goes in as text, never as markup.
import {
  buildDotLabel,
  buildEmptyState,
  buildProgress,
  buildText,
  type Choice,
  createButton,
  createCard,
  createChoiceList,
  createField,
  createSegmented,
  createTagInput,
  createTextarea,
  createTextInput,
  setButtonBusy,
  setProgress,
} from "../../ds";
import type { Idea, IdeaInput } from "../../shared/api";
import {
  adviceText,
  checkLines,
  type FieldName,
  fieldOfError,
  formChecks,
  formOf,
  type IdeaForm,
  linkError,
  passedCount,
  stageLabel,
  toInput,
} from "./idea-logic";

const SOURCE_MODES = {
  None: "none",
  "Saved item": "item",
  Link: "link",
} as const;
type SourceLabel = keyof typeof SOURCE_MODES;
const MODE_LABEL: Record<IdeaForm["sourceMode"], SourceLabel> = {
  none: "None",
  item: "Saved item",
  link: "Link",
};

export interface IdeaEditorOptions {
  /** The idea to edit, or null for a new one. */
  idea: Idea | null;
  /** The owner's saved bookmarks and notes, as "<kind>:<id>" choices. */
  savedItems: readonly Choice[];
  /** Saves the input; `form` is what the owner typed, kept if the save is refused. */
  save(input: IdeaInput, form: IdeaForm): Promise<void>;
  /** "Turn into project" for the saved idea. */
  turnIntoProject(id: string): Promise<void>;
  /** What the owner typed before a refused save. Defaults to the idea's saved values. */
  draft?: IdeaForm | null;
  /** A refused save, to show next to its field. */
  error?: { field: FieldName; message: string } | null;
}

/** Builds the editor. The caller replaces it after each save, so the stage comes from the core. */
export function createIdeaEditor(
  doc: Document,
  options: IdeaEditorOptions,
): HTMLElement {
  const { idea } = options;
  const form: IdeaForm = { ...(options.draft ?? formOf(idea)) };
  const errorFor = (f: FieldName): string | undefined =>
    options.error?.field === f ? options.error.message : undefined;

  const title = createTextInput(doc, { value: form.title });
  title.addEventListener("input", () => {
    form.title = title.value;
  });
  const text = createTextarea(doc, { value: form.text });
  text.addEventListener("input", () => {
    form.text = text.value;
    refresh();
  });
  const why = createTextInput(doc, { value: form.why });
  why.addEventListener("input", () => {
    form.why = why.value;
    refresh();
  });
  const outline = createTextarea(doc, { value: form.outline });
  outline.addEventListener("input", () => {
    form.outline = outline.value;
    refresh();
  });
  const tags = createTagInput(doc, {
    tags: form.tags,
    placeholder: "Type a tag and press Enter",
    onChange: (next) => {
      form.tags = next;
      refresh();
    },
  });

  // The source: none, one saved item, or a link.
  const sourceBody = doc.createElement("div");
  sourceBody.className = "idea-source";
  const url = createTextInput(doc, { type: "url", value: form.sourceUrl });
  const linkErrorFor = () => errorFor("link") ?? linkError(form) ?? undefined;
  const drawSource = () => {
    if (form.sourceMode === "link") {
      sourceBody.replaceChildren(
        createField(doc, {
          label: "Link",
          control: url,
          hint: "A web address, for example https://example.com/page",
          error: linkErrorFor(),
        }),
      );
    } else if (form.sourceMode === "item") {
      if (options.savedItems.length === 0) {
        sourceBody.replaceChildren(
          buildEmptyState({
            title: "No saved items yet.",
            body: "Save a link or write a note first.",
          }),
        );
      } else {
        const list = createChoiceList(doc, {
          legend: "Saved item",
          name: "idea-source",
          choices: options.savedItems,
          value: form.sourceItem || undefined,
          onChange: (v) => {
            form.sourceItem = v;
            refresh();
          },
        });
        const err = errorFor("link");
        if (err) list.setError(err);
        sourceBody.replaceChildren(list.element);
      }
    } else {
      sourceBody.replaceChildren();
    }
  };
  url.addEventListener("input", () => {
    form.sourceUrl = url.value;
    refresh();
  });
  url.addEventListener("change", drawSource);
  const mode = createSegmented(doc, {
    label: "Source",
    options: Object.keys(SOURCE_MODES),
    value: MODE_LABEL[form.sourceMode],
    onChange: (label) => {
      form.sourceMode = SOURCE_MODES[label as SourceLabel] ?? "none";
      drawSource();
      refresh();
    },
  });
  drawSource();

  // The segmented group carries its own accessible name; this is the visible word.
  const sourceLabel = buildText(doc, { as: "span", content: "Source" });
  sourceLabel.setAttribute("aria-hidden", "true");

  const fields = doc.createElement("div");
  fields.className = "idea-fields";
  fields.append(
    createField(doc, {
      label: "Title (required)",
      control: title,
      error: errorFor("title"),
    }),
    createField(doc, { label: "Text", control: text, error: errorFor("text") }),
    createField(doc, {
      label: "Tags",
      control: tags.wrap,
      target: tags.input,
      hint: "Removing a tag can move the idea back a stage. Nothing is deleted.",
      error: errorFor("tags"),
    }),
    sourceLabel,
    mode,
    sourceBody,
    createField(doc, {
      label: "Why I want this",
      control: why,
      hint: "One sentence.",
      error: errorFor("why"),
    }),
    createField(doc, {
      label: "Outline",
      control: outline,
      hint: "One point per line.",
      error: errorFor("outline"),
    }),
  );

  // The four checks: advice only, nothing is disabled by them.
  const checkList = doc.createElement("div");
  checkList.className = "idea-checks";
  const score = buildText(doc, { as: "span", tone: "muted", content: "" });
  const bar = buildProgress({ label: "Ready to become a project", value: 0 });
  const advice = buildText(doc, { tone: "muted", content: "" });
  function refresh(): void {
    const checks = formChecks(form);
    const n = passedCount(checks);
    checkList.replaceChildren(
      ...checkLines(checks).map((line) => {
        return buildDotLabel(line.text, line.ok ? "good" : "off");
      }),
    );
    score.textContent = `${n} of 4`;
    setProgress(bar, n * 25, "Ready to become a project");
    advice.textContent = `${adviceText(checks)} Plain code checks these 4 points. No AI.`;
  }
  refresh();

  const checksHead = doc.createElement("div");
  checksHead.className = "idea-checks-head";
  checksHead.append(
    buildText(doc, { as: "span", content: "Ready to become a project?" }),
    score,
  );

  // Actions: Save, and Turn into project (the one primary action) for a saved idea.
  const saveLook = {
    label: idea ? "Save idea" : "Add idea",
    variant: idea ? ("default" as const) : ("primary" as const),
  };
  const save = createButton(doc, saveLook);
  save.addEventListener("click", () => {
    if (save.getAttribute("aria-busy") === "true") return;
    setButtonBusy(save, true, saveLook);
    options.save(toInput(form), { ...form }).finally(() => {
      if (save.isConnected) setButtonBusy(save, false, saveLook);
    });
  });
  const actions = doc.createElement("div");
  actions.className = "idea-actions";
  actions.append(save);

  const stageLine = buildText(doc, {
    tone: "muted",
    content: idea
      ? `Stage: ${stageLabel(idea.stage)}. The stage follows the checks after you save.`
      : "A new idea starts as a Spark.",
  });

  if (idea && idea.stage !== "project") {
    const turn = createButton(doc, {
      label: "Turn into project",
      variant: "primary",
    });
    turn.addEventListener("click", () => {
      if (turn.getAttribute("aria-busy") === "true") return;
      setButtonBusy(turn, true, {
        label: "Turn into project",
        variant: "primary",
      });
      options.turnIntoProject(idea.id).finally(() => {
        if (turn.isConnected)
          setButtonBusy(turn, false, {
            label: "Turn into project",
            variant: "primary",
          });
      });
    });
    actions.append(turn);
  } else if (idea) {
    stageLine.textContent = idea.projectId
      ? "Stage: Project. This idea is now a project; the idea is kept. The project page comes later."
      : "Stage: Project.";
  }

  const checksCard = createCard({
    doc,
    element: "section",
    label: "Ready to become a project?",
    children: [checksHead, bar, checkList, advice],
  });

  return createCard({
    doc,
    element: "section",
    title: idea ? idea.title : "New idea",
    level: 2,
    label: idea ? `Idea: ${idea.title}` : "New idea",
    children: [stageLine, fields, checksCard, actions],
  });
}

/** Where a refused save belongs, from the core's message. */
export function editorError(message: string): {
  field: FieldName;
  message: string;
} {
  return { field: fieldOfError(message), message };
}
