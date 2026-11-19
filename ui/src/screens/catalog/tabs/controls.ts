// The Controls tab: buttons, text fields and ways to choose. This file is the tab's renderer; the
// Controls agent owns it with ds/catalog/controls.ts, ds/catalog/controls.css and
// ds/components/controls.ts.

import "../../../ds/catalog/controls.css";
import { button, el, entryRows, state, type TabRenderer } from "../parts";

export const renderControls: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  const field = (
    label: string,
    setup: (input: HTMLInputElement) => void,
  ): HTMLElement => {
    const wrap = el(doc, "label", "field", label);
    const input = el(doc, "input", "input");
    input.type = "url";
    input.placeholder = "https://example.com";
    setup(input);
    wrap.append(input);
    return wrap;
  };

  panel.append(
    entryRows(ctx, "Controls", {
      button: () => {
        const disabled = button(doc, "btn", "Disabled");
        disabled.disabled = true;
        return [
          state(doc, "default", button(doc, "btn", "Cancel")),
          state(doc, "primary", button(doc, "btn btn-primary", "Save link")),
          state(doc, "ghost", button(doc, "btn btn-ghost", "Learn more")),
          state(doc, "disabled", disabled),
        ];
      },
      input: () => {
        const error = el(
          doc,
          "p",
          "cat-note",
          "Enter a full link that starts with https://.",
        );
        error.id = "cat-input-error";
        return [
          state(
            doc,
            "default",
            field("Link", () => {}),
          ),
          state(doc, "invalid", [
            field("Link (invalid)", (input) => {
              input.value = "example";
              input.setAttribute("aria-invalid", "true");
              input.setAttribute("aria-describedby", error.id);
            }),
            error,
          ]),
          state(
            doc,
            "disabled",
            field("Link (disabled)", (input) => {
              input.disabled = true;
            }),
          ),
        ];
      },
    }),
  );
};
