=== ISSUE BM-01
title: [BM-01] Save a link with summary and tags
type: Feature
labels: priority:high, area:library
milestone: P2.1 Bookmarks
---
**Phase:** P2 · **Roadmap status:** prototyped (first prototype 2026-11-10, v89) · **Size:** M (guess) · **Blocked by:** {{AI-01e}}, {{AI-02}}, {{DATA-01b}}, {{APP-02}}

## Goal
The owner pastes a link and gets a card with a summary, tags and a reason. This is the first real feature and the main reason to open the app every day.

## Proposed change
- A link box. Paste a link, press Save. The bookmark is stored at once with its URL and title, before any AI work, so nothing is lost if AI fails.
- The app then reads the page text and asks Claude, through `run_task` with a JSON schema, for a summary, tags and a reason why it may matter.
- Honest failure: if the page cannot be read (login wall, error, empty text), the bookmark is saved as link only, with a null summary. Nothing is made up from the URL or the title.
- "Paste the text": on a link-only card, the owner pastes the page text and the summary is made from that.
- With AI off or paused, the bookmark is saved as link only and marked "no summary yet", with a button to summarize later.
- The card shows: title, site, summary, tags, the reason marked as a guess, and the saved date.

## Acceptance criteria
- [ ] 5 public links give 5 cards with a summary and tags in the desktop app.
- [ ] A link the app cannot read is saved with a null summary and shows "Paste the text".
- [ ] Pasted text gives a summary for that card.
- [ ] With the AI switch off, Save still works and stores the link.
- [ ] The save runs through the AI runner. Unit tests use the fake runner for: success, unreadable page, schema error, timeout.
- [ ] The reason is shown as a guess. The summary contains nothing that is not in the page text (spot check by the owner on 5 links).
- [ ] Works on Mac and on Ubuntu.

## Out of scope
- Folders and auto-filing ({{BM-02}}). The Bookmarks page ({{BM-03}}). Duplicate check ({{LIB-02}}).
- PDF and video links (LATER-01, LATER-02). Save them as link only.
- Suggestions after a save (RES-01) and deep research (RES-02).

## Evidence and links
- Roadmap, BM-01: {{ROADMAP}}
- Prototype, link box and bookmark card (v89): {{PROTO}}
- Open point for the pull request: who reads the page. Proposed: the Rust core fetches the page and extracts the text, then Claude gets only the text with no tools. This is cheaper and easy to test with the fake runner. The other option is to let Claude fetch with a web tool. This is a proposal, not a decision of the owner.

=== ISSUE BM-02
title: [BM-02] Folders, auto-filing, Move and Undo
type: Feature
labels: priority:high, area:library
milestone: P2.1 Bookmarks
---
**Phase:** P2 · **Roadmap status:** prototyped (v11, v80) · **Size:** S (guess) · **Blocked by:** {{BM-01}}

## Goal
A new link lands in the right folder by itself, and only the owner creates folders, moves or deletes.

## Proposed change
- A folder table and "Unsorted" as the fixed default folder.
- When a link is saved, the save task also picks one existing folder, or Unsorted when none fits. The choice and its reason are stored and shown as a guess.
- The owner can create, rename and delete folders. Deleting a folder moves its bookmarks to Unsorted.
- Move a bookmark to another folder. One step of Undo for the last move or delete.

## Acceptance criteria
- [ ] A save never creates a folder by itself. A test gives the fake runner an unknown folder name and the bookmark goes to Unsorted.
- [ ] Move then Undo puts the bookmark back in its old folder.
- [ ] Delete then Undo brings the bookmark back.
- [ ] Deleting a folder loses no bookmark.
- [ ] With AI off, a new link goes to Unsorted.

## Out of scope
- Folder proposals from the app (LATER-04).
- Nested folders, unless the prototype shows them. Check the prototype first.
- Undo of more than one step.

## Evidence and links
- Roadmap, BM-02: {{ROADMAP}}
- Prototype, folders (v11, v80): {{PROTO}}

=== ISSUE BM-03
title: [BM-03] Bookmarks page: folders, 3 views, search
type: Feature
labels: priority:high, area:library
milestone: P2.1 Bookmarks
---
**Phase:** P2 · **Roadmap status:** prototyped (v11, v12, v24, v80) · **Size:** M (guess) · **Blocked by:** {{BM-01}}, {{BM-02}}

## Goal
One page to browse all bookmarks by folder, in the view the owner likes, and to see at once which links need a look.

## Proposed change
- A folder sidebar with counts.
- Three views of the same list: List, Cards and Compact. The chosen view is kept after restart.
- A search box that filters the bookmarks on this page by words in the title, summary and tags.
- A "needs a look" bar that lists every bookmark with a null summary, with a link to "Paste the text".
- Open a bookmark to see its full card and open the link in the system browser.

## Acceptance criteria
- [ ] Each view shows the same bookmarks in the same order.
- [ ] The needs-a-look bar lists every link with a null summary, and no other link.
- [ ] Search finds a bookmark by a word that is only in its summary.
- [ ] A folder count equals the number of bookmarks shown for that folder.
- [ ] With 500 bookmarks the page scrolls without a visible delay on both machines.
- [ ] The page looks like the prototype in light and dark themes.

## Out of scope
- Search across all item types ({{LIB-01}}).
- Bulk actions on many bookmarks.

## Evidence and links
- Roadmap, BM-03: {{ROADMAP}}
- Prototype, Bookmarks page (v11, v12, v24, v80): {{PROTO}}

=== ISSUE LIB-02
title: [LIB-02] Duplicate check when saving a link
type: Feature
labels: priority:high, area:library
milestone: P2.1 Bookmarks
---
**Phase:** P2 · **Roadmap status:** not started (no prototype screen) · **Size:** S (guess) · **Blocked by:** {{BM-01}}

## Goal
The same link is never saved twice, and no AI run is spent on a link that is already there.

## Proposed change
- A plain code function that turns a URL into a compare key: lower-case host, no `www.`, no fragment, no tracking parameters (`utm_*`, `fbclid`, `gclid`), no trailing slash.
- Before a save starts, look up the key. If it exists, show the old card with "already saved" and add nothing.
- The check runs before any AI work.
- The compare key is stored with each bookmark, so the lookup is one indexed query.

## Acceptance criteria
- [ ] Saving the same link twice shows "already saved" and adds nothing.
- [ ] 5 planted duplicates are caught: with and without `www.`, with a `utm_` parameter, with a fragment, with a trailing slash, with a different letter case in the host.
- [ ] Two different pages on the same site are not treated as duplicates.
- [ ] The duplicate check starts no AI run.
- [ ] A soft-deleted bookmark does not block a new save of the same link.

## Out of scope
- Near-duplicates (same content, different URL). That is part of the weekly digest (DIG-02).
- Following redirects or short links.

## Evidence and links
- Roadmap, LIB-02: {{ROADMAP}}
- No prototype screen exists. Reuse the bookmark card from {{BM-01}} with an "already saved" line.

=== ISSUE LIB-03
title: [LIB-03] Import old links from a file
type: Feature
labels: priority:medium, area:library
milestone: P2.1 Bookmarks
---
**Phase:** P2 · **Roadmap status:** partly prototyped (v103 mentions an Import screen, states not checked) · **Size:** M (guess) · **Blocked by:** {{BM-01}}, {{LIB-02}}, {{AI-02}}

## Goal
The owner brings in the links they already have, in batches, without using up the usage limit in one go.

## Proposed change
- Pick a file of links: a browser bookmarks export (HTML) or a plain text file with one URL per line.
- Show the count found and the count of repeats, then ask to confirm.
- All links are stored at once as link only. Summaries are then made in batches as background work through the queue.
- A progress line: done, waiting, failed. Pause and Continue buttons.
- Import pauses by itself at the usage pause line and can continue later, also after a restart.

## Acceptance criteria
- [ ] A file of 50 links imports in batches and shows progress.
- [ ] Exact repeats, inside the file and against saved bookmarks, are skipped and counted.
- [ ] Import pauses at the usage limit and continues when the owner presses Continue. Tested with the fake runner.
- [ ] After Quit in the middle of an import, the next start shows the import as paused with the right counts.
- [ ] A line that is not a link is skipped and counted, and does not stop the import.

## Out of scope
- Import from other apps through their API (Pocket, Raindrop and others).
- Import of the folders of the browser export. First version: all go through normal auto-filing.

## Evidence and links
- Roadmap, LIB-03: {{ROADMAP}}
- Prototype, Import screen (v103). The states of this screen were not checked. Look at the prototype before you build, and list missing states in the pull request.

=== ISSUE BM-04
title: [BM-04] Eval harness for save quality
type: Feature
labels: priority:high, area:library
milestone: P2.1 Bookmarks
---
**Phase:** P2 · **Roadmap status:** not started (no screen needed) · **Size:** M (guess) · **Blocked by:** {{BM-01}}

## Goal
One command gives a score for the save summaries on a fixed set of pages. A change of prompt or model can then be compared with numbers, not by feeling. The first baseline is an exit check for Phase 2.

## Proposed change
- A folder `evals/save/` with a fixed set of about 20 pages, stored as text files so the eval does not depend on the live web. Include easy pages, long pages, non-English pages and 3 pages that cannot be read (empty or login wall).
- For each page: the expected facts (what the summary must contain), the expected tags, and what must not appear.
- One command runs the real save task through the real runner on every page and prints a score per page and a total.
- Checks in plain code where possible (null summary for unreadable pages, tag overlap, length limits). A Claude judge only for "does the summary contain the expected facts", with its prompt kept in the repo.
- Each run saves its result to a dated file. The first one is the baseline.

## Acceptance criteria
- [ ] One command scores the fixed pages through the real runner and prints the scores.
- [ ] The first baseline is saved in the repo.
- [ ] A page the app cannot read scores as passed only when it is link only with no summary.
- [ ] Running the eval twice with no change gives total scores that differ by a small amount. Write the measured difference in the pull request, so later changes can be judged against it.
- [ ] The eval is not part of `check` or CI, because it uses the real subscription. It prints how many runs it used.

## Out of scope
- Evals for Ask Mnemo. Its 15 questions and 3 trick questions are in {{ASK-01}}.
- A screen in the app.
- Automatic prompt tuning.

## Evidence and links
- Roadmap, BM-04 and the P2 exit check: {{ROADMAP}}
- Architecture, "Quy tắc code và test", rule 4 (real AI quality is scored by the eval harness): {{ARCH}}
- The count of 20 pages is a guess by the author of this ticket. The owner may add their own real pages.

=== ISSUE LIB-01
title: [LIB-01] Everything list, tags and word search
type: Feature
labels: priority:high, area:library
milestone: P2.2 Search and Ask Mnemo
---
**Phase:** P2 · **Roadmap status:** prototyped (v16, v17, v34) · **Size:** M (guess) · **Blocked by:** {{DATA-01b}}, {{APP-02}}

## Goal
One list of every item of every type, with search by words and filter by tag. The same search is the base for Ask Mnemo.

## Proposed change
- A word search index with the built-in SQLite search (FTS5) over the title, text and tags of every item type. The index is kept up to date inside the storage module on add, update and delete.
- One search function in the core: words in, a ranked list of items of any type out, with a short piece of matching text.
- The Everything screen: one list of all items, newest first, with a type mark, a search box and type filters.
- Tags: a tag list in the sidebar with counts. Clicking a tag filters the list.
- The sidebar search box from {{APP-02}} opens this screen with the word.
- No embeddings.

## Acceptance criteria
- [ ] A search finds a bookmark and a note that share a word. Tested in storage with two item types now, and checked again in {{QA-P3}} when notes exist.
- [ ] A tag in the sidebar filters the list, and the count equals the number of items shown.
- [ ] A deleted item is not found.
- [ ] An item edited a moment ago is found by its new words.
- [ ] Search over 5,000 items answers in under 200 ms on both machines. Write the measured time in the pull request.
- [ ] Search works with Vietnamese words with accents. Unverified: how the default FTS5 tokenizer handles Vietnamese. Test it and write down the result.

## Out of scope
- Meaning-based search. The roadmap rule is no embeddings.
- The graph (KNOW-02).
- Shared items (LATER-03).

## Evidence and links
- Roadmap, LIB-01 and the rule "No embeddings": {{ROADMAP}}
- Architecture, "DEC-03" (FTS5 for Everything and Ask Mnemo): {{ARCH}}
- Prototype, Everything and tags (v16, v17, v34): {{PROTO}}

=== ISSUE ASK-01
title: [ASK-01] Ask Mnemo, with sources
type: Feature
labels: priority:high, area:library
milestone: P2.2 Search and Ask Mnemo
---
**Phase:** P2 · **Roadmap status:** prototyped (v39, v110, v111) · **Size:** L (guess, split it when work starts) · **Blocked by:** {{LIB-01}}, {{AI-01e}}, {{BM-01}}

## Goal
A full-page chat that answers only from what the owner saved, shows where each answer comes from, and says "nothing found" when the library has no answer.

## Proposed change
- Plain code, not Claude, decides whether the typed text is a link (save it) or a question (ask).
- For a question: the core runs word searches with {{LIB-01}}, picks the best items, and gives Claude only those items as context. Claude has no web tool here.
- The answer appears bit by bit (stream-json mode of the runner).
- Each answer has a Source line that names saved items. Each source opens its item. Code checks that every source ID exists before it is shown.
- "How I searched" lists the real search steps: the words used and the number of results.
- When the search finds nothing useful, the answer is "nothing found in your library".
- A fixed test set in `evals/ask/`: 15 real questions and 3 trick questions, with a command to run them.

## Acceptance criteria
- [ ] 15 real questions get an answer with a source that exists and that contains the fact.
- [ ] 3 trick questions get "nothing found", not a made-up answer.
- [ ] "How I searched" lists the real search steps, and they match the log of the search function.
- [ ] A source that does not exist is never shown. Tested with the fake runner returning a wrong ID.
- [ ] With AI off, the page explains why it cannot answer and offers the plain search.
- [ ] Pasting a link in the box saves it and does not ask a question.

## Out of scope
- Answers from the web.
- Chat history across sessions, unless the prototype shows it. Check the prototype first.
- Deep research (RES-02).

## Evidence and links
- Roadmap, ASK-01: {{ROADMAP}}
- Architecture, "DEC-04" (stream-json for Ask Mnemo): {{ARCH}}
- Prototype, Ask Mnemo (v39, v110, v111): {{PROTO}}
