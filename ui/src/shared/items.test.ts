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
  addFile,
  addLink,
  deleteBookmark,
  deleteFile,
  errorMessage,
  fileOrphanReport,
  getBookmark,
  getFile,
  isAppError,
  listBookmarks,
  listLinks,
  readFileBlob,
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

// ---- Images and attached files (#16) ----
// The Rust test `file_commands_save_read_delete_end_to_end` (src-tauri/src/commands.rs)
// runs the same calls against the core.
const FILE_ID = "9c1b7e2a-0000-4000-8000-0000000000f1";
const FILE_RECORD = {
  id: FILE_ID,
  originalName: "caf\u00e9 photo.png",
  sizeBytes: 3,
  mime: "image/png",
  createdAt: AT,
  updatedAt: AT,
};

test("addFile sends the raw bytes with the percent-encoded file name header", async () => {
  invoke.mockResolvedValueOnce(FILE_RECORD);
  const file = new File([new Uint8Array([1, 2, 3])], "caf\u00e9 photo.png");
  expect(await addFile(file)).toEqual(FILE_RECORD);
  expect(invoke).toHaveBeenCalledTimes(1);
  const [command, body, options] = invoke.mock.calls[0];
  expect(command).toBe("add_file");
  expect(body).toBeInstanceOf(Uint8Array);
  expect(Array.from(body as Uint8Array)).toEqual([1, 2, 3]);
  expect(options).toEqual({
    headers: { "x-mnemo-file-name": "caf%C3%A9%20photo.png" },
  });
});

test("getFile, deleteFile and fileOrphanReport send the exact file commands", async () => {
  invoke.mockResolvedValueOnce(FILE_RECORD);
  invoke.mockResolvedValueOnce(undefined);
  invoke.mockResolvedValueOnce({ files: [], truncated: false });
  await getFile(FILE_ID);
  await deleteFile(FILE_ID);
  expect(await fileOrphanReport()).toEqual({ files: [], truncated: false });
  expect(invoke.mock.calls).toEqual([
    ["get_file", { id: FILE_ID }],
    ["delete_file", { id: FILE_ID }],
    ["file_orphan_report"],
  ]);
});

test("readFileBlob reads the file details and the raw bytes, and keeps the stored type", async () => {
  invoke.mockResolvedValueOnce(FILE_RECORD);
  invoke.mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
  const blob = await readFileBlob(FILE_ID);
  expect(invoke.mock.calls).toEqual([
    ["get_file", { id: FILE_ID }],
    ["read_file", { id: FILE_ID }],
  ]);
  expect(blob.type).toBe("image/png");
  expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
    1, 2, 3,
  ]);
});

test("a file_too_large rejection reaches the caller as an AppError with the limit in the message", async () => {
  invoke.mockRejectedValueOnce({
    code: "file_too_large",
    message:
      "This file is larger than the limit of 20 MB. Choose a smaller file.",
  });
  const err = await addFile(new File([new Uint8Array([1])], "big.bin")).catch(
    (e: unknown) => e,
  );
  expect(isAppError(err)).toBe(true);
  expect(err).toMatchObject({ code: "file_too_large" });
  expect(errorMessage(err)).toContain("20 MB");
});
