import { describe, expect, it } from "vitest";
import type { ImportPreview, ImportStatus } from "../../shared/api";
import {
  confirmAction,
  countsText,
  doneText,
  foundLine,
  foundText,
  importAction,
  links,
  mayStartAnother,
  mayStop,
  newer,
  percent,
  previewLines,
  STEPS,
  stateText,
  stepOf,
  waitText,
} from "./import-logic";

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
    done: 12,
    waiting: 36,
    failed: 2,
    waitReason: null,
    removed: 0,
    maxRuns: 2,
    retry: null,
    ...over,
  };
}

describe("import confirm step", () => {
  it("lists the links to add and each skipped count", () => {
    expect(previewLines(preview)).toEqual([
      { label: "Links to add", count: 50, skipped: false },
      { label: "Repeats in the file", count: 3, skipped: true },
      { label: "Already saved", count: 0, skipped: true },
      { label: "Not links", count: 2, skipped: true },
    ]);
  });

  it("names the number of links on the confirm button", () => {
    expect(confirmAction(preview)).toEqual({
      label: "Import 50 links",
      disabledWhy: null,
    });
    expect(confirmAction({ ...preview, toAdd: 1 }).label).toBe("Import 1 link");
  });

  it("says why there is nothing to import", () => {
    expect(confirmAction({ ...preview, toAdd: 0 }).disabledWhy).toMatch(
      /Nothing is new/,
    );
    expect(
      confirmAction({
        ...preview,
        found: 0,
        toAdd: 0,
        repeatsInFile: 0,
        notLinks: 0,
      }).disabledWhy,
    ).toMatch(/found no links/);
  });

  it("writes large counts with separators", () => {
    expect(links(12345)).toBe("12,345 links");
  });
});

describe("import progress line", () => {
  it("shows done, waiting and failed of the total", () => {
    expect(countsText(status())).toBe("12 done, 36 waiting, 2 failed of 50");
    expect(percent(status())).toBe(28);
  });

  it("shows what was found and skipped", () => {
    expect(foundText(status())).toBe(
      "50 links added; skipped 3 repeats in the file, 2 not links.",
    );
    expect(foundText(status({ repeatsInFile: 0, notLinks: 0 }))).toBe(
      "50 links added.",
    );
  });

  it("offers Pause while running and Continue while paused", () => {
    expect(importAction(status())).toBe("pause");
    expect(importAction(status({ waitReason: "limit" }))).toBe("pause");
    expect(importAction(status({ state: "paused", pausedBy: "owner" }))).toBe(
      "continue",
    );
    expect(importAction(status({ state: "finished", waiting: 0 }))).toBeNull();
  });

  it("says why it waits at the usage limit and that it goes on by itself", () => {
    const text = stateText(status({ waitReason: "limit" }));
    expect(text).toMatch(/^Waiting: Claude is at its usage limit\./);
    expect(text).toMatch(/goes on by itself/);
    expect(waitText("off")).toMatch(/AI is off/);
    expect(waitText("threshold")).toMatch(/pause line/);
    expect(waitText("owner_pause")).toMatch(/paused in Settings/);
  });

  it("shows an import paused by Quit as paused, with its counts", () => {
    const s = status({ state: "paused", pausedBy: "closed" });
    expect(stateText(s)).toBe(
      "Paused when Mnemo closed. Press Continue to go on.",
    );
    expect(countsText(s)).toBe("12 done, 36 waiting, 2 failed of 50");
  });

  it("says a finished import without summaries kept the links as link only", () => {
    const s = status({
      state: "finished",
      withSummaries: false,
      done: 0,
      waiting: 0,
      failed: 0,
    });
    expect(stateText(s)).toMatch(/50 links added as link only/);
    expect(percent(s)).toBe(100);
  });

  it("says how many links got no summary when it is done", () => {
    expect(stateText(status({ state: "finished", waiting: 0 }))).toMatch(
      /2 links got no summary/,
    );
    expect(
      stateText(status({ state: "finished", waiting: 0, failed: 0 })),
    ).toBe("Done.");
  });

  it("allows another file only when no import is unfinished", () => {
    expect(mayStartAnother(null)).toBe(true);
    expect(mayStartAnother(status())).toBe(false);
    expect(
      mayStartAnother(status({ state: "paused", pausedBy: "owner" })),
    ).toBe(false);
    expect(mayStartAnother(status({ state: "finished" }))).toBe(true);
  });

  it("never puts an older count back on the screen", () => {
    const a = status({ done: 20, waiting: 28 });
    expect(newer(a, status({ done: 12, waiting: 36 }))).toBe(a);
    const b = status({ done: 21, waiting: 27 });
    expect(newer(a, b)).toBe(b);
    const other = status({ id: "imp-2", done: 0, waiting: 4 });
    expect(newer(a, other)).toBe(other);
  });
});

describe("import done step", () => {
  it("counts links saved with a summary, as link only, and skipped", () => {
    const s = status({ state: "finished", done: 47, waiting: 0, failed: 3 });
    expect(doneText(s)).toBe(
      "Import finished: 47 saved with a summary, 3 saved as link only, 3 skipped, already saved or repeats, 2 not links.",
    );
  });

  it("counts every link as link only for an import without summaries", () => {
    const s = status({
      state: "finished",
      withSummaries: false,
      done: 0,
      waiting: 0,
      failed: 0,
      alreadySaved: 4,
      repeatsInFile: 0,
      notLinks: 0,
    });
    expect(doneText(s)).toBe(
      "Import finished: 0 saved with a summary, 50 saved as link only, 4 skipped, already saved or repeats.",
    );
  });

  it("puts a running or paused import on the Import step and a finished one on Done", () => {
    expect(STEPS[stepOf(status())]).toBe("Import");
    expect(STEPS[stepOf(status({ state: "paused", pausedBy: "closed" }))]).toBe(
      "Import",
    );
    expect(STEPS[stepOf(status({ state: "finished" }))]).toBe("Done");
  });
});

describe("Check step", () => {
  it("starts with the count found in the file", () => {
    const p: ImportPreview = {
      fileName: "links.txt",
      found: 1,
      toAdd: 1,
      repeatsInFile: 0,
      alreadySaved: 0,
      notLinks: 0,
    };
    expect(foundLine(p)).toBe("1 entry found in links.txt");
    expect(foundLine({ ...p, found: 1200 })).toBe(
      "1,200 entries found in links.txt",
    );
  });
});

describe("Done counts and the running text", () => {
  it("counts links the owner deleted during the import apart, never as link only", () => {
    const s = status({
      state: "finished",
      done: 45,
      waiting: 0,
      failed: 2,
      removed: 3,
    });
    expect(doneText(s)).toBe(
      "Import finished: 45 saved with a summary, 2 saved as link only, 3 skipped, already saved or repeats, 2 not links, 3 deleted during the import.",
    );
  });

  it("says plainly why it waits after a fault and when it tries again", () => {
    const s = status({ retry: { reason: "unavailable" } });
    expect(stateText(s)).toBe(
      "Claude Code could not be started. Mnemo tries again by itself soon.",
    );
    expect(stateText(status({ retry: { reason: "storage" } }))).toMatch(
      /^Mnemo could not save the import just now\./,
    );
    expect(stateText(s)).not.toMatch(/Making summaries/);
  });

  it("names the core's number of runs at a time", () => {
    expect(stateText(status({ maxRuns: 3 }))).toBe(
      "Making summaries in the background, at most 3 at a time.",
    );
  });
});

describe("Stop here", () => {
  it("ends the import: Done step, no Pause or Continue, and another file may be imported", () => {
    const s = status({ state: "stopped", done: 12, waiting: 0, failed: 2 });
    expect(STEPS[stepOf(s)]).toBe("Done");
    expect(importAction(s)).toBeNull();
    expect(mayStop(s)).toBe(false);
    expect(mayStartAnother(s)).toBe(true);
    expect(stateText(s)).toMatch(/saved as link only/);
    expect(doneText(s)).toBe(
      "Import stopped: 12 saved with a summary, 38 saved as link only, 3 skipped, already saved or repeats, 2 not links.",
    );
  });

  it("is offered while the import runs or is paused", () => {
    expect(mayStop(status())).toBe(true);
    expect(mayStop(status({ state: "paused", pausedBy: "closed" }))).toBe(true);
    expect(mayStop(status({ state: "finished" }))).toBe(false);
  });
});
