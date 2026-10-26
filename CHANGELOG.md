# Changelog

## 0.3.0 – 2026-10-26

What needs attention on all hosts in a tab of its own, the coverage of every host from the
add-ons' checks and its target profile, and the areas the suite does not cover yet.

- **Needs attention:** a second tab, opened first. It lists what to do next over all hosts: open
  findings, items that no finding explains, gaps in the coverage and hosts that cannot be read.
  They are ordered by state, then hosts not read, then how far a finding is reachable (internet
  first), known exploitation and age. Each task names its host and add-on, the reasons
  ("reachable from the internet", "fix available", "summary only"), what the add-on says, since
  when, the evidence ("Checked 20:50, complete") and what resolves it, and its button opens the
  add-on on its host at the finding's link. "new" marks a finding first seen less than 24 hours
  ago. Accepted findings and checks that do not apply are folded below. The tab is part of the
  page's address (`#/tasks`, `#/hosts`), so Back, a reload and a jump from an add-on select it.
- **Coverage:** above both tabs, "6 of 9 expected add-ons checked" with each kind of gap counted
  and the hosts that could not be read; below each host's name the same for that host
  ("Cron Jobs: no access · Image Update Monitor: out of date"). Where an add-on sends checks, the
  worst check that applies decides ("Security Monitor: Container hardening partly checked");
  otherwise the coverage comes from the tile as before.
- **No access and nothing rated are warnings:** exit 77 is "No access" with the reason, and an
  answer that rates nothing is "Not checked" instead of "Unknown". Both stay visible with "Only
  what needs attention", so a reduced view no longer looks clean while checks are missing.
- **Target profiles:** the board reads each host's target profile from Host Settings on that host
  (only from its own answer): its roles as chips and the add-ons and checks it is expected to
  have. An expected add-on that is not installed is "Missing", one installed without the status
  entry "No status", both a warning and a task. Gaps of add-ons a host is not expected to have
  are softer (a notice, or neutral). A check left out on purpose shows as not applicable, with
  its reason, until its end date. A host without a profile gets one notice, "No target profile".
  Without any profile the board counts as before.
- **Areas not covered yet:** below each host's coverage, a fold names what no add-on checks yet:
  proof of backup and restore across the suite, all known vulnerabilities, the TLS certificate
  lifecycle, configuration drift and identity checks, each with what an installed add-on covers
  in part today (Image Update Monitor's dumps and rollbacks, Update Gaps' CVE data for Ubuntu
  packages, Security Monitor's SSH keys and logins). Planned scope only: never a check, a gap or a
  task.
- **Status contract:** optional parts for version 1, in `docs/STATUS-CONTRACT.md`: `features`
  names what an add-on sends; `checks` says how each check went (`checked`, `partial`, `failed`,
  `unconfigured`, `noaccess`, `unsupported`, `notapplicable`); `items[].findings` lists single
  findings with a stable `fid`, at most 100 per answer; `profile` comes from Host Settings only.
  An item is never better than its open findings, and an acceptance (`accepted_until`) counts for
  at most 90 days after the check. A part that breaks the rules is left out and counted; it never
  makes the answer unreadable.
- **Fix, complete lists:** a list of findings counts as complete only when the add-on says so, a
  `checked` check owns its item, every entry was taken over and its own `total` is not greater
  than the list. `"complete": true, "total": 1, "list": []` was taken as complete, so a finding
  missing from it could count as gone. Host Settings 0.2.0 judges the same answers the same way.
- **Fix, expected add-ons:** every add-on a host's profile expects has a tile, also one installed
  in a version without the status entry that no other host reports. With Host Settings and
  Security Monitor expected and only Host Settings checkable, the host read "1 of 1 expected
  add-ons checked" without a task; now it is "1 of 2", with a warning and a task.
- **Fix, evidence of an item:** an item with findings says "complete" only when its list is
  complete and its check in time, not because of its check alone.
- **Menu:** the entry moves to the end of System, in one block with the other Azentrius add-ons.
  Searching the menu for "azentrius" finds them all, and Cockpit's Help menu links the README.
- **Packages:** the `.rpm` is installed and removed on Rocky Linux and AlmaLinux 9 and 10 in CI
  (the package only; no Cockpit runs there).
- **README:** pictures of both tabs with neutral host names, a walk from the install through the
  target profile, messages and watchdog to a task, the add-on and the check again, and the suite
  at a glance: where each add-on is checked in CI and where its package only installs.
- **Tested together:** Status Board 0.3.0, Host Settings 0.2.0 and Security Monitor 0.4.0, with
  their real packages in the end-to-end test of the suite (workflow `e2e-suite` of Host
  Settings). Target profiles need Host Settings 0.2.0 or newer, single findings and checks of
  exposed ports Security Monitor 0.4.0 or newer.
- **Older add-ons:** the contract stays at schema 1 and the new parts are optional. Add-ons in
  older versions still work as before; their items show as "summary only" in Needs attention.

## 0.2.3 – 2026-10-23

Two fixes from a review: an add-on with an unusual folder name no longer stops the board, and a
status answer is cut off at 64 KiB while it arrives.

- **A package named `constructor`:** an add-on in a folder named after a property every
  JavaScript object has stopped the board while it built the tiles, and Refresh stayed disabled. Now it is a tile like any other, and hosts without it say "Not
  installed" instead of "No status".
- **Answers over 64 KiB:** the board read a status answer whole before it checked the size, so a
  helper that kept writing filled the page's memory until the timeout. Now it reads the answer as
  it arrives and closes the channel as soon as it passes 64 KiB; the tile says "The answer is
  longer than 64 KiB." as before.

## 0.2.2 – 2026-10-22

The entries of a tile line up.

- **A table of entries:** the panel below the row shows the entries as a table with the columns
  Entry, Value, State and Details, one row each, instead of small blocks side by side, where the
  label stood next to the value on one entry and on a line of its own on the next. On a phone each
  row becomes a block with the column names; empty cells are left out.

## 0.2.1 – 2026-10-22

The tiles of a row stay put when a tile's entries open or close.

- **Entries in a panel below the row:** "All 5 entries" opens a panel across the whole row, below
  the row of its card, instead of inside the card. In 0.2.0 the other cards of the row shrank to
  their own height when one opened and grew back when it closed, so their figures, ages and toggles
  jumped. Now only the rows below move down. The card and its panel share the border colour.

## 0.2.0 – 2026-10-21

A tile shows every entry of its add-on, the board can hide what needs no attention, and it says
where an add-on is older than on the other hosts.

- **Every entry of a tile:** "All 5 entries" folds out what the add-on reports, each entry with
  its label in the status language, its value and its detail, out of date since when if it is.
  An entry with a place in the add-on opens it on a click (the Security Monitor's SSH, for
  example), not only the key figure's. Open tiles stay open when the board loads again.
- **Only what needs attention:** a switch in the header leaves out the tiles in OK, Unknown, Not
  installed, No status and No access; a host left without tiles says "Nothing that needs
  attention", its label still says the whole row. The browser keeps the choice.
- **Versions:** each tile names the add-on's version, and says so when another host runs a newer
  one ("Version 0.5.0 runs on other hosts"). The board compares what the hosts send; it does not
  look for releases.

## 0.1.0 – 2026-10-21

The first version: the status of the Azentrius add-ons on every host of the host switcher, on one
page.

- **One row per host, one tile per add-on.** The hosts come from Cockpit's host switcher (the
  bridge's `cockpit.Machines`, merged from `/etc/cockpit/machines.d/*.json`), this host first.
  A tile shows the add-on's state in the status language, its most important figure with its
  title below it, its summary and the age of its data; a click opens the add-on on its host. On
  other hosts only while Cockpit has its host switcher (`AllowMultiHost`): without it the shell
  would open the add-on of this host, so the board leaves those tiles inert and says why, and its
  advice for locked keys and unknown or changed host keys names Cockpit's terminal instead.
- **The status contract, version 1** (docs/STATUS-CONTRACT.md). Add-ons are found by the section
  `azentrius.status` in their manifest: on this host through `cockpit.manifests`, on the others
  through `find /usr/share/cockpit …` and the manifest files. Only commands below
  `/usr/lib/cockpit-` run, always as `COMMAND status --lang en|de`, with `superuser: "try"`.
- **What a host sends is data.** Every answer is checked against the contract; texts are cut,
  control and bidirectional characters removed, and set as text only; links must stay inside the
  add-on's page, and jumps go only to plain package folders. A host names only its own tiles.
- **What cannot be read says so:** not installed (on this host, where others have it), no status
  (a version without the contract), no access (exit 77), status unreadable (with the reason), a
  refused command, unreachable (with Cockpit's reason, a timeout after 20 seconds), a locked SSH
  key, and out-of-date data (`stale_after`) as a warning with since when. A host that cannot be
  read says so next to its name as well.
- **Loads** on opening, on Refresh and every 5 minutes while the page is visible; it asks again
  instead of watching files, as `cockpit.file().watch()` ignores the host option.
- **Never changes anything:** no administrative access, no actions, only jumps into the add-ons.
- English and German; the shared Azentrius design files, light and dark, blocks on a phone.
- Packages: `.deb` and `.rpm` with AppStream data (`de.azentrius.status_board`), and the archive.
