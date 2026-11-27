// The one typed client for the Tauri commands. Screens call these functions and never
// call invoke themselves.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

/** Whether AI answers are real (`claude -p`) or fake test data (`MNEMO_FAKE_AI=1`). */
export type AiMode = "real" | "fake";

/** Reads which AI runner the app started with. */
export function getAiMode(): Promise<AiMode> {
  return invoke<AiMode>("get_ai_mode");
}

/** Checks Claude Code again and returns the new result. */
export function checkAiHealth(): Promise<AiHealth> {
  return invoke<AiHealth>("check_ai_health");
}

/** The answer of the test prompt and how long it took. */
export interface TestPromptResult {
  answer: string;
  durationMs: number;
}

/**
 * Sends one tiny fixed prompt through the AI runner (Settings > AI developer test). A real run
 * uses Claude usage; with MNEMO_FAKE_AI=1 it uses the fake. Rejects with an AppError whose code
 * is the kind of failure (for example "usage_limit").
 */
export function runTestPrompt(): Promise<TestPromptResult> {
  return invoke<TestPromptResult>("run_test_prompt");
}

// ---- AI control (#23) ----
// The master switch, the warn and pause lines, the pause and the usage. Every command returns
// the new view, read from the core.

/** Why the AI control refuses a task. */
export type AiDenyReason = "off" | "limit" | "threshold" | "owner_pause";

/** What the gate answers a background task now. */
export type AiGate = { kind: "allow" } | { kind: "deny"; reason: AiDenyReason };

/** A pause in force. `until` is a verified reset time (Unix seconds), or null: Resume only. */
export interface AiPause {
  reason: "limit" | "owner";
  until: number | null;
}

/** One usage window. `percent` is null when the window has reset; it is Unverified. */
export interface AiUsageWindow {
  percent: number | null;
  resetsAt: number | null;
  status: string | null;
}

/** The last usage reading, or, when there is none, Mnemo's own run count. */
export type AiUsage =
  | {
      kind: "reading";
      readAt: number;
      fiveHour: AiUsageWindow | null;
      sevenDay: AiUsageWindow | null;
    }
  | { kind: "runs"; today: number; week: number };

/** What Settings > AI shows. */
export interface AiControlView {
  enabled: boolean;
  warnAt: number;
  pauseAt: number;
  pause: AiPause | null;
  backgroundGate: AiGate;
  warn: boolean;
  usage: AiUsage;
}

/** Local midnight today and local Monday 00:00, as Unix seconds, for the run count. */
export interface DayBounds {
  todayStart: number;
  weekStart: number;
}

/** Reads the AI control. */
export function getAiControl(bounds: DayBounds): Promise<AiControlView> {
  return invoke<AiControlView>("get_ai_control", { ...bounds });
}

/** Turns AI on or off. Off: nothing new starts, waiting runs are cancelled. */
export function setAiEnabled(
  on: boolean,
  bounds: DayBounds,
): Promise<AiControlView> {
  return invoke<AiControlView>("set_ai_enabled", { on, ...bounds });
}

/** Sets the warn and pause lines. Rejects with code "invalid_input" and a plain message. */
export function setAiThresholds(
  warn: number,
  pause: number,
  bounds: DayBounds,
): Promise<AiControlView> {
  return invoke<AiControlView>("set_ai_thresholds", { warn, pause, ...bounds });
}

/** Pauses background AI work. Your own tasks still run. */
export function pauseBackground(bounds: DayBounds): Promise<AiControlView> {
  return invoke<AiControlView>("pause_background", { ...bounds });
}

/** Lifts any pause at once, the usage limit pause included. */
export function resumeAi(bounds: DayBounds): Promise<AiControlView> {
  return invoke<AiControlView>("resume_ai", { ...bounds });
}

/** The event the core sends after every change of the AI control. */
export const AI_CONTROL_EVENT = "ai-control";

/** Calls `handler` after every change of the AI control. Resolves to the unsubscribe call. */
export function onAiControl(handler: () => void): Promise<() => void> {
  return listen(AI_CONTROL_EVENT, () => handler());
}

// The model and effort of each AI feature (the Rust core owns the list, the defaults and the
// allowed values).
export type AiModel = "haiku" | "sonnet" | "opus";
export type AiEffort = "low" | "medium" | "high";

export interface AiModelRow {
  feature: string;
  label: string;
  model: AiModel;
  effort: AiEffort;
}

export interface AiChoice<T extends string> {
  value: T;
  label: string;
}

export interface AiModelTable {
  rows: AiModelRow[];
  models: AiChoice<AiModel>[];
  efforts: AiChoice<AiEffort>[];
}

/** Every feature's model and effort, with the allowed values. */
export function listAiModels(): Promise<AiModelTable> {
  return invoke<AiModelTable>("list_ai_models");
}

/** Saves one feature's choice. An unknown value rejects with `invalid_ai_model` and changes nothing. */
export function setAiModel(
  feature: string,
  model: AiModel,
  effort: AiEffort,
): Promise<AiModelTable> {
  return invoke<AiModelTable>("set_ai_model", { feature, model, effort });
}

/** Puts every feature back to its default model and effort. */
export function resetAiModels(): Promise<AiModelTable> {
  return invoke<AiModelTable>("reset_ai_models");
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

/** The stage of an idea. The core sets it from the four checks (#34); the UI never sends it. */
export type IdeaStage = "spark" | "shape" | "ready" | "project";
/** Where an idea comes from: a saved bookmark or note, or a web link. */
export type IdeaSource =
  | { type: "item"; item: { kind: "bookmark" | "note"; id: string } }
  | { type: "link"; url: string };
/** The four plain checks. Advice only: they never block a save. */
export interface IdeaChecks {
  hasTag: boolean;
  hasSource: boolean;
  hasWhy: boolean;
  hasOutline: boolean;
}
export interface IdeaInput {
  title: string;
  text: string | null;
  source: IdeaSource | null;
  why: string | null;
  /** Plain text, one point per line. */
  outline: string | null;
  /** Update replaces the tags too: a tag left out is removed. */
  tags: string[];
}
export interface Idea extends RecordBase {
  title: string;
  text: string | null;
  source: IdeaSource | null;
  why: string | null;
  outline: string | null;
  tags: string[];
  stage: IdeaStage;
  checks: IdeaChecks;
  /** The project this idea was turned into, if it is still there. */
  projectId: string | null;
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
/** Where an AI run is: in the queue, running, or one of the three end states. */
export type RunState = "waiting" | "running" | "done" | "failed" | "cancelled";
export interface RunInput {
  taskType: string;
  state: RunState;
  /** Null while the run waits, and for a run cancelled before it started. */
  startedAt: string | null;
  /** Set only in an end state (done, failed, cancelled). */
  endedAt: string | null;
  durationMs: number | null;
  /** Null while the run waits or runs; otherwise it matches the state (done is ok). */
  outcome: RunOutcome | null;
  error: string | null;
}
export interface Run extends RecordBase {
  taskType: string;
  state: RunState;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  outcome: RunOutcome | null;
  error: string | null;
}
/** The payload of the `run-state` event the core sends on every run state change. It holds no
 * prompt, path or error output. */
export interface RunStateEvent {
  id: string;
  taskType: string;
  state: RunState;
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

/** "Turn into project", at any stage: the idea at the stage Project and the new project. */
export function turnIdeaIntoProject(
  id: string,
): Promise<{ idea: Idea; project: Project }> {
  return invoke<{ idea: Idea; project: Project }>("turn_idea_into_project", {
    id,
  });
}

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

// Run rows belong to the run queue: the UI reads them and cancels through `cancel_run`.
const runs = itemClient<Run, RunInput>("run", "runs");
export const getRun = runs.get;
export const listRuns = runs.list;

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

// ---- Data: export, backup and reset ----

/** How many live records of each type an export wrote. */
export interface ExportCounts {
  notes: number;
  bookmarks: number;
  ideas: number;
  projects: number;
  tasks: number;
  events: number;
  runs: number;
  memories: number;
  labels: number;
  links: number;
  files: number;
}

export interface ExportSummary {
  /** The new `mnemo-export-<time>` folder. */
  folder: string;
  counts: ExportCounts;
  /** Live file records whose file was gone from the files folder. */
  filesMissing: number;
}

export interface DataFolderInfo {
  path: string;
  macosCommand: string;
  ubuntuCommand: string;
}

/** The word the owner types to confirm a reset. */
export const RESET_WORD = "RESET";

/** Asks for a folder in the native folder dialog. Null when the owner cancels. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

/** Exports all live data into a new folder inside `folder`. */
export async function exportData(folder: string): Promise<ExportSummary> {
  const result: unknown = await invoke<ExportSummary>("export_data", {
    folder,
  });
  // A bare string is the new folder alone, with no counts to show.
  if (typeof result === "string")
    return { folder: result, counts: {} as ExportCounts, filesMissing: 0 };
  return result as ExportSummary;
}

/** Deletes all data and files. The core refuses any word but `RESET`. */
export async function resetData(confirm: string): Promise<void> {
  await invoke<void>("reset_data", { confirm });
}

export async function dataFolderInfo(): Promise<DataFolderInfo> {
  const result: unknown = await invoke<DataFolderInfo>("data_folder_info");
  // A bare string is the path alone: the copy commands are made from it, as the core makes them.
  if (typeof result === "string") {
    const from = `"${result.replace(/[\\"$`]/g, "\\$&")}"`;
    const to = "~/mnemo-backup-$(date +%Y-%m-%d-%H%M%S)";
    return {
      path: result,
      macosCommand: `cp -Rp ${from} ${to}`,
      ubuntuCommand: `cp -a ${from} ${to}`,
    };
  }
  return result as DataFolderInfo;
}

/** Opens the data folder in the system file manager. */
export async function openDataFolder(): Promise<void> {
  await invoke<void>("open_data_folder");
}

// ---- Save a link (#25, BM-01) ----

/** Where the summary of a saved link stands. */
export type SummaryStatus =
  | "pending"
  | "reading"
  | "unreadable"
  | "ai_off"
  | "not_reached"
  | "done";

/** One tag of a saved link: its label id and name. Tags are written by AI. */
export interface BookmarkTag {
  id: string;
  name: string;
}

/** A saved link as its card shows it: the bookmark plus its site, summary status and tags. */
export interface SavedBookmark extends Bookmark {
  /** The host of the link, for example "example.org". Null when unknown. */
  site: string | null;
  summaryStatus: SummaryStatus;
  tags: string[];
  labels: BookmarkTag[];
  /** The folder the link is in (#26): its id and name. Unsorted when no other folder fits. */
  folderId: string;
  folder: string;
  /** Why the app chose the folder. Null when the app did not choose it. */
  folderReason: string | null;
  /** True when the app chose the folder: it is shown as a guess. */
  folderIsGuess: boolean;
}

/** A folder of saved links and how many live links it holds. Unsorted is the default folder. */
export interface Folder {
  id: string;
  name: string;
  /** True for Unsorted: it cannot be renamed or deleted. */
  isDefault: boolean;
  count: number;
}

/**
 * A save or summary result: the bookmark, and why there is no summary when an AI run failed.
 * `alreadySaved` is true when `saveLink` found the link already saved (#28): the bookmark is the
 * old one, unchanged, and no page read or AI run started.
 */
export interface SaveResult extends SavedBookmark {
  aiError?: AppError;
  alreadySaved: boolean;
}

/** Saves a link: the core stores it at once, then reads the page and asks for a summary. */
export function saveLink(url: string): Promise<SaveResult> {
  return invoke<SaveResult>("save_link", { url });
}

/**
 * Makes the summary of a saved link again: from `pastedText` ("Paste the text"), or, without
 * it, by reading the page again ("Summarize later").
 */
export function summarizeBookmark(
  id: string,
  pastedText?: string,
): Promise<SaveResult> {
  return invoke<SaveResult>(
    "summarize_bookmark",
    pastedText === undefined ? { id } : { id, pastedText },
  );
}

/** One page of saved links with their site, status and tags, newest first. */
export function listBookmarkCards(args: {
  limit: number;
  after?: Cursor | null;
}): Promise<Page<SavedBookmark>> {
  return invoke<Page<SavedBookmark>>("list_bookmark_cards", {
    page: { limit: args.limit, after: args.after ?? null },
  });
}

/** The folders with their link counts, by name, Unsorted last. */
export function listFolders(): Promise<Folder[]> {
  return invoke<Folder[]>("list_folders");
}

/** Creates a folder. Only the owner does this: a save never makes a folder. */
export function createFolder(name: string): Promise<Folder> {
  return invoke<Folder>("create_folder", { name });
}

/** Renames a folder. The core refuses Unsorted. */
export function renameFolder(id: string, name: string): Promise<Folder> {
  return invoke<Folder>("rename_folder", { id, name });
}

/** Deletes a folder; its links move to Unsorted. Gives how many live links moved. */
export function deleteFolder(id: string): Promise<number> {
  return invoke<number>("delete_folder", { id });
}

/** Moves a link to a folder. The core keeps the move as the one step of Undo. */
export function moveBookmark(
  id: string,
  folderId: string,
): Promise<SavedBookmark> {
  return invoke<SavedBookmark>("move_bookmark", { id, folderId });
}

/** Deletes a link (the core keeps it, marked deleted). The delete is the one step of Undo. */
export function deleteSavedBookmark(id: string): Promise<void> {
  return invoke<void>("delete_saved_bookmark", { id });
}

/** Takes back the last move or delete (one step, kept in memory until the app closes). */
export function undoLast(): Promise<SavedBookmark> {
  return invoke<SavedBookmark>("undo_last");
}

/**
 * Opens the stored link of a saved bookmark in the system browser (#27). The core reads the link
 * from the bookmark and opens it only when it is an http or https address; the UI sends an id and
 * has no opener permission.
 */
export function openLink(id: string): Promise<void> {
  return invoke<void>("open_link", { id });
}

/** The event the core sends with the bookmark after each step of a save or a summary. */
export const BOOKMARK_EVENT = "bookmark-changed";

/** Calls `handler` with the bookmark after each step. Resolves to the unsubscribe call. */
export function onBookmarkChanged(
  handler: (bookmark: SavedBookmark) => void,
): Promise<() => void> {
  return listen<SavedBookmark>(BOOKMARK_EVENT, (event) =>
    handler(event.payload),
  );
}

// ---- Import old links from a file (#29) ----

/** What an import of the picked file would do. Nothing is stored yet. */
export interface ImportPreview {
  /** The base name of the file, never its path. */
  fileName: string;
  /** Every entry read: links, repeats and entries that are not links. */
  found: number;
  /** Links that would be added. */
  toAdd: number;
  repeatsInFile: number;
  alreadySaved: number;
  notLinks: number;
}

/** Where an import stands. */
export type ImportState = "running" | "paused" | "finished" | "stopped";
/** Why an import is paused: the owner pressed Pause, or Mnemo closed during it. */
export type ImportPausedBy = "owner" | "closed";
/** Why AI work may not start now (the AI control's reasons). */
export type AiWaitReason = "off" | "limit" | "threshold" | "owner_pause";

/** One import with its counts, as the Import screen shows it. */
export interface ImportStatus {
  id: string;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  state: ImportState;
  pausedBy: ImportPausedBy | null;
  withSummaries: boolean;
  found: number;
  added: number;
  repeatsInFile: number;
  alreadySaved: number;
  notLinks: number;
  done: number;
  waiting: number;
  failed: number;
  /** Set while the import runs with links waiting and AI may not run now. */
  waitReason: AiWaitReason | null;
}

/** Asks the owner for a file of links (a browser bookmarks export or a text file). */
export async function pickImportFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: false,
    multiple: false,
    filters: [
      { name: "Bookmarks or links", extensions: ["html", "htm", "txt"] },
    ],
  });
  return typeof picked === "string" ? picked : null;
}

/** Reads the picked file in the core and counts what an import would do. Stores nothing. */
export function previewImport(path: string): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_import", { path });
}

/** Imports the picked file: new links are stored at once; summaries follow as background work. */
export function startImport(
  path: string,
  withSummaries: boolean,
): Promise<ImportStatus> {
  return invoke<ImportStatus>("start_import", { path, withSummaries });
}

/** The newest import, or null when there was none. */
export function getImport(): Promise<ImportStatus | null> {
  return invoke<ImportStatus | null>("get_import");
}

/** Pauses this import only. */
export function pauseImport(id: string): Promise<ImportStatus> {
  return invoke<ImportStatus>("pause_import", { id });
}

/** "Stop here": ends the import now; its links with no summary yet stay link only. */
export function stopImport(id: string): Promise<ImportStatus> {
  return invoke<ImportStatus>("stop_import", { id });
}

/** Continues a paused import. While AI may not run, it keeps waiting and says why. */
export function continueImport(id: string): Promise<ImportStatus> {
  return invoke<ImportStatus>("continue_import", { id });
}

/** The event the core sends with the import after each change. */
export const IMPORT_EVENT = "import-changed";

/** Calls `handler` with the import after each change. Resolves to the unsubscribe call. */
export function onImportChanged(
  handler: (status: ImportStatus) => void,
): Promise<() => void> {
  return listen<ImportStatus>(IMPORT_EVENT, (event) => handler(event.payload));
}
