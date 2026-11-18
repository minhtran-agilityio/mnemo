// Fills in the specific reason on the startup error page from the `code` query value.
import { startupReasonText } from "./error-text";

const reason = document.querySelector<HTMLElement>("#startup-reason");
if (reason) {
  reason.textContent = startupReasonText(
    new URLSearchParams(window.location.search).get("code"),
  );
}
