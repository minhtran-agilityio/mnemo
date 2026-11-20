// The Ideas screen (#34): ideas grouped by stage (Spark, Shape, Ready, Project) and the editor of
// the open idea. The stage comes from the core's four plain checks; this screen never sets it.
// Every part comes from ui/src/ds; ideas.css lays them out. All text goes in as text.
import {
  buildBusyLine,
  buildEmptyState,
  buildErrorState,
  type Choice,
  createButton,
  createPageHeader,
  createPanel,
  createToastRegion,
} from "../../ds";
import { findItem } from "../../frame/nav";
import type {
  Bookmark,
  Idea,
  IdeaInput,
  ListArgs,
  Note,
  Page,
} from "../../shared/api";
import { errorMessage } from "../../shared/api";
import { createIdeaEditor, editorError } from "./idea-editor";
import type { FieldName } from "./idea-logic";

/** The calls the screen makes; main.ts passes the typed client from shared/api. */
export interface IdeasDeps {
  listIdeas(args: ListArgs): Promise<Page<Idea>>;
  addIdea(input: IdeaInput): Promise<Idea>;
  updateIdea(id: string, input: IdeaInput): Promise<Idea>;
  turnIdeaIntoProject(id: string): Promise<{ idea: Idea }>;
  listBookmarks(args: ListArgs): Promise<Page<Bookmark>>;
  listNotes(args: ListArgs): Promise<Page<Note>>;
}

/** How many ideas the screen reads (one page). More pages come with search (#31). */
export const IDEAS_PAGE = 100;
/** How many saved items of each type the source picker offers. */
export const SOURCE_PAGE = 50;
const LABEL_CHARS = 80;

function short(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const t = line.trim();
  return t.length > LABEL_CHARS ? `${t.slice(0, LABEL_CHARS - 1)}…` : t;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Not a parsable address: show it as it is.
    return url;
  }
}

/** The owner's saved items as source choices: value "<kind>:<id>". */
export function sourceChoices(
  bookmarks: readonly Bookmark[],
  notes: readonly Note[],
): Choice[] {
  return [
    ...bookmarks.map((b) => ({
      value: `bookmark:${b.id}`,
      label: short(b.title ?? b.url) || b.url,
      hint: `Saved link · ${hostOf(b.url)}`,
    })),
    ...notes.map((n) => ({
      value: `note:${n.id}`,
      label: short(n.body) || "Untitled note",
      hint: "Note",
    })),
  ];
}

/** Fills `container` with the Ideas screen. Returns a function that cleans up on leave. */
export function renderIdeas(
  container: HTMLElement,
  deps: IdeasDeps,
): () => void {
  const doc = container.ownerDocument;
  let left = false;
  // The one place this screen keeps its state.
  const state: {
    ideas: Idea[];
    openId: string | null;
    savedItems: Choice[];
    error: { field: FieldName; message: string } | null;
  } = { ideas: [], openId: null, savedItems: [], error: null };

  const toasts = createToastRegion();
  const newIdea = createButton(doc, { label: "New idea" });
  newIdea.addEventListener("click", () => {
    state.openId = null;
    state.error = null;
    drawEditor();
  });
  // Every roadmap screen names its phase, like Settings does.
  const phase = findItem("ideas")?.phase;
  const header = createPageHeader({
    doc,
    title: "Ideas",
    crumb: phase === undefined ? undefined : `Phase ${phase}`,
    context:
      "An idea grows from a spark into a project. Four plain checks show how ready it is; they never block you.",
    actions: [newIdea],
  });

  const body = doc.createElement("div");
  body.className = "ideas-layout";
  // The stage board (Spark, Shape, Ready, Project) waits for UI component request 129 (idea board with
  // button cards). It is drawn here when that part is merged; no stand-in until then.
  const board = doc.createElement("div");
  board.className = "ideas-board";
  const editorSlot = doc.createElement("div");
  editorSlot.className = "ideas-editor";
  body.append(board, editorSlot);
  container.replaceChildren(header, body, toasts.element);

  const open = (): Idea | null =>
    state.ideas.find((i) => i.id === state.openId) ?? null;

  function put(idea: Idea): void {
    const at = state.ideas.findIndex((i) => i.id === idea.id);
    if (at < 0) state.ideas.unshift(idea);
    else state.ideas[at] = idea;
  }

  function refused(error: unknown): void {
    state.error = editorError(errorMessage(error));
    drawEditor();
  }

  async function save(input: IdeaInput): Promise<void> {
    const current = open();
    try {
      const saved = current
        ? await deps.updateIdea(current.id, input)
        : await deps.addIdea(input);
      if (left) return;
      put(saved);
      state.openId = saved.id;
      state.error = null;
      drawEditor();
      toasts.show(current ? "Idea saved." : "Idea added.");
    } catch (error) {
      if (!left) refused(error);
    }
  }

  async function turnIntoProject(id: string): Promise<void> {
    try {
      const { idea } = await deps.turnIdeaIntoProject(id);
      if (left) return;
      put(idea);
      state.error = null;
      drawEditor();
      toasts.show("Project created from your idea. The idea is kept.");
    } catch (error) {
      if (!left)
        toasts.show(`Mnemo could not make the project. ${errorMessage(error)}`);
    }
  }

  function drawEditor(): void {
    editorSlot.replaceChildren(
      createIdeaEditor(doc, {
        idea: open(),
        savedItems: state.savedItems,
        save,
        turnIntoProject,
        error: state.error,
      }),
    );
  }

  async function load(): Promise<void> {
    editorSlot.replaceChildren(buildBusyLine("Loading your ideas…"));
    try {
      const [ideas, bookmarks, notes] = await Promise.all([
        deps.listIdeas({ limit: IDEAS_PAGE }),
        deps.listBookmarks({ limit: SOURCE_PAGE }),
        deps.listNotes({ limit: SOURCE_PAGE }),
      ]);
      if (left) return;
      state.ideas = ideas.items;
      state.savedItems = sourceChoices(bookmarks.items, notes.items);
      if (state.ideas.length === 0) {
        editorSlot.replaceChildren(
          createPanel({
            doc,
            children: [
              buildEmptyState({
                title: "No ideas yet.",
                body: "Write the first one below. It starts as a Spark.",
              }),
            ],
          }),
        );
        editorSlot.append(
          createIdeaEditor(doc, {
            idea: null,
            savedItems: state.savedItems,
            save,
            turnIntoProject,
          }),
        );
        return;
      }
      state.openId = state.ideas[0]?.id ?? null;
      drawEditor();
    } catch (error) {
      if (left) return;
      editorSlot.replaceChildren(
        buildErrorState({
          title: "Mnemo could not read your ideas.",
          body: `Nothing was changed. ${errorMessage(error)}`,
          action: { label: "Try again", onClick: () => void load() },
        }),
      );
    }
  }

  void load();
  return () => {
    left = true;
  };
}
