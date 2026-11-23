// @vitest-environment node
// Acceptance tests for #14 AC5: the typed UI client exposes the five actions per type and the links,
// each calling the Tauri command of the same name. Uses a mocked Tauri bridge; screens never call invoke.
// Run: npx vitest run tests/acceptance/data-01-item-api.test.ts
import { resolve } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const API_PATH = resolve(__dirname, "..", "..", "ui/src/shared/api.ts");
const load = (): Promise<any> => import(/* @vite-ignore */ API_PATH);

const TYPES: [string, string, string][] = [
  ["Bookmark", "bookmark", "Bookmarks"],
  ["Note", "note", "Notes"],
  ["Idea", "idea", "Ideas"],
  ["Project", "project", "Projects"],
  ["Task", "task", "Tasks"],
  ["Event", "event", "Events"],
  ["Memory", "memory", "Memories"],
];

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ id: "x" });
});

test.each(TYPES)("AC5: %s has add, get, list, update and delete wrappers calling their commands", async (Cap, low, plural) => {
  const api = await load();
  const calls: [string, string, unknown[]][] = [
    [`add${Cap}`, `add_${low}`, [{}]],
    [`get${Cap}`, `get_${low}`, ["id-1"]],
    [`list${plural}`, `list_${plural.toLowerCase()}`, [{ limit: 10, after: null, includeDeleted: false }]],
    [`update${Cap}`, `update_${low}`, ["id-1", {}]],
    [`delete${Cap}`, `delete_${low}`, ["id-1"]],
  ];
  for (const [fn, cmd, args] of calls) {
    expect(typeof api[fn], `${fn} is not exported by ui/src/shared/api.ts`).toBe("function");
    invoke.mockClear();
    await api[fn](...args);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe(cmd);
  }
});

test("AC4: the client exposes add, list and remove for links", async () => {
  const api = await load();
  for (const [fn, cmd] of [["addLink", "add_link"], ["listLinks", "list_links"], ["removeLink", "remove_link"]]) {
    expect(typeof api[fn], `${fn} missing`).toBe("function");
    invoke.mockClear();
    await api[fn]({ kind: "note", id: "n" }, { kind: "task", id: "t" });
    expect(invoke.mock.calls[0][0]).toBe(cmd);
  }
});

test("AC5: a command error reaches the caller as the AppError it was", async () => {
  const api = await load();
  invoke.mockRejectedValueOnce({ code: "not_found", message: "No such bookmark." });
  await expect(api.getBookmark("missing")).rejects.toMatchObject({ code: "not_found" });
});

test("Run rows belong to the run queue: the client reads them and has no add, update or delete", async () => {
  const api = await load();
  for (const [fn, cmd, args] of [
    ["getRun", "get_run", ["id-1"]],
    ["listRuns", "list_runs", [{ limit: 10, after: null, includeDeleted: false }]],
  ] as [string, string, unknown[]][]) {
    invoke.mockClear();
    await api[fn](...args);
    expect(invoke.mock.calls[0][0]).toBe(cmd);
  }
  for (const fn of ["addRun", "updateRun", "deleteRun"]) {
    expect(api[fn], `${fn} must not be exported`).toBeUndefined();
  }
});
