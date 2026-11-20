// The one typed client for the Tauri commands. Screens call these functions and never
// call invoke themselves.
import { invoke } from "@tauri-apps/api/core";

/** The error shape every command rejects with: a stable code and a plain message. */
export interface AppError {
  code: string;
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppError).code === "string" &&
    typeof (value as AppError).message === "string"
  );
}

/** A plain sentence for any failure, using the core's message when it sent one. */
export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  return "Something went wrong. Try again.";
}

/** Proves the Rust core is reachable. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}

/** The value saved under `key`, or null when it was never saved. */
export async function getSetting(key: string): Promise<string | null> {
  const value = await invoke<string | null | undefined>("get_setting", { key });
  return value ?? null;
}

/** Saves `value` under `key`, replacing an earlier value. */
export async function setSetting(key: string, value: string): Promise<void> {
  await invoke<void>("set_setting", { key, value });
}

/** The four results of the Claude Code check. */
export type AiState =
  | "ready"
  | "not_installed"
  | "not_signed_in"
  | "version_problem";

/** The check result: a state and a fixed plain message. It never holds output from Claude Code. */
export interface AiHealth {
  state: AiState;
  message: string;
}

/** The latest Claude Code check, or null while the first one is still running. */
export async function getAiHealth(): Promise<AiHealth | null> {
  const value = await invoke<AiHealth | null | undefined>("get_ai_health");
  return value ?? null;
}

/** Checks Claude Code again and returns the new result. */
export function checkAiHealth(): Promise<AiHealth> {
  return invoke<AiHealth>("check_ai_health");
}

// ---- Items and links (#14) ----
// Types mirror the Rust records (camelCase). Times are UTC ISO 8601 set by the core;
// null means unknown. Every list is paged: at most 100 records, newest first.

/** The eight item types. */
export type ItemKind =
  | "bookmark"
  | "note"
  | "idea"
  | "project"
  | "task"
  | "event"
  | "run"
  | "memory";

/** The fields every item has. `deletedAt` is set once the item is deleted. */
export interface RecordBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Where a page starts: the last record of the page before. */
export interface Cursor {
  createdAt: string;
  id: string;
}

/** One page of records. `next` is set when more records follow. */
export interface Page<T> {
  items: T[];
  next: Cursor | null;
}

/** The arguments of every list call. `limit` is 1 to 100; `after` null for the first page. */
export interface ListArgs {
  limit: number;
  after?: Cursor | null;
  includeDeleted?: boolean;
}

export interface BookmarkInput {
  url: string;
  title: string | null;
  /** Null when the page could not be read. */
  summary: string | null;
  reason: string | null;
  /** True when the app wrote the reason: show it as a guess. */
  reasonIsGuess: boolean;
}
export interface Bookmark extends RecordBase {
  url: string;
  title: string | null;
  summary: string | null;
  reason: string | null;
  reasonIsGuess: boolean;
}

export interface NoteInput {
  /** Markdown. */
  body: string;
}
export interface Note extends RecordBase {
  body: string;
}

export type IdeaStage = "spark" | "shape" | "ready" | "project";
export interface IdeaInput {
  title: string;
  stage: IdeaStage;
}
export interface Idea extends RecordBase {
  title: string;
  stage: IdeaStage;
}

export interface ProjectInput {
  title: string;
  /** Free text, 1 to 40 characters, until PROJ-01 names the values. */
  status: string;
}
export interface Project extends RecordBase {
  title: string;
  status: string;
}

export interface TaskInput {
  title: string;
  /** Marking a done task done again keeps the first `doneAt`. */
  done: boolean;
}
export interface Task extends RecordBase {
  title: string;
  doneAt: string | null;
}

// Named CalendarEvent so it never hides the DOM's Event type in a screen.
export interface CalendarEventInput {
  title: string;
  /** UTC, exactly like 2026-01-31T09:00:00Z. */
  startsAt: string;
  endsAt: string;
}
export interface CalendarEvent extends RecordBase {
  title: string;
  startsAt: string;
  endsAt: string;
}

export type RunOutcome = "ok" | "failed" | "cancelled";
export interface RunInput {
  taskType: string;
  startedAt: string;
  durationMs: number | null;
  /** Null while the run is going. */
  outcome: RunOutcome | null;
  error: string | null;
}
export interface Run extends RecordBase {
  taskType: string;
  startedAt: string;
  durationMs: number | null;
  outcome: RunOutcome | null;
  error: string | null;
}

export interface MemoryInput {
  body: string;
}
export interface Memory extends RecordBase {
  body: string;
}

/** One item, named by its type and id. */
export interface ItemRef {
  kind: ItemKind;
  id: string;
}

/** A link seen from one item: `other` is the item at the far end. */
export interface Link {
  id: string;
  other: ItemRef;
  createdAt: string;
}

function listArgs(args: ListArgs): Required<ListArgs> {
  return {
    limit: args.limit,
    after: args.after ?? null,
    includeDeleted: args.includeDeleted ?? false,
  };
}

/** The five calls of one item type, each calling the command of the same name. */
function itemClient<T, I>(kind: string, plural: string) {
  return {
    add: (input: I) => invoke<T>(`add_${kind}`, { input }),
    get: (id: string) => invoke<T>(`get_${kind}`, { id }),
    list: (args: ListArgs) =>
      invoke<Page<T>>(`list_${plural}`, { args: listArgs(args) }),
    /** Replaces every field, so every field is required (send null to clear one). */
    update: (id: string, input: I) =>
      invoke<T>(`update_${kind}`, { id, input }),
    remove: (id: string) => invoke<void>(`delete_${kind}`, { id }),
  };
}

const bookmarks = itemClient<Bookmark, BookmarkInput>("bookmark", "bookmarks");
export const addBookmark = bookmarks.add;
export const getBookmark = bookmarks.get;
export const listBookmarks = bookmarks.list;
export const updateBookmark = bookmarks.update;
export const deleteBookmark = bookmarks.remove;

const notes = itemClient<Note, NoteInput>("note", "notes");
export const addNote = notes.add;
export const getNote = notes.get;
export const listNotes = notes.list;
export const updateNote = notes.update;
export const deleteNote = notes.remove;

const ideas = itemClient<Idea, IdeaInput>("idea", "ideas");
export const addIdea = ideas.add;
export const getIdea = ideas.get;
export const listIdeas = ideas.list;
export const updateIdea = ideas.update;
export const deleteIdea = ideas.remove;

const projects = itemClient<Project, ProjectInput>("project", "projects");
export const addProject = projects.add;
export const getProject = projects.get;
export const listProjects = projects.list;
export const updateProject = projects.update;
export const deleteProject = projects.remove;

const tasks = itemClient<Task, TaskInput>("task", "tasks");
export const addTask = tasks.add;
export const getTask = tasks.get;
export const listTasks = tasks.list;
export const updateTask = tasks.update;
export const deleteTask = tasks.remove;

const events = itemClient<CalendarEvent, CalendarEventInput>("event", "events");
export const addEvent = events.add;
export const getEvent = events.get;
export const listEvents = events.list;
export const updateEvent = events.update;
export const deleteEvent = events.remove;

const runs = itemClient<Run, RunInput>("run", "runs");
export const addRun = runs.add;
export const getRun = runs.get;
export const listRuns = runs.list;
export const updateRun = runs.update;
export const deleteRun = runs.remove;

const memories = itemClient<Memory, MemoryInput>("memory", "memories");
export const addMemory = memories.add;
export const getMemory = memories.get;
export const listMemories = memories.list;
export const updateMemory = memories.update;
export const deleteMemory = memories.remove;

/** Links two live items of any type. Linking a linked pair again returns that link. */
export function addLink(a: ItemRef, b: ItemRef): Promise<Link> {
  return invoke<Link>("add_link", { a, b });
}

/** One page of the live links of `item`, each naming the item at the other end. */
export function listLinks(
  item: ItemRef,
  page: { limit: number; after?: Cursor | null } = { limit: 100 },
): Promise<Page<Link>> {
  return invoke<Page<Link>>("list_links", {
    item,
    page: { limit: page.limit, after: page.after ?? null },
  });
}

/** Removes a link. */
export function removeLink(id: string): Promise<void> {
  return invoke<void>("remove_link", { id });
}

// ---- Labels and labelled notes (#33) ----
// A label nests under one parent label (null for a top label). A note is saved with at
// least one label; the core refuses a save with none.

export interface Label extends RecordBase {
  name: string;
  /** Null for a top label. */
  parentId: string | null;
}

/** A note with the ids of its live labels. */
export interface LabelledNote {
  note: Note;
  labelIds: string[];
}

/** Where a page of notes starts: the last note of the page before. */
export interface ChangeCursor {
  updatedAt: string;
  id: string;
}

/** One page of notes, newest change first. `next` is set when more notes follow. */
export interface LabelledNotePage {
  items: LabelledNote[];
  next: ChangeCursor | null;
}

/** What a label delete changed: notes that got the parent label, child labels moved up. */
export interface DeleteLabelOutcome {
  movedNotes: number;
  movedLabels: number;
  /** Where the notes and child labels went; null for a top label. */
  parentId: string | null;
}

/** Creates a label under `parentId` (null: a top label). */
export function createLabel(
  parentId: string | null,
  name: string,
): Promise<Label> {
  return invoke<Label>("create_label", { parentId, name });
}

/** Renames a label. */
export function renameLabel(id: string, name: string): Promise<Label> {
  return invoke<Label>("rename_label", { id, name });
}

/** Moves a label under `parentId` (null: to the top). */
export function moveLabel(id: string, parentId: string | null): Promise<Label> {
  return invoke<Label>("move_label", { id, parentId });
}

/** Deletes a label. Its notes get the parent label and its child labels move up. */
export function deleteLabel(id: string): Promise<DeleteLabelOutcome> {
  return invoke<DeleteLabelOutcome>("delete_label", { id });
}

/** How many notes deleting a label would move to its parent label (0 for a top label). */
export function countLabelDeleteMoves(id: string): Promise<number> {
  return invoke<number>("count_label_delete_moves", { id });
}

/** Every live label, flat with its parent id, ordered by name. */
export function listLabels(): Promise<Label[]> {
  return invoke<Label[]>("list_labels");
}

/** Adds a note (`id` null) or replaces a note's text, and sets its labels. */
export function saveLabelledNote(
  id: string | null,
  body: string,
  labelIds: string[],
): Promise<LabelledNote> {
  return invoke<LabelledNote>("save_labelled_note", { id, body, labelIds });
}

/** One page of notes, newest change first: of `labelId` and its child labels, or all (null). */
export function listLabelledNotes(
  labelId: string | null,
  page: { limit: number; after?: ChangeCursor | null } = { limit: 100 },
): Promise<LabelledNotePage> {
  return invoke<LabelledNotePage>("list_labelled_notes", {
    labelId,
    page: { limit: page.limit, after: page.after ?? null },
  });
}

// ---- Images and attached files (#16) ----
// Files live in one folder beside the database. The UI never sees a path: it sends
// bytes and gets a file id, and reads a file by that id only.

/** What the core knows about a saved file. The disk name is never sent. */
export interface FileRecord {
  id: string;
  originalName: string;
  sizeBytes: number;
  mime: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A file in the files folder that no row owns. */
export interface OrphanFile {
  name: string;
  sizeBytes: number;
}

/** The clean-up report. It only lists; nothing is deleted. */
export interface OrphanReport {
  files: OrphanFile[];
  truncated: boolean;
}

/** Saves a file. The core checks the size limit and rejects with `file_too_large`. */
export async function addFile(file: File): Promise<FileRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<FileRecord>("add_file", bytes, {
    headers: { "x-mnemo-file-name": encodeURIComponent(file.name) },
  });
}

/** The details of a saved file. */
export function getFile(id: string): Promise<FileRecord> {
  return invoke<FileRecord>("get_file", { id });
}

/** A saved file as a Blob with its stored type, ready for `URL.createObjectURL`. */
export async function readFileBlob(id: string): Promise<Blob> {
  const record = await getFile(id);
  const bytes = await invoke<ArrayBuffer>("read_file", { id });
  return new Blob([bytes], record.mime ? { type: record.mime } : undefined);
}

/** Removes a file from view. The file stays on disk until the owner removes it. */
export async function deleteFile(id: string): Promise<void> {
  await invoke<void>("delete_file", { id });
}

/** Lists files in the folder that no row owns. It deletes nothing. */
export function fileOrphanReport(): Promise<OrphanReport> {
  return invoke<OrphanReport>("file_orphan_report");
}
