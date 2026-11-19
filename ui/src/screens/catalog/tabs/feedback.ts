// The Feedback tab: status, amounts, messages and trust. This file is the tab's renderer; the
// Feedback agent owns it with ds/catalog/feedback.ts, ds/catalog/feedback.css and
// ds/components/feedback.ts.

import { Check, Trash2 } from "lucide";
import "../../../ds/catalog/feedback.css";
import {
  buildAiLight,
  buildAiOffState,
  buildBanner,
  buildBusyLine,
  buildDotLabel,
  buildEmptyState,
  buildErrorState,
  buildKeyHint,
  buildPill,
  buildProgress,
  buildRunCount,
  buildSkeleton,
  buildSpinner,
  buildToast,
  buildTrustLabel,
  buildUsageMeter,
  createFeedbackIcon,
  createToastRegion,
  type PillTint,
} from "../../../ds/index";
import { button, el, entryRows, state, type TabRenderer } from "../parts";

/** Wraps a part so a state the pointer or keyboard would cause shows without them. */
function forced(
  doc: Document,
  kind: "hover" | "focus",
  node: Node,
): HTMLElement {
  const wrap = el(doc, "div", `fb-force-${kind}`);
  wrap.append(node);
  return wrap;
}

export const renderFeedback: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  const noop = () => {};

  // The toast region is fixed to the window. It lives on the themed root and goes when the screen closes.
  const toasts = createToastRegion();
  ctx.root.append(toasts.element);
  ctx.signal.addEventListener("abort", () => toasts.element.remove());

  const pill = (
    caption: string,
    tint: PillTint,
    text: string,
    withIcon = false,
  ) =>
    state(
      doc,
      caption,
      buildPill({ text, tint, icon: withIcon ? Check : undefined }),
    );

  const meter = (caption: string, percent: number): HTMLElement =>
    state(
      doc,
      caption,
      buildUsageMeter({ label: "Usage now", percent, resetsAt: "14:00" }),
      { grow: true },
    );

  const light = (caption: string, node: Node) => state(doc, caption, node);

  panel.append(
    entryRows(ctx, "Feedback", {
      pill: () => [
        pill("default", "default", "Draft"),
        pill("info", "info", "Reading"),
        pill("note", "note", "Idea"),
        pill("good", "good", "Done", true),
        pill("warn", "warn", "Due today"),
        pill("bad", "bad", "Overdue"),
      ],
      dot: () => [
        state(doc, "good", buildDotLabel("Synced", "good")),
        state(doc, "accent", buildDotLabel("New", "accent")),
        state(doc, "warn", buildDotLabel("Needs a look", "warn")),
        state(doc, "bad", buildDotLabel("Failed", "bad")),
        state(doc, "off", buildDotLabel("Off", "off")),
      ],
      "AI status light": () => ({
        column: true,
        nodes: [el(doc, "div", "cat-ex"), el(doc, "div", "cat-ex")].map(
          (row, i) => {
            row.append(
              ...(i === 0
                ? [
                    light("idle", buildAiLight({ state: "idle" })),
                    light(
                      "running",
                      buildAiLight({ state: "running", jobs: 2 }),
                    ),
                    light("off", buildAiLight({ state: "off" })),
                  ]
                : [
                    light(
                      "not installed",
                      buildAiLight({
                        state: "not-installed",
                        onCheckAgain: noop,
                      }),
                    ),
                    light("signed out", buildAiLight({ state: "signed-out" })),
                    light(
                      "at limit",
                      buildAiLight({ state: "at-limit", resumesAt: "14:00" }),
                    ),
                  ]),
            );
            return row;
          },
        ),
      }),
      "usage meter": () => [
        meter("normal", 32),
        meter("warning ≥ 60%", 62),
        meter("paused ≥ 95%", 96),
        state(
          doc,
          "only own runs known",
          buildRunCount({ label: "Mnemo's runs today", count: 14 }),
          { grow: true },
        ),
      ],
      progress: () => [
        state(
          doc,
          "determinate · 120 of 300 imported",
          buildProgress({ label: "Import", value: 40 }),
          {
            grow: true,
          },
        ),
        state(doc, "indeterminate", buildProgress({ label: "Reading page" }), {
          grow: true,
        }),
      ],
      spinner: () => [
        state(doc, "small", buildSpinner()),
        state(doc, "large", buildSpinner("lg")),
        state(doc, "spinner + words", buildBusyLine("Reading the page…")),
      ],
      skeleton: () => [state(doc, "skeleton", buildSkeleton(), { grow: true })],
      banner: () => ({
        column: true,
        nodes: [
          buildBanner({
            tone: "info",
            message:
              "3 folder suggestions are ready. Nothing moves until you accept.",
            action: { label: "Review", onClick: noop },
          }),
          buildBanner({
            tone: "warn",
            lead: "62% of usage used.",
            message: "Background jobs pause at 95%.",
            action: { label: "See usage", onClick: noop },
          }),
          buildBanner({
            tone: "bad",
            lead: "Could not save the database.",
            message: "The disk is full. Free some space, then try again.",
            action: { label: "Try again", onClick: noop },
          }),
          state(
            doc,
            "action hover",
            forced(
              doc,
              "hover",
              buildBanner({
                tone: "info",
                message: "Action hover.",
                action: { label: "Review", onClick: noop },
              }),
            ),
            { grow: true },
          ),
          state(
            doc,
            "action focus",
            forced(
              doc,
              "focus",
              buildBanner({
                tone: "info",
                message: "Action focus.",
                action: { label: "Review", onClick: noop },
              }),
            ),
            { grow: true },
          ),
        ],
      }),
      toast: () => {
        const demo = button(doc, "btn", "");
        demo.append(
          createFeedbackIcon(Trash2, "sm"),
          doc.createTextNode('Delete "Notes on FTS5"'),
        );
        demo.addEventListener("click", () => {
          toasts.show('Deleted "Notes on FTS5".', {
            onUndo: () => toasts.show("Restored."),
          });
        });
        return [
          state(
            doc,
            "fixed",
            buildToast({
              message: "Moved 3 links to Archive.",
              onAction: noop,
            }),
          ),
          state(
            doc,
            "action hover",
            forced(
              doc,
              "hover",
              buildToast({
                message: "Moved 3 links to Archive.",
                onAction: noop,
              }),
            ),
          ),
          state(
            doc,
            "action focus",
            forced(
              doc,
              "focus",
              buildToast({
                message: "Moved 3 links to Archive.",
                onAction: noop,
              }),
            ),
          ),
          state(doc, "message only", buildToast({ message: "Link saved." })),
          state(doc, "live: shows a toast", demo),
        ];
      },
      "trust label": () => {
        const sentence = el(doc, "p", "fb-sentence");
        const where = el(doc, "b", undefined, "Work / Mnemo");
        sentence.append(
          buildTrustLabel("guess"),
          doc.createTextNode(" Filed in "),
          where,
          doc.createTextNode(
            " because the page mentions Tauri and a local database.",
          ),
        );
        const labels = el(doc, "div", "cat-ex");
        labels.append(
          buildTrustLabel("guess"),
          buildTrustLabel("unverified"),
          buildTrustLabel("ai"),
        );
        return { column: true, nodes: [labels, sentence] };
      },
      "empty state": () => [
        state(
          doc,
          "default",
          buildEmptyState({
            title: "No links yet",
            body: [
              doc.createTextNode("Paste a link with "),
              buildKeyHint("⌘"),
              buildKeyHint("V"),
              doc.createTextNode(", or forward one from Telegram."),
            ],
            action: { label: "Save a link", onClick: noop, primary: true },
          }),
        ),
      ],
      "error state": () => [
        state(
          doc,
          "default",
          buildErrorState({
            title: "Could not open your library",
            body: "The data file is from a newer Mnemo. Nothing was changed. Update Mnemo, then open it again.",
            action: { label: "Quit Mnemo", onClick: noop },
          }),
        ),
      ],
      "AI-off state": () => [
        state(
          doc,
          "off",
          buildAiOffState({
            action: { label: "Open AI settings", onClick: noop },
          }),
        ),
        state(doc, "at limit", buildAiOffState({ reason: "limit" })),
      ],
    }),
  );
};
