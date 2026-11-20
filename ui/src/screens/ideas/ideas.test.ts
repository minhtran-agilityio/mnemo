// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { Idea, IdeaChecks, IdeaInput, Page } from "../../shared/api";
import { createIdeaEditor } from "./idea-editor";
import { type IdeasDeps, renderIdeas, sourceChoices } from "./ideas";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const none: IdeaChecks = {
  hasTag: false,
  hasSource: false,
  hasWhy: false,
  hasOutline: false,
};
const all: IdeaChecks = {
  hasTag: true,
  hasSource: true,
  hasWhy: true,
  hasOutline: true,
};

function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: "i1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    title: "Garden robot",
    text: null,
    source: { type: "link", url: "https://example.com/soil" },
    why: "So the plants live.",
    outline: "Sensor\nPump",
    tags: ["garden"],
    stage: "ready",
    checks: all,
    projectId: null,
    ...over,
  };
}

const page = <T>(items: T[]): Page<T> => ({ items, next: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

function deps(over: Partial<IdeasDeps> = {}): IdeasDeps {
  return {
    listIdeas: vi.fn(async () => page([idea()])),
    addIdea: vi.fn(async (i: IdeaInput) => idea({ ...i, id: "new" })),
    updateIdea: vi.fn(async (_id: string, i: IdeaInput) =>
      idea({
        ...i,
        tags: i.tags,
        stage: "shape",
        checks: { ...all, hasTag: i.tags.length > 0 },
      }),
    ),
    turnIdeaIntoProject: vi.fn(async () => ({
      idea: idea({ stage: "project", projectId: "p1" }),
    })),
    listBookmarks: vi.fn(async () => page([])),
    listNotes: vi.fn(async () => page([])),
    ...over,
  };
}

test("removing a tag updates the checks at once and the save sends the idea without it", async () => {
  const d = deps();
  const box = document.createElement("main");
  document.body.append(box);
  renderIdeas(box, d);
  await flush();
  expect(box.textContent).toContain("4 of 4");
  const remove = box.querySelector<HTMLButtonElement>(
    '[aria-label="Remove tag garden"]',
  );
  expect(remove).not.toBeNull();
  remove?.click();
  expect(box.textContent).toContain("3 of 4");
  expect(box.textContent).toContain("No tag yet.");
  const save = [...box.querySelectorAll("button")].find(
    (b) => b.textContent === "Save idea",
  );
  save?.click();
  await flush();
  expect(d.updateIdea).toHaveBeenCalledWith("i1", {
    title: "Garden robot",
    text: null,
    source: { type: "link", url: "https://example.com/soil" },
    why: "So the plants live.",
    outline: "Sensor\nPump",
    tags: [],
  });
  expect(box.textContent).toContain("Stage: Shape");
  box.remove();
});

test("Turn into project is offered at a Spark too and shows the confirmation", async () => {
  const d = deps({
    listIdeas: vi.fn(async () =>
      page([idea({ stage: "spark", checks: none, tags: [] })]),
    ),
  });
  const box = document.createElement("main");
  document.body.append(box);
  renderIdeas(box, d);
  await flush();
  const turn = [...box.querySelectorAll("button")].find(
    (b) => b.textContent === "Turn into project",
  );
  expect(turn).toBeDefined();
  turn?.click();
  await flush();
  expect(d.turnIdeaIntoProject).toHaveBeenCalledWith("i1");
  expect(box.textContent).toContain(
    "Project created from your idea. The idea is kept.",
  );
  expect(box.textContent).toContain("This idea is now a project");
  expect(
    [...box.querySelectorAll("button")].some(
      (b) => b.textContent === "Turn into project",
    ),
  ).toBe(false);
  box.remove();
});

test("a failed load says so and offers Try again; a refused save shows next to its field", async () => {
  const listIdeas = vi
    .fn()
    .mockRejectedValueOnce({ code: "storage_error", message: "Disk busy." })
    .mockResolvedValue(page([]));
  const d = deps({
    listIdeas,
    addIdea: vi.fn(async () => {
      throw { code: "invalid_input", message: "The title cannot be empty." };
    }),
  });
  const box = document.createElement("main");
  document.body.append(box);
  renderIdeas(box, d);
  await flush();
  expect(box.textContent).toContain("Mnemo could not read your ideas.");
  [...box.querySelectorAll("button")]
    .find((b) => b.textContent === "Try again")
    ?.click();
  await flush();
  expect(box.textContent).toContain("No ideas yet.");
  [...box.querySelectorAll("button")]
    .find((b) => b.textContent === "Add idea")
    ?.click();
  await flush();
  expect(box.textContent).toContain("The title cannot be empty.");
  expect(box.querySelector('[aria-invalid="true"]')).not.toBeNull();
  box.remove();
});

test("the source picker lists saved items by id, so equal titles stay apart", () => {
  const b = (id: string) => ({
    id,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    url: "https://a.example/x",
    title: "Same",
    summary: null,
    reason: null,
    reasonIsGuess: false,
  });
  const choices = sourceChoices(
    [b("b1"), b("b2")],
    [
      {
        id: "n1",
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
        body: "\n# Plan\nmore",
      },
    ],
  );
  expect(choices.map((c) => c.value)).toEqual([
    "bookmark:b1",
    "bookmark:b2",
    "note:n1",
  ]);
  expect(choices[2].label).toBe("# Plan");
  expect(choices[0].hint).toBe("Saved link · a.example");
});

test("a new idea starts empty with Add idea as the primary action and no Turn into project", () => {
  const el = createIdeaEditor(document, {
    idea: null,
    savedItems: [],
    save: async () => {},
    turnIntoProject: async () => {},
  });
  const labels = [...el.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toContain("Add idea");
  expect(labels).not.toContain("Turn into project");
  expect(el.textContent).toContain("0 of 4");
});

test("the board groups ideas by stage and a card opens its idea", async () => {
  const d = deps({
    listIdeas: vi.fn(async () =>
      page([
        idea({
          id: "a",
          title: "Alpha",
          stage: "spark",
          checks: none,
          tags: [],
        }),
        idea({ id: "b", title: "Beta", stage: "ready" }),
        idea({ id: "c", title: "Gamma", stage: "project", projectId: "p1" }),
      ]),
    ),
  });
  const box = document.createElement("main");
  document.body.append(box);
  renderIdeas(box, d);
  await flush();
  const column = (name: string) =>
    box.querySelector<HTMLElement>(`[aria-label="${name}"]`);
  expect(column("Spark")?.textContent).toContain("Alpha");
  expect(column("Ready")?.textContent).toContain("Beta");
  expect(column("Project")?.textContent).toContain("Gamma");
  expect(column("Shape")?.textContent).toContain("No idea here yet.");
  const beta = [...box.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Beta"),
  );
  expect(beta).toBeDefined();
  beta?.click();
  expect(box.querySelector('[aria-current="true"]')?.textContent).toContain(
    "Beta",
  );
  expect(box.querySelector("h2")?.textContent).toBe("Ideas");
  expect(box.textContent).toContain("Stage: Ready");
  box.remove();
});

test("a refused save keeps what the owner typed", async () => {
  const d = deps({
    updateIdea: vi.fn(async () => {
      throw {
        code: "invalid_input",
        message: "The why line must be null or 1 to 500 characters.",
      };
    }),
  });
  const box = document.createElement("main");
  document.body.append(box);
  renderIdeas(box, d);
  await flush();
  const title = box.querySelector<HTMLInputElement>("input.input");
  if (!title) throw new Error("no title input");
  title.value = "Garden robot, take two";
  title.dispatchEvent(new Event("input"));
  [...box.querySelectorAll("button")]
    .find((b) => b.textContent === "Save idea")
    ?.click();
  await flush();
  expect(box.textContent).toContain("The why line must be null");
  expect(box.querySelector<HTMLInputElement>("input.input")?.value).toBe(
    "Garden robot, take two",
  );
  box.remove();
});

test("the screen asks main for the whole width and gives it back on leave", async () => {
  const box = document.createElement("main");
  document.body.append(box);
  const leave = renderIdeas(box, deps());
  expect(box.dataset.layout).toBe("wide");
  leave();
  expect(box.dataset.layout).toBeUndefined();
  box.remove();
});
