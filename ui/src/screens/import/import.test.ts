// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ImportPreview, ImportStatus } from "../../shared/api";
import {
  baseName,
  type ImportDeps,
  progressOptions,
  renderImport,
} from "./import";

const preview: ImportPreview = {
  fileName: "bookmarks.html",
  found: 55,
  toAdd: 50,
  repeatsInFile: 3,
  alreadySaved: 0,
  notLinks: 2,
};

function status(over: Partial<ImportStatus> = {}): ImportStatus {
  return {
    id: "imp-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    fileName: "bookmarks.html",
    state: "running",
    pausedBy: null,
    withSummaries: true,
    found: 55,
    added: 50,
    repeatsInFile: 3,
    alreadySaved: 0,
    notLinks: 2,
    done: 0,
    waiting: 50,
    failed: 0,
    waitReason: null,
    removed: 0,
    maxRuns: 2,
    retry: null,
    ...over,
  };
}

/** Fake calls; `emit` sends an import-changed event to the page. */
function setup(over: Partial<ImportDeps> = {}) {
  let handler: ((s: ImportStatus) => void) | null = null;
  const deps: ImportDeps = {
    pickImportFile: vi.fn(async () => "/mock/folder/bookmarks.html"),
    previewImport: vi.fn(async () => preview),
    startImport: vi.fn(async (_p: string, withSummaries: boolean) =>
      status({ withSummaries }),
    ),
    getImport: vi.fn(async () => null),
    pauseImport: vi.fn(async () =>
      status({ state: "paused", pausedBy: "owner" }),
    ),
    continueImport: vi.fn(async () => status()),
    stopImport: vi.fn(async () => status({ state: "stopped", waiting: 0 })),
    onImportChanged: vi.fn(async (h: (s: ImportStatus) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    }),
    backToBookmarks: vi.fn(),
    ...over,
  };
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const leave = renderImport(container, deps);
  return {
    deps,
    container,
    leave,
    emit: (s: ImportStatus) => handler?.(s),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found)
    throw new Error(`no button "${text}" in: ${container.textContent}`);
  return found;
}

function hasButton(container: HTMLElement, text: string): boolean {
  return [...container.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === text,
  );
}

function currentStep(container: HTMLElement): string {
  return container.querySelector('[aria-current="step"]')?.textContent ?? "";
}

describe("Import page", () => {
  it("opens on the pick step with the browser hints and Back to Bookmarks", async () => {
    const { container, deps } = setup();
    await settle();
    expect(container.textContent).toContain("Import bookmarks");
    expect(container.textContent).toContain("Bookmark manager › Export");
    expect(currentStep(container)).toContain("Pick a file");
    button(container, "Back to Bookmarks").click();
    expect(deps.backToBookmarks).toHaveBeenCalled();
  });

  it("checks the file before anything is stored and shows its counts", async () => {
    const { container, deps } = setup();
    await settle();
    button(container, "Choose a file").click();
    await settle();
    await settle();
    expect(deps.previewImport).toHaveBeenCalledWith(
      "/mock/folder/bookmarks.html",
    );
    expect(deps.startImport).not.toHaveBeenCalled();
    expect(currentStep(container)).toContain("Check");
    expect(container.textContent).toContain("bookmarks.html");
    expect(hasButton(container, "Import 50 links")).toBe(true);
  });

  it("Cancel at Check goes back with nothing imported", async () => {
    const { container, deps } = setup();
    await settle();
    button(container, "Choose a file").click();
    await settle();
    await settle();
    button(container, "Cancel").click();
    await settle();
    expect(deps.startImport).not.toHaveBeenCalled();
    expect(currentStep(container)).toContain("Pick a file");
  });

  it("imports with summaries, or as link only when the box is ticked", async () => {
    const one = setup();
    await settle();
    button(one.container, "Choose a file").click();
    await settle();
    await settle();
    button(one.container, "Import 50 links").click();
    await settle();
    expect(one.deps.startImport).toHaveBeenCalledWith(
      "/mock/folder/bookmarks.html",
      true,
    );
    expect(currentStep(one.container)).toContain("Import");
    one.leave();

    const two = setup();
    await settle();
    button(two.container, "Choose a file").click();
    await settle();
    await settle();
    const box = two.container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    if (!box) throw new Error("no checkbox");
    box.click();
    button(two.container, "Import 50 links").click();
    await settle();
    expect(two.deps.startImport).toHaveBeenCalledWith(
      "/mock/folder/bookmarks.html",
      false,
    );
  });

  it("says why the file could not be read and that nothing was imported", async () => {
    const { container } = setup({
      previewImport: vi.fn(async () => {
        throw {
          code: "invalid_input",
          message: "Mnemo could not read that file. Pick another file.",
        };
      }),
    });
    await settle();
    button(container, "Choose a file").click();
    await settle();
    await settle();
    expect(container.textContent).toContain("Mnemo could not read that file.");
    expect(container.textContent).toContain("Nothing was imported.");
  });

  it("follows progress events and shows Done with the counts at the end", async () => {
    const { container, emit } = setup({
      getImport: vi.fn(async () => status({ done: 3, waiting: 47 })),
    });
    await settle();
    expect(container.textContent).toContain(
      "3 done, 47 waiting, 0 failed of 50",
    );
    emit(status({ done: 20, waiting: 28, failed: 2 }));
    expect(container.textContent).toContain(
      "20 done, 28 waiting, 2 failed of 50",
    );
    // An older event never puts a lower count back.
    emit(status({ done: 10, waiting: 40 }));
    expect(container.textContent).toContain("20 done");
    emit(status({ state: "finished", done: 48, waiting: 0, failed: 2 }));
    expect(currentStep(container)).toContain("Done");
    expect(container.textContent).toContain(
      "Import finished: 48 saved with a summary, 2 saved as link only",
    );
  });

  it("shows the reason while it waits at the usage limit, with Pause", async () => {
    const { container } = setup({
      getImport: vi.fn(async () =>
        status({ done: 2, waiting: 48, waitReason: "limit" }),
      ),
    });
    await settle();
    expect(container.textContent).toContain("Claude is at its usage limit.");
    expect(hasButton(container, "Pause")).toBe(true);
  });

  it("opens an import a Quit left behind as paused with its counts, and Continue resumes it", async () => {
    const { container, deps } = setup({
      getImport: vi.fn(async () =>
        status({
          state: "paused",
          pausedBy: "closed",
          done: 12,
          waiting: 36,
          failed: 2,
        }),
      ),
    });
    await settle();
    expect(container.textContent).toContain("Paused when Mnemo closed.");
    expect(container.textContent).toContain(
      "12 done, 36 waiting, 2 failed of 50",
    );
    button(container, "Continue").click();
    await settle();
    expect(deps.continueImport).toHaveBeenCalledWith("imp-1");
  });

  it("Pause pauses this import, and Stop here ends it on the Done step", async () => {
    const { container, deps } = setup({
      getImport: vi.fn(async () => status()),
    });
    await settle();
    button(container, "Pause").click();
    await settle();
    expect(deps.pauseImport).toHaveBeenCalledWith("imp-1");
    expect(hasButton(container, "Continue")).toBe(true);
    button(container, "Stop here").click();
    await settle();
    // It cannot be undone: nothing stops until the owner confirms.
    expect(deps.stopImport).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>("dialog");
    if (!dialog) throw new Error("no confirm dialog");
    button(dialog, "Stop here").click();
    await settle();
    expect(deps.stopImport).toHaveBeenCalledWith("imp-1");
    expect(currentStep(container)).toContain("Done");
    expect(container.textContent).toContain("Import stopped:");
    expect(hasButton(container, "Import another file")).toBe(true);
  });

  it("Keep importing in the Stop here confirm stops nothing", async () => {
    const { container, deps } = setup({
      getImport: vi.fn(async () => status()),
    });
    await settle();
    button(container, "Stop here").click();
    const dialog = document.querySelector<HTMLElement>("dialog");
    if (!dialog) throw new Error("no confirm dialog");
    expect(dialog.textContent).toContain("50 links still waiting");
    button(dialog, "Keep importing").click();
    await settle();
    expect(deps.stopImport).not.toHaveBeenCalled();
    expect(hasButton(container, "Pause")).toBe(true);
  });

  it("after Stop here and a new import, a late event of the stopped import never replaces it", async () => {
    const { container, emit } = setup({
      getImport: vi.fn(async () => status({ id: "imp-old" })),
      stopImport: vi.fn(async () =>
        status({ id: "imp-old", state: "stopped", done: 3, waiting: 0 }),
      ),
      startImport: vi.fn(async () =>
        status({ id: "imp-new", done: 0, waiting: 50 }),
      ),
    });
    await settle();
    button(container, "Stop here").click();
    const dialog = document.querySelector<HTMLElement>("dialog");
    if (!dialog) throw new Error("no confirm dialog");
    button(dialog, "Stop here").click();
    await settle();
    button(container, "Import another file").click();
    button(container, "Choose a file").click();
    await settle();
    await settle();
    button(container, "Import 50 links").click();
    await settle();
    expect(container.textContent).toContain(
      "0 done, 50 waiting, 0 failed of 50",
    );
    // The stopped import's worker sends its last state late.
    emit(status({ id: "imp-old", state: "stopped", done: 3, waiting: 0 }));
    expect(currentStep(container)).toContain("Import");
    expect(container.textContent).not.toContain("Import stopped:");
    // Events of the shown import still come through.
    emit(status({ id: "imp-new", done: 5, waiting: 45 }));
    expect(container.textContent).toContain("5 done, 45 waiting");
  });

  it("shows a failed Pause as a line and keeps the progress", async () => {
    const { container } = setup({
      getImport: vi.fn(async () => status()),
      pauseImport: vi.fn(async () => {
        throw {
          code: "storage_error",
          message: "Mnemo could not save the import. Nothing was deleted.",
        };
      }),
    });
    await settle();
    button(container, "Pause").click();
    await settle();
    expect(container.textContent).toContain("Mnemo could not save the import.");
    expect(hasButton(container, "Pause")).toBe(true);
  });

  it("stops listening when the page is left", async () => {
    const { leave, emit, container } = setup({
      getImport: vi.fn(async () => status()),
    });
    await settle();
    leave();
    emit(status({ done: 40, waiting: 10 }));
    expect(container.textContent).not.toContain("40 done");
  });
});

describe("Import page helpers", () => {
  it("takes the base name of a picked path", () => {
    expect(baseName("/mock/folder/bookmarks.html")).toBe("bookmarks.html");
    expect(baseName("C:\\mock\\links.txt")).toBe("links.txt");
  });

  it("maps an import to the progress line's state and reason", () => {
    expect(progressOptions(status(), false).state).toBe("running");
    const retrying = progressOptions(
      status({ retry: { reason: "storage", seconds: 10 } }),
      false,
    );
    expect(retrying.state).toBe("waiting");
    expect(retrying.reason).toMatch(/could not save the import/);
    const waiting = progressOptions(status({ waitReason: "off" }), false);
    expect(waiting.state).toBe("waiting");
    expect(waiting.reason).toMatch(/AI is off/);
    const paused = progressOptions(
      status({ state: "paused", pausedBy: "owner" }),
      true,
    );
    expect(paused.state).toBe("paused");
    expect(paused.pending).toBe(true);
    expect(
      progressOptions(status({ done: 5, waiting: 40, failed: 5 }), false).total,
    ).toBe(50);
  });
});
