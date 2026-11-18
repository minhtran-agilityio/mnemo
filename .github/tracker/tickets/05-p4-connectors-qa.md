=== ISSUE CON-01
title: [CON-01] Connectors from Claude Code: Slack, Gmail, Google Calendar, GitHub
type: Feature
labels: priority:high, area:connectors
milestone: P4 Connectors and reports
---
**Phase:** P4 · **Roadmap status:** prototyped (v61 to v64, v82 to v84, v103) · **Size:** M (guess) · **Blocked by:** {{AI-01c}}, {{SPIKE-02}}, {{APP-03b}}

## Goal
Mnemo reads the owner's Slack, Gmail and Calendar through the connectors that Claude Code already has. No token is typed into Mnemo, and nothing is read until the owner switches a connector on.

## Proposed change
- An "Apps and account" screen that lists Slack, Gmail, Google Calendar and GitHub.
- Each row shows "Found in Claude Code" or "Not found", a switch (off by default) and "Check again".
- A button "Take from Claude Code" copies the connector list from Claude Code into Mnemo's own list in `~/.config/mnemo/`. The owner picks which ones to keep. After that the two lists are independent.
- A run gets a connector's tools only when its switch is on, and only the read tools of that connector.
- A "Test" action per connector does one small read-only call and shows the result or the error.
- No token boxes anywhere.

## Acceptance criteria
- [ ] A connector present in Claude Code shows as found.
- [ ] A connector switched off is never called. A test checks the tool list that is passed to the run.
- [ ] With every switch off, no run gets any connector tool.
- [ ] Only read tools are passed. A write tool of a connector (send a message, create an event) is never in the allowed list in version 1.
- [ ] The Slack test works on the owner's Mac and on Ubuntu. Gmail and Calendar are tested and the result is written down.
- [ ] Mnemo's config files hold no token.

## Out of scope
- Writing to any outside service. The only exception in version 1 is the daily report to the owner ({{CON-04b}}).
- MCP settings per feature (CON-02) and Mnemo as an MCP server (CON-05). Both are P5.
- Telegram, Zalo and email capture (LAST-02).

## Evidence and links
- Roadmap, CON-01 and DEC-05 (read-only, the owner switches on each connector): {{ROADMAP}}
- Architecture, "Cấu hình riêng của Mnemo" (the "Lấy từ Claude Code" button): {{ARCH}}
- Prototype, Apps and account (v61 to v64, v82 to v84, v103): {{PROTO}}
- Unverified: connectors of the claude.ai account work under `--strict-mcp-config`, and Gmail and Calendar work in `claude -p` at all. See the result of {{SPIKE-02}}. If they do not work, stop and ask the owner before you build this ticket.
- The owner's own task, not part of this ticket: check the company AI policy before work Slack goes through Claude.

=== ISSUE CON-03
title: [CON-03] Today: Slack and Gmail summary
type: Feature
labels: priority:high, area:connectors
milestone: P4 Connectors and reports
---
**Phase:** P4 · **Roadmap status:** prototyped (v104, v107, v108) · **Size:** M (guess) · **Blocked by:** {{CON-01}}, {{DAY-01}}, {{AI-01e}}

## Goal
"Your day in one look": the owner sees what happened in Slack and Gmail and what needs them, without opening either app.

## Proposed change
- A panel on Today with a summary per chosen Slack channel and one Gmail summary. Read-only.
- The owner picks the channels. Nothing is read from a channel that is not picked.
- A "Refresh" button starts the run. It also runs once when the owner first opens Today on a day. It is an owner action in the queue.
- The run uses `run_task` with a JSON schema: per channel a summary, decisions, and items that need the owner.
- Items that need the owner appear as suggestions under Next actions ({{DAY-02}}). They become tasks only when the owner presses "Add task".
- The panel shows when it was last refreshed.

## Acceptance criteria
- [ ] The run uses read tools only. A test checks the allowed tools.
- [ ] A channel with no decision says "None". Nothing is invented.
- [ ] With a connector off, the panel shows "Open connectors" and no sample data.
- [ ] Next actions takes only work that needs the owner, as suggestions, never as tasks by itself.
- [ ] A failed run keeps the last good summary, marks it with its time, and shows the error.
- [ ] With AI off or paused, the panel says why and Refresh is disabled.

## Out of scope
- Replying, reacting or marking as read in Slack or Gmail.
- A schedule for the summary. Schedules beyond the daily report are P5 (AGT-01).
- Storing the full message text. Store only the summary and links.

## Evidence and links
- Roadmap, CON-03: {{ROADMAP}}
- Prototype, "Your day in one look" (v104, v107, v108): {{PROTO}}
- Open point for the owner: how many days of Slack and Gmail one refresh reads. Proposed: since the last refresh, at most 24 hours. This is a proposal, not a decision.

=== ISSUE CON-04a
title: [CON-04] Timer in the core with catch-up at start
type: Feature
labels: priority:high, area:connectors
milestone: P4 Connectors and reports
---
**Phase:** P4 · **Roadmap status:** not started · **Size:** S (guess) · **Blocked by:** {{AI-01e}}, {{DATA-01b}}, {{APP-01}}

## Goal
One job can run at a set time while Mnemo is open or in the tray. A job that was missed runs when Mnemo starts again. Version 1 has one such job: the daily report.

## Proposed change
- A small timer in the `scheduler` module of the core. A job has a name, a time of day, an on/off switch and its last run time, all stored in the database.
- While the app runs (window open or in the tray), the timer starts the job at its time through the run queue, as background work.
- At start, the core compares the last run time with the schedule. If a run was missed, it runs once. It never runs more than once for the days that were missed.
- The timer follows the usage pause from {{AI-02}}: a paused job waits and says why.
- No system service (launchd, systemd) is installed.

## Acceptance criteria
- [ ] A job set to a time 2 minutes ahead runs at that time with the window closed and the app in the tray.
- [ ] If the app was not running at the set time, the job runs once at the next start.
- [ ] If the app was off for 3 days, the job runs once, not 3 times.
- [ ] A job that is switched off never runs.
- [ ] Tests use a fake clock. No test waits for real time.
- [ ] A change of the computer clock or time zone does not make the job run twice on one day.

## Out of scope
- The Background runs screen, many jobs, retry and the daily limit (AGT-01, P5). Build the table so AGT-01 can reuse it.
- Running after Quit (LATER-07).
- Waking the computer from sleep.

## Evidence and links
- Roadmap, DEC-08 and CON-04: {{ROADMAP}}
- Architecture, "Job nền ở version 1": {{ARCH}}

=== ISSUE CON-04b
title: [CON-04] Daily report to the owner in Slack, Gmail or in the app
type: Feature
labels: priority:high, area:connectors
milestone: P4 Connectors and reports
---
**Phase:** P4 · **Roadmap status:** prototyped (v74, v102, v103) · **Size:** M (guess) · **Blocked by:** {{CON-04a}}, {{CON-01}}

## Goal
Once a day the owner gets a short report of the day: summary, key points, next work and numbers. It goes only to the owner.

## Proposed change
- A report built from Mnemo data: what was saved, notes and projects changed, tasks done and open, events of tomorrow. Plain code writes every number. Claude writes only the words.
- A Reports section in Settings: on/off, the time, and the channel: in the app, the owner's own Slack DM, or the owner's own Gmail address.
- "Send to me" is the only mode in version 1. The target is fixed to the owner's own account. There is no field to type another person or channel.
- The send is the one outside write in version 1. It uses one write tool, only inside this task, and only with the fixed target. Code checks the target before the run.
- "Send a test now" button.
- Each report is also kept in the app, so a failed send loses nothing.
- If Mnemo was not running at the set time, the report is sent at the next start ({{CON-04a}}).

## Acceptance criteria
- [ ] A test send reaches the owner's own Slack DM or own address.
- [ ] The report goes only to the owner, never to another person or channel. A test with the fake runner tries another target and the run is refused.
- [ ] A missed day is sent when Mnemo starts again, once.
- [ ] Every number in the report equals the count from code.
- [ ] With the Slack or Gmail connector off, the report is kept in the app and the screen says why it was not sent.
- [ ] With AI off, the report is still built with numbers only, or skipped with a clear note. The owner picks one in the pull request.

## Out of scope
- "Draft, I send" mode. It comes with Needs approval (AGT-02, P5).
- Reports to other people or channels.
- The morning brief as a second scheduled job, unless the owner asks for it in this ticket. The roadmap title names it, but the architecture says version 1 has one scheduled job.
- Weekly reports and digests (DIG-01, DIG-02).

## Evidence and links
- Roadmap, CON-04: {{ROADMAP}}
- Architecture, "Job nền ở version 1" (one scheduled job: the daily report, sent to the owner): {{ARCH}}
- Prototype, daily report (v74, v102, v103): {{PROTO}}
- Unverified: how the Slack and Gmail connectors send to "myself", and whether a write tool can be limited to one target. Test it first. If it cannot be limited safely, ship "in the app" only and ask the owner.

=== ISSUE QA-P1
title: [QA-P1] Phase 1 exit check on Mac and Ubuntu
type: Task
labels: priority:high, area:app, user-test
milestone: V1 exit checks
---
**Phase:** P1 · **Who:** the owner, by hand · **Blocked by:** {{SETUP-06}}, {{APP-02}}, {{APP-03b}}, {{DATA-01c}}, {{DATA-02}}, {{AI-01c}}, {{AI-02}}, {{AI-03}}

## Goal
Confirm that the foundation is solid on both machines before any feature is built on it. Phase 2 and Phase 3 start only after this passes.

## Proposed change
No code. The owner installs the release build on the Mac and on Ubuntu 22.04 and walks through the list below. Each failure becomes a new Bug issue that is linked here.

## Acceptance criteria
Do each line on **both** machines.
- [ ] The app installs from the release bundle and opens with the network off.
- [ ] Closing the window keeps Mnemo in the tray. Quit stops it.
- [ ] Every sidebar item opens a screen or an empty state.
- [ ] A theme change applies at once and is kept after restart.
- [ ] A test prompt answers through `claude -p` (the test button in Settings).
- [ ] With Claude Code signed out, the app says how to fix it, and the other screens still work.
- [ ] With the AI switch off, no `claude` process starts (check in the system monitor).
- [ ] A record added through the developer test screen is still there after Quit and start.
- [ ] Export writes files to the folder you picked. Reset asks first.
- [ ] CI is green for macOS and Ubuntu on `main`, and the 100 parallel writes test is part of it.
- [ ] {{SPIKE-01}} is closed with a decision, and {{SPIKE-02}} has an answer for each of its questions.
- [ ] RAM and start-up time of the real app are measured again and written here.

## Out of scope
- Any feature of Phase 2 or later.
- Fixing the failures. Each one gets its own issue.

## Evidence and links
- Roadmap, P1 exit check: {{ROADMAP}}
- Architecture, "Quy tắc code và test", rule 3 (done means it passes on both machines): {{ARCH}}

=== ISSUE QA-P2
title: [QA-P2] Phase 2 exit check: one week of real links and the eval baseline
type: Task
labels: priority:high, area:library, user-test
milestone: V1 exit checks
---
**Phase:** P2 · **Who:** the owner, by hand · **Blocked by:** {{QA-P1}}, {{BM-03}}, {{LIB-02}}, {{LIB-03}}, {{BM-04}}, {{ASK-01}}

## Goal
Confirm that saving, finding and asking work with the owner's real links in daily use, not only with test data.

## Proposed change
No code. The owner uses the desktop app as the only place to save links for one week, on both machines. Each problem becomes a new issue that is linked here.

## Acceptance criteria
- [ ] Real links were saved on at least 5 different days. Write the count here.
- [ ] Every link that could not be read is link only, with no made-up summary. Check 3 of them.
- [ ] Saving a link you already have shows "already saved".
- [ ] 5 links you search for by a word you remember are found.
- [ ] Ask Mnemo: your own 15 questions and 3 trick questions pass.
- [ ] The eval has a first baseline score saved in the repo.
- [ ] After the week, the usage share that Mnemo used is written here, so the 60% and 95% lines can be judged.
- [ ] The same checks pass on the Mac and on Ubuntu. The two machines have separate libraries, because version 1 has no sync.

## Out of scope
- Notes, projects and connectors.

## Evidence and links
- Roadmap, P2 exit check: {{ROADMAP}}

=== ISSUE QA-P3
title: [QA-P3] Phase 3 exit check: run one real project from idea to done
type: Task
labels: priority:high, area:workspace, user-test
milestone: V1 exit checks
---
**Phase:** P3 · **Who:** the owner, by hand · **Blocked by:** {{QA-P1}}, {{NOTE-02}}, {{PROJ-02}}, {{DAY-01}}, {{DAY-04}}

## Goal
Confirm that the personal workspace is good enough to run real work in it, with no outside tool.

## Proposed change
No code. The owner picks one real project and runs it inside Mnemo from the first idea to done. Each problem becomes a new issue that is linked here.

## Acceptance criteria
- [ ] One idea was written, moved through its stages and turned into a project.
- [ ] The project has text, image and link blocks, and a kanban with cards that moved to Completed.
- [ ] At least 3 notes with nested labels were written. One was turned into an idea with the AI action.
- [ ] Tasks were added and marked Done from Today.
- [ ] An event and a reading slot were added and showed on Today on the right day.
- [ ] A search finds a bookmark and a note that share a word (only if Phase 2 is done).
- [ ] Everything is still there after Quit and start, on the Mac and on Ubuntu.
- [ ] With the AI switch off, all of the above still works, except the AI buttons.

## Out of scope
- Slack, Gmail and reports.

## Evidence and links
- Roadmap, P3 exit check: {{ROADMAP}}

=== ISSUE QA-P4
title: [QA-P4] Phase 4 and version 1 exit check: real Slack and Gmail summary, daily report
type: Task
labels: priority:high, area:connectors, user-test
milestone: V1 exit checks
---
**Phase:** P4 · **Who:** the owner, by hand · **Blocked by:** {{QA-P2}}, {{QA-P3}}, {{CON-03}}, {{CON-04b}}

## Goal
Confirm that connectors and reports work with the owner's real accounts and that nothing is sent to anyone else. When this passes, version 1 is done.

## Proposed change
No code. The owner switches on the connectors and uses Today and the daily report for one week. Each problem becomes a new issue that is linked here.

## Acceptance criteria
- [ ] Before the first run with work Slack: the company AI policy was checked by the owner. Write "checked" and the date here.
- [ ] Today shows a real Slack summary and a real Gmail summary.
- [ ] A channel with no decision says "None".
- [ ] A daily report reached the owner in Slack or Gmail on 3 different days.
- [ ] Mnemo was closed at the report time on one day, and the report arrived at the next start, once.
- [ ] Nothing was sent to another person or channel. Check the Slack and Gmail sent items.
- [ ] With a connector switched off, nothing is read from it.
- [ ] The usage share that Mnemo used in the week is written here.
- [ ] All of this passes on the Mac and on Ubuntu.

## Out of scope
- Anything in Phase 5 or later.

## Evidence and links
- Roadmap, P4 exit check and "Version 1 ends here": {{ROADMAP}}
- Roadmap, DEC-05 (the company policy check is the owner's task): {{ROADMAP}}
