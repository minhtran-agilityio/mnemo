---
paths:
  - "ui/**/*.{html,css,ts,tsx}"
  - "PRODUCT.md"
  - "DESIGN.md"
---

# Design rules (UI and UX)

## Source of truth
- The prototype is the visual source of truth. Read `PRODUCT.md` and `DESIGN.md` (when present) before UI work. Do not introduce a new palette, font or component style without updating the design record.
- Every colour, font, size, radius, shadow and spacing value comes from a token. Add a token before using a new value.

## Desktop app conventions
- Mnemo is a desktop app with a tray. Closing the window does not quit; say so the first time the owner closes it.
- Use native-feeling patterns: keyboard shortcuts for frequent actions, no web-page chrome, no marketing copy.
- No sign-in screens. Claude problems (not installed, signed out, at limit) show as one plain line with how to fix it, not a blocking dialog.

## Honesty in the UI
- Content the system generated or guessed (AI summaries, tags, reasons) is labelled so the owner can tell it from their own input.
- A failed AI task shows an empty result and the reason, never placeholder text that looks like a real summary.
- Show usage honestly: the warning at 60%, background jobs paused at 95%. If only Mnemo's own run count is known, say that.
- Actions that write outside Mnemo show what will happen and wait for approval.

## Accessibility (WCAG 2.2 AA)
- Text contrast at least 4.5:1 (3:1 for large text, control borders and focus indicators), in every theme.
- Click targets at least 24 by 24 CSS pixels; primary controls at least 44 by 44.
- Focus is always visible and never removed without a replacement.
- Colour is never the only signal of state. Pair it with text or an icon.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.

## Layout and type
- Use a fixed spacing scale and a type scale; no one-off values.
- Limit reading text to about 60 to 75 characters per line.
- Long titles, names and URLs wrap or truncate with a way to see the full value. Test with real, messy content.

## States
- Design every state: empty, loading, success, error, partial, overflow, and AI off.
- Empty states say what to do next. Error states say what happened and what the owner can do, in plain words.

## Interaction
- One primary action per view. Secondary actions are visually quieter.
- Feedback within 100ms for any action; show progress for anything slower than a second (AI tasks always).
- Reversible actions get Undo; irreversible ones get a confirmation that names what will be lost.

## Copy
- Short, plain, specific words. Labels name the action ("Save link"), not the mechanism ("Submit").
- Use the same term for the same thing everywhere.

## Avoid
- Decorative gradients, glows, glassmorphism and stock "AI" styling.
- Placeholder-as-label inputs, hover-only controls, and icon-only buttons without a text label or tooltip.
