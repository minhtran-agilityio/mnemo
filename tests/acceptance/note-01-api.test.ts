// @vitest-environment node
// Acceptance tests for #33 AC6: the typed UI client wraps the label and labelled-note commands.
// Run: npx vitest run --root . tests/acceptance/note-01-api.test.ts
// (also run by tests/acceptance/note-01-notes.test.mjs, so npm test covers it). Uses a mocked Tauri invoke.
//
// AC6: "Thin Tauri commands for the label functions and label-aware note save/list are registered in lib.rs and
// wrapped in typed functions in ui/src/shared/api.ts with the { code, message } error shape; screens never call
// invoke directly."
import { resolve } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const API_PATH = resolve(__dirname, "..", "..", "ui/src/shared/api.ts");
const load = (): Promise<any> => import(/* @vite-ignore */ API_PATH);

const AT = "2026-01-01T00:00:00Z";
const LABEL = { id: "lab-1", createdAt: AT, updatedAt: AT, deletedAt: null, name: "Work", parentId: null };
const NOTE = { note: { id: "note-1", createdAt: AT, updatedAt: AT, deletedAt: null, body: "text" }, labelIds: ["lab-1"] };

beforeEach(() => {
  invoke.mockReset();
});

const WRAPPERS: [string, string, unknown[], unknown][] = [
  ["createLabel", "create_label", [null, "Work"], LABEL],
  ["renameLabel", "rename_label", ["lab-1", "Home"], LABEL],
  ["moveLabel", "move_label", ["lab-1", null], LABEL],
  ["deleteLabel", "delete_label", ["lab-1"], { movedNotes: 0, movedLabels: 0, parentId: null }],
  ["listLabels", "list_labels", [], [LABEL]],
  ["saveLabelledNote", "save_labelled_note", ["note-1", "text", ["lab-1"]], NOTE],
  ["listLabelledNotes", "list_labelled_notes", [null, { limit: 20 }], { items: [NOTE], next: null }],
];

test.each(WRAPPERS)("AC6: %s calls the %s command once and returns its result", async (fn, cmd, args, result) => {
  const api = await load();
  expect(typeof api[fn], `${fn} is not exported by ui/src/shared/api.ts`).toBe("function");
  invoke.mockResolvedValueOnce(result);
  const out = await api[fn](...args);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][0]).toBe(cmd);
  expect(out).toEqual(result);
});

test("AC6: saveLabelledNote sends the note id, the body and the label ids", async () => {
  const api = await load();
  invoke.mockResolvedValueOnce(NOTE);
  await api.saveLabelledNote("note-1", "the body text", ["lab-1", "lab-2"]);
  const sent = JSON.stringify(invoke.mock.calls[0][1]);
  for (const part of ["note-1", "the body text", "lab-1", "lab-2"]) expect(sent).toContain(part);
});

test("AC6: listLabelledNotes sends the label id it is asked for", async () => {
  const api = await load();
  invoke.mockResolvedValueOnce({ items: [], next: null });
  await api.listLabelledNotes("lab-7", { limit: 20 });
  expect(JSON.stringify(invoke.mock.calls[0][1])).toContain("lab-7");
});

test("AC6: a refused save reaches the caller as the { code, message } error the core sent", async () => {
  const api = await load();
  const err = { code: "validation", message: "A note needs at least one label." };
  invoke.mockRejectedValueOnce(err);
  const caught = await api.saveLabelledNote(null, "text", []).catch((e: unknown) => e);
  expect(caught).toMatchObject(err);
  expect(api.isAppError(caught)).toBe(true);
  expect(api.errorMessage(caught)).toBe("A note needs at least one label.");
});

test("AC6: a refused label move reaches the caller with its message", async () => {
  const api = await load();
  const err = { code: "validation", message: "A label cannot move under itself or one of its own labels." };
  invoke.mockRejectedValueOnce(err);
  await expect(api.moveLabel("lab-1", "lab-1")).rejects.toMatchObject(err);
});
