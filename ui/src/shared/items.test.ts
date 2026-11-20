// @vitest-environment node
// The bookmark flow end to end on the UI side: each wrapper sends exactly the command
// and arguments the Rust commands take. The Rust test
// `bookmark_commands_add_get_list_update_delete_end_to_end` (src-tauri/src/commands.rs)
// runs the same five calls on a temporary database.
import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import {
  addBookmark,
  addLink,
  deleteBookmark,
  errorMessage,
  getBookmark,
  isAppError,
  listBookmarks,
  listLinks,
  removeLink,
  updateBookmark,
} from "./api";

const ID = "4f1c2b7e-0000-4000-8000-000000000001";
const AT = "2026-01-01T00:00:00Z";
// The exact inputs the Rust test bookmark_commands_add_get_list_update_delete_end_to_end reads.
const ADD_INPUT = {
  url: "https://example.com",
  title: null,
  summary: null,
  reason: null,
  reasonIsGuess: false,
};
const UPDATE_INPUT = {
  ...ADD_INPUT,
  url: "https://example.com/docs",
  title: "Docs",
};

const saved = {
  id: ID,
  createdAt: AT,
  updatedAt: AT,
  deletedAt: null,
  url: "https://example.com",
  title: null,
  summary: null,
  reason: null,
  reasonIsGuess: false,
};

beforeEach(() => {
  invoke.mockReset();
});

test("the bookmark flow sends add, get, list, update and delete with the command arguments", async () => {
  invoke.mockResolvedValueOnce(saved);
  const added = await addBookmark(ADD_INPUT);
  expect(added.id).toBe(ID);

  invoke.mockResolvedValueOnce(saved);
  await getBookmark(added.id);

  invoke.mockResolvedValueOnce({ items: [saved], next: null });
  const page = await listBookmarks({ limit: 10 });
  expect(page.items).toHaveLength(1);

  invoke.mockResolvedValueOnce({
    ...saved,
    title: "Docs",
    updatedAt: "2026-01-02T00:00:00Z",
  });
  await updateBookmark(added.id, UPDATE_INPUT);

  invoke.mockResolvedValueOnce(null);
  await deleteBookmark(added.id);

  expect(invoke.mock.calls).toEqual([
    ["add_bookmark", { input: ADD_INPUT }],
    ["get_bookmark", { id: ID }],
    [
      "list_bookmarks",
      { args: { limit: 10, after: null, includeDeleted: false } },
    ],
    ["update_bookmark", { id: ID, input: UPDATE_INPUT }],
    ["delete_bookmark", { id: ID }],
  ]);
});

test("a list call passes the cursor and includeDeleted through", async () => {
  invoke.mockResolvedValueOnce({ items: [], next: null });
  await listBookmarks({
    limit: 5,
    after: { createdAt: AT, id: ID },
    includeDeleted: true,
  });
  expect(invoke).toHaveBeenCalledWith("list_bookmarks", {
    args: { limit: 5, after: { createdAt: AT, id: ID }, includeDeleted: true },
  });
});

test("link calls send both ends, the item and page, and the link id", async () => {
  const note = { kind: "note", id: "n1" } as const;
  const task = { kind: "task", id: "t1" } as const;
  invoke.mockResolvedValue(null);
  await addLink(note, task);
  await listLinks(note, { limit: 20 });
  await removeLink("l1");
  expect(invoke.mock.calls).toEqual([
    ["add_link", { a: note, b: task }],
    ["list_links", { item: note, page: { limit: 20, after: null } }],
    ["remove_link", { id: "l1" }],
  ]);
});

test("a not_found or invalid_input error reaches the caller as an AppError", async () => {
  invoke.mockRejectedValueOnce({
    code: "not_found",
    message: "There is no such bookmark. It may have been deleted.",
  });
  const err = await getBookmark("missing").catch((e: unknown) => e);
  expect(isAppError(err)).toBe(true);
  expect(errorMessage(err)).toBe(
    "There is no such bookmark. It may have been deleted.",
  );

  invoke.mockRejectedValueOnce({
    code: "invalid_input",
    message: "The link must be a web address.",
  });
  await expect(
    addBookmark({ ...ADD_INPUT, url: "nope" }),
  ).rejects.toMatchObject({
    code: "invalid_input",
  });
});

test("arguments Tauri could not read reject with a plain string and get the fallback message", async () => {
  invoke.mockRejectedValueOnce("invalid args `input` for command `add_note`");
  const err = await addBookmark({ ...ADD_INPUT, url: "x" }).catch(
    (e: unknown) => e,
  );
  expect(isAppError(err)).toBe(false);
  expect(errorMessage(err)).toBe("Something went wrong. Try again.");
});
