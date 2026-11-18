=== ISSUE NOTE-01
title: [NOTE-01] Notes with nested labels
type: Feature
labels: priority:high, area:workspace
milestone: P3.1 Notes and ideas
---
**Phase:** P3 · **Roadmap status:** prototyped (v25 to v29, v33, v79) · **Size:** M (guess) · **Blocked by:** {{DATA-01b}}, {{APP-02}}

## Goal
The owner writes Markdown notes inside Mnemo and finds them by label. Every note has a place, so nothing is lost in one long list.

## Proposed change
- A Notes screen: a label tree on the left, the note list in the middle, the note on the right.
- A note is Markdown with two modes: Read (rendered) and Edit (plain text), with Save and Cancel.
- Every note has at least one label. Save is refused with a plain message when a note has none.
- Labels nest. A label can be created, renamed, moved under another label and deleted.
- Opening a parent label also shows the notes of its child labels.
- Deleting a label moves its notes to the parent label. Deleting a top label is refused while it still holds notes that have no other label.
- Notes live in the database, not as separate files. Notes are added to the word search index of {{LIB-01}}.

## Acceptance criteria
- [ ] A note cannot be saved with no label.
- [ ] Opening a parent label also shows notes of its child labels.
- [ ] Deleting a label moves its notes to the parent. No note is lost. A test counts notes before and after.
- [ ] Cancel in Edit mode restores the text from before the edit.
- [ ] Leaving a note with unsaved changes asks first.
- [ ] Markdown from a note cannot run script in the app window (test with a `<script>` tag and an `onerror` image).
- [ ] The note is still there after Quit and start, on Mac and on Ubuntu.

## Out of scope
- AI actions on notes ({{NOTE-02}}).
- Images inside notes, unless the prototype shows them. Check first.
- Notes as Markdown files on disk. The owner chose notes inside the app.
- Version history of a note.

## Evidence and links
- Roadmap, NOTE-01: {{ROADMAP}}
- Architecture, "DEC-03" (notes live in SQLite): {{ARCH}}
- Prototype, Notes (v25 to v29, v33, v79): {{PROTO}}
- The rule for deleting a top label is a proposal by the author of this ticket, because the roadmap does not cover that case.

=== ISSUE IDEA-01
title: [IDEA-01] Ideas with stages
type: Feature
labels: priority:high, area:workspace
milestone: P3.1 Notes and ideas
---
**Phase:** P3 · **Roadmap status:** prototyped (v71) · **Size:** M (guess) · **Blocked by:** {{DATA-01b}}, {{APP-02}}

## Goal
An idea grows from a first thought into a project. The app shows how ready it is, and it never blocks the owner.

## Proposed change
- An Ideas screen with ideas grouped by stage: Spark, Shape, Ready, Project.
- An idea has: a title, a text, tags, a source (a saved item or a link), a "why" line and an outline.
- Four plain code checks: has a tag, has a source, has a why, has an outline. The stage follows the number of checks that pass. The checks are advice only.
- "Turn into project" works at any stage. It creates a project and links idea and project in both directions. The idea moves to the stage Project.
- No AI is used in this ticket.

## Acceptance criteria
- [ ] The stage follows the four checks. A test covers each step from 0 to 4 checks.
- [ ] "Turn into project" works at any stage and links idea and project both ways.
- [ ] Removing a tag from a Ready idea moves it back one stage and deletes nothing.
- [ ] An idea is found by word search ({{LIB-01}}).
- [ ] Ideas are kept after restart, on Mac and on Ubuntu.

## Out of scope
- The project page itself ({{PROJ-01}}). Until it exists, "Turn into project" creates the project record and shows a confirmation.
- Ideas made from research reports (RES-03).
- AI suggestions for ideas.

## Evidence and links
- Roadmap, IDEA-01: {{ROADMAP}}
- Prototype, Ideas (v71): {{PROTO}}
- Unverified: the exact mapping from passed checks to stage. Read it from the prototype (v71) and write it in the pull request.

=== ISSUE NOTE-02
title: [NOTE-02] Notes AI actions: Tidy, Summarize, Turn into idea
type: Feature
labels: priority:medium, area:workspace
milestone: P3.1 Notes and ideas
---
**Phase:** P3 · **Roadmap status:** not started (no prototype found) · **Size:** S (guess) · **Blocked by:** {{NOTE-01}}, {{IDEA-01}}, {{AI-01e}}, {{AI-02}}

## Goal
Three small AI helpers on a note. Each one shows a preview first, so the owner's text never changes without a yes.

## Proposed change
- Three buttons on a note: Tidy (fix layout and typos, keep the meaning), Summarize (a short summary above the note), Turn into idea (a new idea with title, why and outline taken from the note).
- Each action runs through `run_task` with a JSON schema and no tools.
- The result opens as a preview beside the current text. Accept applies it. Cancel drops it.
- With AI off or paused, the buttons are disabled and a line says why.
- Each action registers its model row for {{AI-03}}.

## Acceptance criteria
- [ ] Nothing in the note changes until the owner accepts the preview.
- [ ] Cancel leaves the note byte-for-byte the same. A test checks it.
- [ ] With AI off, the buttons say why they are off.
- [ ] "Turn into idea" creates one idea that links back to the note, only after Accept.
- [ ] A failed run shows a plain error and changes nothing.

## Out of scope
- Other actions (translate, expand, rewrite).
- AI actions on bookmarks or projects.

## Evidence and links
- Roadmap, NOTE-02: {{ROADMAP}}
- No prototype screen was found. Draw the preview state in the prototype thread first, or keep it to a simple side-by-side view and show a screenshot in the pull request.

=== ISSUE PROJ-01
title: [PROJ-01] Projects: list and project page with blocks
type: Feature
labels: priority:high, area:workspace
milestone: P3.2 Projects
---
**Phase:** P3 · **Roadmap status:** prototyped (v70, v72) · **Size:** M (guess) · **Blocked by:** {{DATA-01b}}, {{DATA-01d}}, {{APP-02}}

## Goal
A project is one page that holds everything about it: text, images, links, saved items and steps. The owner always sees the next action.

## Proposed change
- A Projects screen: a card list of projects with name, status and progress.
- "New project" opens the new project page at once.
- A project page is a stack of blocks. Block types: text, image, link, saved item (a bookmark, a note or an idea), steps (a checklist).
- Blocks can be added, edited, moved up and down, and deleted.
- A project has a status. A status change shows what the status means and one clear next action.
- Images use the files folder from {{DATA-01d}}.

## Acceptance criteria
- [ ] A new project opens its page at once.
- [ ] Text, image and link blocks are kept after restart, in the same order.
- [ ] Changing status shows what it means and one next action.
- [ ] A saved-item block opens its item. If the item was deleted, the block says so and does not break the page.
- [ ] A project made from an idea ({{IDEA-01}}) shows the link back to its idea.
- [ ] Works on Mac and on Ubuntu, in light and dark themes.

## Out of scope
- The kanban and card detail ({{PROJ-02}}).
- Projects made from research (RES-03).
- Sharing a project.

## Evidence and links
- Roadmap, PROJ-01: {{ROADMAP}}
- Prototype, Projects list and project page (v70, v72): {{PROTO}}
- Unverified: the list of statuses and the next action for each. Read them from the prototype and list them in the pull request.

=== ISSUE PROJ-02
title: [PROJ-02] Project kanban and card detail
type: Feature
labels: priority:high, area:workspace
milestone: P3.2 Projects
---
**Phase:** P3 · **Roadmap status:** prototyped (v98, v99, v100) · **Size:** M (guess) · **Blocked by:** {{PROJ-01}}

## Goal
The work of a project is visible as cards in columns. The owner moves a card with one drag and sees what is late.

## Proposed change
- A kanban inside a project with seven columns: Ideas, Notes, Backlog, Todo, In progress, Review, Completed.
- Add a card by typing in a column. Move a card by drag, or with arrow buttons for keyboard use.
- A card popup with: due date, labels, checklist, links, images and a history of changes.
- A progress line on the project that is counted from the cards.
- A card past its due date and not Completed shows "Late by N days".

## Acceptance criteria
- [ ] A card moved to another column stays there after restart.
- [ ] The order of cards inside a column is kept after restart.
- [ ] The progress line matches the cards. A test checks the count.
- [ ] A late card shows "Late by N days" with the right N.
- [ ] Each change to a card adds one line to its history.
- [ ] Drag works on Mac and on Ubuntu. This was the screen used in {{SPIKE-01}}.

## Out of scope
- Custom columns.
- A board across several projects.
- Card tools for the Mnemo MCP server (CON-05).

## Evidence and links
- Roadmap, PROJ-02: {{ROADMAP}}
- Prototype, kanban and card detail (v98, v99, v100): {{PROTO}}

=== ISSUE DAY-02
title: [DAY-02] Tasks and Next actions
type: Feature
labels: priority:high, area:workspace
milestone: P3.3 Today, tasks and calendar
---
**Phase:** P3 · **Roadmap status:** prototyped (v109) · **Size:** S (guess) · **Blocked by:** {{DATA-01b}}

## Goal
A short list of what to do next. Only the owner decides what becomes a task.

## Proposed change
- A task has a title, an optional due date and an optional link to another item.
- A Next actions list: open tasks at the top, each with Done and Remove.
- Done moves the task to history. Remove deletes it (soft delete).
- A suggestion from the app is shown apart from tasks, with an "Add task" button. It becomes a task only when the owner presses it.
- The list is a part that the Today page ({{DAY-01}}) shows.

## Acceptance criteria
- [ ] A task marked Done leaves the list and is kept in history.
- [ ] No suggestion becomes a task by itself. A test adds a suggestion and checks that the task count is unchanged.
- [ ] Remove takes the task out of the list and out of history views.
- [ ] Tasks are kept after restart.

## Out of scope
- Where suggestions come from. In version 1 they come from {{CON-03}}. Until then the suggestion area is empty.
- Repeating tasks and reminders.
- Tasks made from kanban cards.

## Evidence and links
- Roadmap, DAY-02: {{ROADMAP}}
- Prototype, Next actions (v109): {{PROTO}}

=== ISSUE DAY-03
title: [DAY-03] Calendar inside Mnemo
type: Feature
labels: priority:high, area:workspace
milestone: P3.3 Today, tasks and calendar
---
**Phase:** P3 · **Roadmap status:** prototyped (v23, v56, v57, v74) · **Size:** M (guess) · **Blocked by:** {{DATA-01b}}, {{APP-02}}

## Goal
The owner plans personal events and reading time inside Mnemo, with no outside calendar needed.

## Proposed change
- A month view and a day panel for the selected day.
- Personal events: title, date, start and end time, note. Add, edit and delete.
- Read or watch slots: an event that links to a saved item. Opening the slot opens the item.
- "Find a free slot": plain code looks for free time on a day between the owner's events. Claude is not used.
- All times are stored with the time zone, so the two machines show the same event.

## Acceptance criteria
- [ ] An event added on a day shows on that day in the month view and in the day panel.
- [ ] A reading slot opens its saved item.
- [ ] "Find a free slot" never returns a time that overlaps an event. A test covers a full day and an empty day.
- [ ] An event on the last day of a month and on 29 February shows on the right day.
- [ ] Events are kept after restart, on Mac and on Ubuntu.

## Out of scope
- Google Calendar. Reading it is part of P4 ({{CON-01}}), and Mnemo never writes to it in version 1.
- Repeating events.
- Reminders and notifications.

## Evidence and links
- Roadmap, DAY-03: {{ROADMAP}}
- Prototype, Calendar (v23, v56, v57, v74): {{PROTO}}

=== ISSUE DAY-04
title: [DAY-04] Goals
type: Feature
labels: priority:medium, area:workspace
milestone: P3.3 Today, tasks and calendar
---
**Phase:** P3 · **Roadmap status:** prototyped (v74) · **Size:** S (guess) · **Blocked by:** {{DATA-01b}}, {{LIB-01}}

## Goal
Up to three goals keep the owner focused. Progress is counted from what was really saved, not typed by hand.

## Proposed change
- A goal has a name, one tag and a target date.
- At most 3 active goals.
- Progress is the count of saved items with that tag. Plain code counts it.
- Goals can be edited, finished and deleted.

## Acceptance criteria
- [ ] A fourth goal is refused with a plain message.
- [ ] The count equals the number of matching items. A test adds and removes items and checks the number.
- [ ] A deleted item is not counted.
- [ ] Finishing a goal frees a place for a new one.

## Out of scope
- AI advice on goals.
- Goals without a tag.

## Evidence and links
- Roadmap, DAY-04: {{ROADMAP}}
- Prototype, Goals (v74): {{PROTO}}
- Unverified: whether a goal has a target number of items or only a date. Read it from the prototype.

=== ISSUE DAY-01
title: [DAY-01] Today page (without connectors)
type: Feature
labels: priority:high, area:workspace
milestone: P3.3 Today, tasks and calendar
---
**Phase:** P3 · **Roadmap status:** prototyped (v104, v105, v109, v110) · **Size:** M (guess) · **Blocked by:** {{BM-01}}, {{NOTE-01}}, {{PROJ-01}}, {{DAY-02}}, {{DAY-03}}, {{ASK-01}}

## Goal
The first screen of the day. One box to capture anything, and the few things that need the owner now.

## Proposed change
- One capture box. Plain code decides: a link is saved ({{BM-01}}), a question opens Ask Mnemo ({{ASK-01}}).
- Next actions: the list from {{DAY-02}}.
- "Pick up where you left off": the items the owner changed last (a note, a project, a bookmark), each with a button that opens it.
- Upcoming: the next events from {{DAY-03}}.
- Not read yet: saved links the owner has not opened.
- The Slack and Gmail part is an empty area with the text "Connectors come in Phase 4". No sample data.

## Acceptance criteria
- [ ] Each "Pick up" button opens the right item.
- [ ] A link typed in the box is saved. A question opens Ask Mnemo with that question.
- [ ] An event for today shows under Upcoming.
- [ ] A bookmark leaves "Not read yet" after the owner opens it.
- [ ] With an empty database, each part shows a helpful empty state and no sample data.
- [ ] The page opens in under 1 second with 1,000 items. Write the measured time in the pull request.

## Out of scope
- "Your day in one look" with Slack and Gmail ({{CON-03}}).
- The daily digest (DIG-01).
- Data from the owner's other apps (LATER-06).

## Evidence and links
- Roadmap, DAY-01: {{ROADMAP}}
- Prototype, Today (v104, v105, v109, v110): {{PROTO}}
- The 1 second target is a guess by the author of this ticket. The owner set no number.
