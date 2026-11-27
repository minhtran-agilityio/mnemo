// The Import bookmarks page (#29, LIB-03), reached from Bookmarks at #/import. Four steps, as in
// the prototype: pick a file, check what it holds, import, done.
//
// The core reads the file and does all the work; this page only shows the core's answers and
// sends the owner's choices. Check stores nothing: Cancel or "Choose another file" goes back with
// nothing imported. Import stores the new links at once; with summaries, they are then made as
// background work, and the progress line follows the core's `import-changed` events. Pause and
// Continue act on this import only; "Stop here" ends it (the owner's answer, 2026-11-27). An
// import left open by a Quit shows as paused when the page opens. Every part comes from
// ui/src/ds; import.css lays them out. All text goes in as text.
import {
  buildBanner,
  buildText,
  createButton,
  createCheckbox,
  createConfirmDialog,
  createImportProgress,
  createImportSummary,
  createPageHeader,
  createStepIndicator,
  type ImportProgressOptions,
  setImportProgress,
} from "../../ds";
import {
  errorMessage,
  type ImportPreview,
  type ImportStatus,
} from "../../shared/api";
import {
  doneText,
  ended,
  newer,
  PAGE_CONTEXT,
  PAGE_TITLE,
  PICK_TEXT,
  retryText,
  STEPS,
  type Step,
  stateText,
  stepOf,
  waitText,
} from "./import-logic";

/** The calls the page makes; main.ts passes the typed client from shared/api. */
export interface ImportDeps {
  pickImportFile(): Promise<string | null>;
  previewImport(path: string): Promise<ImportPreview>;
  startImport(path: string, withSummaries: boolean): Promise<ImportStatus>;
  getImport(): Promise<ImportStatus | null>;
  pauseImport(id: string): Promise<ImportStatus>;
  continueImport(id: string): Promise<ImportStatus>;
  stopImport(id: string): Promise<ImportStatus>;
  onImportChanged(handler: (s: ImportStatus) => void): Promise<() => void>;
  /** Opens the Bookmarks page. */
  backToBookmarks(): void;
}

/** What the page shows. The one place it keeps its state. */
type View =
  | { kind: "loading" }
  | { kind: "pick"; error: string | null; busy: boolean }
  | {
      kind: "check";
      path: string;
      fileName: string;
      preview: ImportPreview | null;
      error: string | null;
      busy: boolean;
    }
  | { kind: "import" }
  | { kind: "done" };

/** The base name of a picked path, for the check step while the core reads the file. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The progress line's options for an import that runs or is paused. */
export function progressOptions(
  s: ImportStatus,
  pending: boolean,
): ImportProgressOptions {
  const total = s.done + s.waiting + s.failed;
  const state: ImportProgressOptions["state"] =
    s.state === "paused"
      ? "paused"
      : s.waitReason || s.retry
        ? "waiting"
        : "running";
  // A wait after a fault is said as plainly as a wait for AI (rule 1, honest failure).
  const reason =
    s.state === "paused"
      ? stateText(s)
      : s.waitReason
        ? waitText(s.waitReason)
        : s.retry
          ? retryText(s.retry)
          : undefined;
  return {
    fileName: s.fileName,
    done: s.done,
    waiting: s.waiting,
    failed: s.failed,
    total,
    state,
    reason,
    pending,
  };
}

/** Fills `container` with the Import page. Returns a function that cleans up on leave. */
export function renderImport(
  container: HTMLElement,
  deps: ImportDeps,
): () => void {
  const doc = container.ownerDocument;
  let left = false;
  let unlisten: (() => void) | null = null;
  let view: View = { kind: "loading" };
  let status: ImportStatus | null = null;
  /** A Pause, Continue or Stop call is going. */
  let pending = false;
  let withSummaries = true;
  let progress: HTMLElement | null = null;

  const back = createButton(doc, {
    label: "Back to Bookmarks",
    variant: "ghost",
    onClick: () => deps.backToBookmarks(),
  });
  const header = createPageHeader({
    doc,
    title: PAGE_TITLE,
    context: PAGE_CONTEXT,
    actions: [back],
  });
  const steps = doc.createElement("div");
  steps.className = "import-steps";
  const body = doc.createElement("div");
  body.className = "import-body";
  const notice = doc.createElement("div");
  notice.className = "import-notice";
  notice.setAttribute("aria-live", "polite");
  container.replaceChildren(header, steps, notice, body);

  function showProblem(message: string | null): void {
    notice.replaceChildren(
      ...(message ? [buildBanner({ tone: "bad", message })] : []),
    );
  }

  function setView(next: View): void {
    view = next;
    progress = null;
    render();
  }

  function stepNow(): Step {
    switch (view.kind) {
      case "loading":
      case "pick":
        return 0;
      case "check":
        return 1;
      default:
        return status ? stepOf(status) : 0;
    }
  }

  function render(): void {
    steps.replaceChildren(
      createStepIndicator(doc, {
        label: "Import steps",
        steps: STEPS,
        current: stepNow() + 1,
      }),
    );
    switch (view.kind) {
      case "loading":
        body.replaceChildren(
          buildText(doc, { content: "Loading…", tone: "muted" }),
        );
        return;
      case "pick":
        body.replaceChildren(pickStep(view));
        return;
      case "check":
        body.replaceChildren(checkStep(view));
        return;
      case "import":
        renderProgress();
        return;
      case "done":
        body.replaceChildren(doneStep());
        return;
    }
  }

  function pickStep(v: Extract<View, { kind: "pick" }>): HTMLElement {
    const box = doc.createElement("div");
    box.className = "import-pick";
    const choose = createButton(doc, {
      label: "Choose a file",
      variant: "primary",
      busy: v.busy,
      disabled: v.busy,
      onClick: () => choose_file(),
    });
    box.append(buildText(doc, { content: PICK_TEXT }), choose);
    if (v.error) box.append(buildBanner({ tone: "bad", message: v.error }));
    return box;
  }

  function checkStep(v: Extract<View, { kind: "check" }>): HTMLElement {
    const check = createCheckbox(doc, {
      label:
        "Import without summaries (links are saved as link only; use “Summarize later” on a card)",
      checked: !withSummaries,
      disabled: v.busy,
      onChange: (on) => {
        withSummaries = !on;
      },
    });
    const cancel = () => setView({ kind: "pick", error: null, busy: false });
    if (v.preview === null && v.error === null) {
      return createImportSummary(doc, {
        fileName: v.fileName,
        state: "loading",
        onCancel: cancel,
      });
    }
    if (v.error !== null || v.preview === null) {
      return createImportSummary(doc, {
        fileName: v.fileName,
        state: "error",
        error: v.error ?? undefined,
        onChooseAnother: () => choose_file(),
        onCancel: cancel,
      });
    }
    const p = v.preview;
    return createImportSummary(doc, {
      fileName: p.fileName,
      state: "ready",
      counts: {
        toAdd: p.toAdd,
        repeats: p.repeatsInFile,
        saved: p.alreadySaved,
        notLinks: p.notLinks,
      },
      slot: check.label,
      onImport: () => begin(v.path),
      onChooseAnother: () => choose_file(),
      onCancel: cancel,
    });
  }

  function renderProgress(): void {
    if (!status) return;
    const options: ImportProgressOptions = {
      ...progressOptions(status, pending),
      onPause: () => act(deps.pauseImport),
      onContinue: () => act(deps.continueImport),
      onStop: () => confirmStop(),
    };
    if (progress) {
      setImportProgress(progress, options);
      return;
    }
    progress = createImportProgress(doc, options);
    body.replaceChildren(progress);
  }

  function doneStep(): HTMLElement {
    const box = doc.createElement("div");
    box.className = "import-done";
    if (status) box.append(buildText(doc, { content: doneText(status) }));
    if (status)
      box.append(buildText(doc, { content: stateText(status), tone: "muted" }));
    const again = createButton(doc, {
      label: "Import another file",
      onClick: () => setView({ kind: "pick", error: null, busy: false }),
    });
    const open = createButton(doc, {
      label: "Back to Bookmarks",
      variant: "primary",
      onClick: () => deps.backToBookmarks(),
    });
    const actions = doc.createElement("div");
    actions.className = "import-actions";
    actions.append(again, open);
    box.append(actions);
    return box;
  }

  /** Asks for a file, then has the core read it and count what it holds. */
  function choose_file(): void {
    if (view.kind === "pick") setView({ ...view, busy: true, error: null });
    showProblem(null);
    deps
      .pickImportFile()
      .then((path) => {
        if (left) return;
        if (path === null) {
          // The owner closed the dialog: stay where they were.
          if (view.kind === "pick") setView({ ...view, busy: false });
          return;
        }
        const fileName = baseName(path);
        setView({
          kind: "check",
          path,
          fileName,
          preview: null,
          error: null,
          busy: false,
        });
        return deps.previewImport(path).then(
          (preview) => {
            if (left || view.kind !== "check" || view.path !== path) return;
            setView({ ...view, preview, fileName: preview.fileName });
          },
          (error: unknown) => {
            if (left || view.kind !== "check" || view.path !== path) return;
            setView({
              ...view,
              error: `${errorMessage(error)} Nothing was imported.`,
            });
          },
        );
      })
      .catch((error: unknown) => {
        if (left) return;
        setView({
          kind: "pick",
          busy: false,
          error: `Mnemo could not open the file picker. ${errorMessage(error)}`,
        });
      });
  }

  /** Imports the checked file. */
  function begin(path: string): void {
    if (view.kind !== "check" || view.busy) return;
    setView({ ...view, busy: true });
    deps
      .startImport(path, withSummaries)
      .then((s) => {
        if (left) return;
        show(s);
      })
      .catch((error: unknown) => {
        if (left || view.kind !== "check") return;
        setView({ ...view, busy: false });
        showProblem(`The import did not start. ${errorMessage(error)}`);
      });
  }

  /** "Stop here" cannot be undone, so the owner confirms it first. */
  function confirmStop(): void {
    if (!status || pending) return;
    const opener =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const waiting = status.waiting;
    createConfirmDialog({
      doc,
      title: "Stop this import here?",
      message:
        "It cannot be undone. The links are kept; the ones without a summary stay link only, and you can use “Summarize later” on a card.",
      lose: [
        `Summaries for the ${waiting} ${waiting === 1 ? "link" : "links"} still waiting`,
      ],
      keepLabel: "Keep importing",
      confirmLabel: "Stop here",
      onConfirm: () => act(deps.stopImport),
    }).open(opener);
  }

  /** Pause, Continue or Stop here on the shown import. */
  function act(call: (id: string) => Promise<ImportStatus>): void {
    if (!status || pending) return;
    pending = true;
    renderProgress();
    showProblem(null);
    call(status.id)
      .then((s) => {
        if (left) return;
        pending = false;
        show(s);
      })
      .catch((error: unknown) => {
        if (left) return;
        pending = false;
        renderProgress();
        showProblem(errorMessage(error));
      });
  }

  /** Shows an import the core sent: its progress, or Done once it ended. */
  function show(next: ImportStatus): void {
    status = newer(status, next);
    const s = status;
    if (ended(s)) {
      if (view.kind !== "done") setView({ kind: "done" });
      else render();
      return;
    }
    if (view.kind !== "import") setView({ kind: "import" });
    else renderProgress();
  }

  deps
    .onImportChanged((s) => {
      if (left) return;
      // Only the import this page shows. A new import comes in through the reply to Import,
      // so a late event of an import that ended (after Stop here) never replaces it.
      if (view.kind !== "import" && view.kind !== "done") return;
      if (status && s.id !== status.id) return;
      show(s);
    })
    .then((stop) => {
      if (left) stop();
      else unlisten = stop;
    })
    .catch((error: unknown) => {
      if (!left)
        showProblem(
          `Mnemo will not show live progress. ${errorMessage(error)}`,
        );
    });

  deps
    .getImport()
    .then((s) => {
      if (left) return;
      // An unfinished import (also one a Quit left paused) opens on its progress.
      if (s && !ended(s)) show(s);
      else setView({ kind: "pick", error: null, busy: false });
    })
    .catch((error: unknown) => {
      if (left) return;
      setView({ kind: "pick", error: null, busy: false });
      showProblem(
        `Mnemo could not read the last import. ${errorMessage(error)}`,
      );
    });

  render();
  return () => {
    left = true;
    unlisten?.();
  };
}
