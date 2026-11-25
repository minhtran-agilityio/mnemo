-- Migration 10: remember that a bookmark's page was not reached (#25, BM-01).
--
-- bookmark.page_not_reached: 1 when the last read could not reach the page for now (the site
-- was down, slow or busy: a timeout, a broken connection, HTTP 5xx, 429 or 408). Such a bookmark
-- is pending ("no summary yet") and its card offers both "Summarize later" and "Paste the text"
-- (owner decision on issue #25: "Offer both"). The five summary statuses stay as they are; the
-- check allows the flag only on a pending row, so it can never disagree with the status.
-- Old rows: 0. No column is renamed.
ALTER TABLE bookmark ADD COLUMN page_not_reached INTEGER NOT NULL DEFAULT 0
    CHECK (page_not_reached IN (0, 1) AND (page_not_reached = 0 OR summary_status = 'pending'));
