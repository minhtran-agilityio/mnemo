// The design system: the only entry point. Importing it loads the tokens and the base styles.
import "../ds/tokens.css";
import "../ds/base.css";

// One barrel per tab of the design system. A component lives in components/<name>/ and is
// exported from the barrel of its tab, so each tab's work edits only its own barrel.
export * from "./components/controls";
export * from "./components/feedback";
export * from "./components/lists";
export * from "./components/records";
export * from "./components/surfaces";

// Icons: one helper in its own module, so a component can import it without a cycle.
export { createIcon } from "./icon";
