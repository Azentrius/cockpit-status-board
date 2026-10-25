# Internals

How Status Board finds hosts and add-ons, what it asks them, and how it shows the answers. What an
add-on has to send, and what the board accepts from it, is the **status contract** in
[STATUS-CONTRACT.md](STATUS-CONTRACT.md).

The Cockpit code named here is that of Cockpit 360 (Ubuntu 26.04),
`https://github.com/cockpit-project/cockpit/blob/360/<path>`. The board was written against it and
tested against a stand-in for Cockpit (`test/web/mock-cockpit.js`), in CI against a real Cockpit
with SSH to the test machine itself (`test/e2e_cockpit.py`), and by hand on a bastion with real
hosts; see "Tested against real Cockpit" at the end.

## Hosts

**The list is the host switcher's.** The shell reads it from the bridge's internal D-Bus object
`/machines`, interface `cockpit.Machines`, property `Machines` (`a{sa{sv}}`,
`pkg/shell/machines/machines.js`, `Loader`). The bridge merges it from every
`machines.d/*.json` below the first of `$XDG_CONFIG_DIRS` (default `/etc`) that has one
(`src/cockpit/internal_endpoints.py`, `cockpit_Machines`; `src/cockpit/config.py`, `lookup_config`),
so normally from `/etc/cockpit/machines.d/*.json`. The shell itself writes `99-webui.json` there
(`cockpit.Machines.Update`, which needs administrative access on the bastion). There is no single
`machines.json`; the name `v2-machines.json` in `machines.js` is the shell's key in the browser's
session storage.

The board reads the same property through `cockpit.dbus(null, { bus: "internal" })` and a proxy,
as the shell does, and closes the client again. From it the board takes, as the shell does:

| Field | Use |
|---|---|
| key | the host's name in the switcher; the target of jumps |
| `visible` | only visible hosts are listed (a removed host stays on disk with `visible: false`) |
| `address`, `user`, `port` | the connection string `user@address:port`, built like `generate_connection_string()` |
| `label` | the row's name; else the host's own name (`/proc/sys/kernel/hostname`), else the key |

`localhost` (and `localhost.localdomain`) is the bastion itself: always the first row, never
reached over SSH. Keys and addresses must match `^[A-Za-z0-9_][A-Za-z0-9._-]{0,252}$`, users
`^[A-Za-z0-9_][A-Za-z0-9._-]{0,31}$`, ports `^[0-9]{1,5}$`; other entries are left out and named in
an alert. Hosts that the switcher shows only for one session (added without administrative access,
kept in the browser's session storage) are not in the list.

**The connection string matters.** The bridge reuses a connection only for the same host string and
user (`src/cockpit/remote.py`, `HostRoutingRule`); with the switcher's string the board shares the
switcher's connection instead of opening a second one.

## For each host

1. **Connect** (other hosts only). An echo channel, `cockpit.channel({ payload: "echo", host })`,
   is sent `"x"`; the echo means the host is reached. This is what the switcher does
   (`machines.js`, `connect`). If the channel closes first, its close options say why: `problem`
   (`no-host`, `unknown-host`, `unknown-hostkey`, `invalid-hostkey`, `authentication-failed`,
   `no-cockpit`, …), and for a key in the agent that is locked `problem: "authentication-failed"`
   with `error: "locked identity: PATH"` (`remote.py`, `PasswordResponder`; the shell reads the same
   in `pkg/shell/hosts_dialog.jsx`). `cockpit.spawn()` drops the `error` field, which is why the board
   connects with a channel of its own first. No answer within 20 seconds is a timeout.
   The board sends no `init-superuser`: a connection it opens has no administrative access, as the
   switcher's has none after a login with a key (`machines.js`, `get_init_superuser_for_options`).
2. **Find the add-ons.**
   - This host: `cockpit.manifests`, which `../manifests.js` fills with the full manifest of every
     package (`doc/guide/pages/cockpit-manifest.adoc`, `src/cockpit/packages.py`).
   - Other hosts: `cockpit.spawn(["find", "/usr/share/cockpit", "-mindepth", "2", "-maxdepth", "2",
     "-name", "manifest.json"], { host, err: "message" })`, then every path that matches
     `^/usr/share/cockpit/([a-z0-9][a-z0-9-]{0,40})/manifest\.json$` is read with
     `cockpit.file(path, { host, syntax: JSON }).read()`. At most 200 packages per host count.
   - An add-on takes part when its manifest has the section `azentrius.status` (below).
3. **Ask each add-on**: `cockpit.spawn([COMMAND, "status", "--lang", "en" | "de"], { host,
   superuser: "try", err: "message" })`, at most 20 seconds.
4. **The host's own name**: `cockpit.file("/proc/sys/kernel/hostname", { host }).read()`.

The board loads on opening, on Refresh and every 5 minutes while the page is visible (checked every
30 seconds; when the page comes back after 5 minutes or more, at once). It does not use
`cockpit.file().watch()`: that ignores the host option and watches the file on the bastion
(`pkg/lib/cockpit.js`, `cockpit.file`, `ensure_watch_channel`). While a host is loading again, its
row keeps what it showed before.

### Every call the page makes

| Call | Where | Options |
|---|---|---|
| D-Bus `cockpit.Machines` `/machines`, property `Machines` | bastion, internal bus | none |
| echo channel, data `"x"` | other hosts | `host` |
| `find /usr/share/cockpit -mindepth 2 -maxdepth 2 -name manifest.json` | other hosts | `host`, `err: "message"` |
| read `/usr/share/cockpit/PKG/manifest.json` | other hosts | `host`, `syntax: JSON` |
| read `/proc/sys/kernel/hostname` | every host | `host` |
| `COMMAND status --lang xx` | every host with the add-on | `host`, `superuser: "try"`, `err: "message"`; read as a stream, the channel closed at once past 64 KiB |
| `cockpit.jump("/PKG" + link, host)`, `cockpit.jump("/system", host)` | the shell | (navigation) |
| `cockpit.location` (read), `cockpit.location.go(["tasks" \| "hosts"])`, the event `locationchanged` | the page's own location | the tab |
| the meta tag `allow-multihost` in the shell's document (`window.parent`) | the browser | read once at the start |
| `localStorage` `status-board:only-notable` (`"1"` or `"0"`) | the browser | the switch "Only what needs attention" |

Nothing else: no shell scripts, no `superuser: "require"`, no writes on any host. `test/page.test.js` and
`test/ui_test.py` check this list.

**Jumps to other hosts need the host switcher.** cockpit-ws writes `AllowMultiHost` into the shell's
document as `<meta name="allow-multihost" content="yes|no">` (`src/ws/cockpitchannelresponse.c`),
and the shell turns on its host switcher only for `yes` (`pkg/shell/state.tsx`, `init_config`).
Without it the shell turns every location with another host into `localhost` and keeps path and
fragment (`state.tsx`, `update`): a jump to `/update-gaps#/held` on another host would open the
add-on of this host. The board reads the same meta tag; without `yes` the tiles of other hosts are
no buttons, an alert says why, and the texts that would send the user to the host switcher name
Cockpit's terminal instead: `ssh-add` or a new login for a locked key, `ssh HOST` for an unknown
host key, `ssh-keygen -R` for a changed one. That works because the bridge runs `ssh` with
`StrictHostKeyChecking=yes` and OpenSSH's own files (`~/.ssh/known_hosts`,
`/etc/ssh/ssh_known_hosts`; `src/cockpit/remote.py`, `SshPeer`), and the host switcher writes an
accepted key into `~/.ssh/known_hosts` too (`pkg/lib/ssh-add-key.sh`). A page without a shell
around it, or one that cannot read the shell's document, keeps the jumps
(`data-multihost="unknown"` on `#board`, which the tests read).

## Two tabs

The page has two tabs of the shared design files (`az-tabs`): **Needs attention** (`#tasks`),
the tasks over all hosts, and **Hosts and coverage** (`#board`), the rows and tiles below. The
coverage (`#coverage`) stands above both, whatever the tab and the switch. The tab is part of the
page's location, as Cockpit's own pages keep theirs: `#/tasks` or `#/hosts` through
`cockpit.location`; an empty or unknown location is Needs attention. A click on a tab, or the arrow
keys, Home and End on the tabs, set it with `cockpit.location.go()`; the page follows the event
`locationchanged`, so Back, Forward and a jump such as `cockpit.jump("/status-board#/hosts")` select
the tab. The shell keeps the frame's location in its own address. Only the selected tab has
content (a hidden button would still be a control), and the switch "Only what needs attention"
shows only on the hosts tab.

## Needs attention

`buildTasks()` in `lib/status.js` makes the list from the rows of `buildBoard()`, without the DOM
(the unit tests check it against the fixtures). A task is one of:

| Kind | From | State |
|---|---|---|
| finding | an open finding of `item.findings`: not accepted, or its `accepted_until` has passed | the finding's, from Notice up |
| item | an item from Notice up that no finding shows (the add-on sends no findings, or none of its findings is open or accepted); marked "summary only" when the add-on sends no optional part at all | the item's own |
| coverage | a gap in the coverage of an add-on of a host that could be read (below), an expected add-on that is missing included | Warning for an add-on the host is expected to have; for one it is not expected to have as the table "Coverage" below says (Notice, Warning, or no task) |
| profile | a host that could be read and sends no target profile, while the board has tiles | Notice |
| host | a host that cannot be read: Unreachable, Key locked, Add-ons unreadable | its tile's |

An item's state is its own: data out of date is a gap of its add-on's coverage, one task, not a
task for each item. A single item in state `none` is no task. Accepted findings are no tasks; they
are listed in a folded section **Accepted** (finding, host, add-on, until, soonest end first), and
the checks in state `notapplicable` in a folded section **Not applicable** (check, host, add-on,
reason, set by: the add-on itself, or the host's target profile with the day its skip ends).
Accepted is never resolved: the finding comes back as a task on the day its acceptance ends. A
fold shows only when it has something; open folds stay open when the board loads again.

**Order**, without a score: the state (Problem, Warning, Notice); then a host that cannot be read,
because it hides everything else on it; then exposure (`internet`, `restricted`, `internal`,
`local`, unknown); then `exploited: known`; then older `since` first, without `since` last; then the
host (in the board's order), the add-on (in the board's order of tiles) and the title. Each step
decides only where all steps before it are equal. A finding whose `since` lies less than a day back
is marked "new"; that is a mark, not a step of the order.

**Each task** shows its state's label, its title (the finding's; the item's with its value; the gap
as in the host's coverage line, "Update Gaps is missing" for an expected add-on that is not
installed; the host's problem; "No target profile"), the host and the add-on (for a finding also
its item), its reasons as neutral chips ("reachable from the internet", "reachable from some
addresses", "known to be exploited", "fix available", "summary only", "findings unknown", and for a
gap of a host with a target profile "expected for role web" or "not expected here"), what the
add-on or the page says about it, and three facts: since when, the evidence ("Checked 20:50,
complete": the time of the check that owns the item, else the item's, else the answer's; complete
or partial only where a check owns the item, from `findings.complete` for a finding), and what
resolves it. Its button opens the add-on on its host through `jumpTo()`, with the same checks as a
tile: at the finding's link, else its item's; at the item's link; at the gap check's link, else the
link of its item; for a gap without checks at the key item's link; for a host its Overview; for
"No target profile" the start of the host's Host Settings, where it is installed. A missing add-on
has nothing to open. Without the host switcher the tasks of other hosts have no button, as their
tiles are no buttons.

Nothing to do says so ("Nothing needs attention", and that OK means the add-ons found nothing in
what they check, not that the hosts are safe); while hosts are still loading the tab says that
instead.

## Tiles

How a valid answer becomes a tile (its state, out of date, the key figure) is part of the
[status contract](STATUS-CONTRACT.md). Every case at a glance:

| Case | Label | Click |
|---|---|---|
| a valid answer | the state's word (OK, Notice, Warning, Problem) or Out of date | the add-on, at the key item's link |
| a valid answer that rates nothing (state `none`, every item `none` or no item) | Not checked (`warning`) | the add-on, at the key item's link |
| exit 77, or access denied | No access (`warning`) | the add-on |
| invalid answer, exit 64, other exit codes, missing command, timeout, unreadable manifest | Status unreadable (`warning`), with the reason | the add-on |
| a status command outside `/usr/lib/cockpit-` | Command refused (`warning`) | the add-on |
| installed in a version without `azentrius.status` | No status (`none`; `warning` where the host's target profile expects the add-on) | the add-on |
| not installed here, but on another host | Not installed (`none`) | nothing |
| not installed here, and the host's target profile expects it | Missing (`warning`), "Not installed on this host, although its profile expects it." | nothing |
| the host cannot be reached | Unreachable (`danger`), with Cockpit's reason | the host's Overview |
| the SSH key is locked | Key locked (`warning`) | the host's Overview |
| `find` failed | Add-ons unreadable (`warning`) | nothing |

An add-on the host's target profile does not expect keeps these labels, except that No access and
Not checked are not rated there (`none`): they are no gap of what the host should have. An expected
add-on that no host reports gets a Missing tile in that host's row only, named by its package.

The tiles of a row are sorted by name, the same on every host, so the columns line up. A tile is
named by the label its own host sends (else its manifest's menu label); the name used for sorting
and for "Not installed" comes from the first host that has one, this host first. One host cannot
rename another host's tiles. The row's header carries the most severe state of its add-on tiles as
a strong label; a row that could not be read carries its one tile's label instead (Unreachable,
Key locked, Add-ons unreadable). The key figure stands on its own, its title below it as a caption:
add-ons send titles such as "New versions" whatever the value, so "1" over "New versions" reads
right where "1 New versions" would not. Without the host switcher only this host's tiles open
something (see "Every call the page makes").

**Entries.** A tile of a valid answer with more than one item opens all of them in a panel, in the
add-on's order: title, value, the item's own label (its state at that time; out of date makes it at
least a warning, labelled Out of date when the age alone made it one), detail, and since when it is
out of date where that differs from the tile's own time. An item with a `link` is a button that
opens the add-on at that place, with the same checks and the same rule for other hosts as a click
on the tile. The panel spans the whole row of the grid and goes below the row of its card
(`grid-auto-flow: row dense`; the cards after it in the source still fill that row first), so the
cards keep their size and nothing in the row moves when it opens or closes; only the rows below
move down. In version 0.2.0 the entries opened inside the card, and the other cards of the row
jumped to a new height. The card and its panel share the border colour. In the panel the entries are
a table of the shared design files (`az-table az-table--stack`) with the columns Entry, Value, State
and Details, one row per entry, so names, values and labels line up; on a phone each row stacks into
a block with the column names, and empty cells are left out. (0.2.1 set them as small blocks side by
side, where the label wrapped to its own line or not depending on the length of title and value.)
The panel exists only while
it is open (a hidden button would still be a control on a phone), and open tiles stay open when the
board loads again (`state.open`, by `data-key`; not kept across page loads).

**Only what needs attention** (`notable()` in `lib/status.js`, on the tab Hosts and coverage): the
switch leaves out tiles whose state is below Notice (OK, Unknown, Not installed, No status, and the
unrated tiles of add-ons a host is not expected to have), and keeps tiles that are still loading
and expected add-ons that are missing. A row's label still says the whole row; a row left without tiles says "Nothing that needs
attention". The browser keeps the switch in `localStorage`; without storage it starts off. Up to
0.2.3 No access was left out too, and an answer that rated nothing showed as Unknown: with the
switch on, an add-on the board knew nothing about disappeared.

**Expectation** (`expectationOf()` in `lib/status.js`, used by `buildBoard()`): what a host is
expected to have comes from its target profile, which only its own Host Settings sends
(`profile` in its status answer, read only from `addon: "host-settings"`; see the contract). The
profile applies to that host's row only; another host's profile, or a `profile` field in another
add-on's answer, changes nothing there.

- **With a profile** the expected add-ons are the add-ons in `expect`, and the add-on of every
  check in it (`security/exposure` expects `security`); every check of an expected add-on counts.
  A skip (`update-gaps/cve`) that has no `until`, or whose `until` lies ahead at the board's clock,
  makes that check `notapplicable` in that row, with the skip's reason (`byProfile`, `until` on the
  check; the tile's `status` is then a copy, the add-on's answer stays as it is). On the day of its
  `until` the check counts again. A check the add-on itself reports as `notapplicable` keeps its
  own reason; a skip that names an add-on alone leaves out nothing. An expected add-on that no
  host reports gets a Missing tile in that row only; one installed there without a status entry
  while no host reports one (the board itself, for the role `bastion`) is not judged.
- **Without a profile** every installed add-on with a status entry is expected, and none other:
  as the board counted before it read profiles. The row's `noProfile` is true for a host that
  could be read while the board has tiles; its line and one Notice task say "No target profile"
  (never a warning). Host Settings in a version without the profile, or with an answer the board
  cannot use, counts as no profile.

**Coverage** (`coverageOf()`, `gapRating()` and `coverageSummary()` in `lib/status.js`): every
tile of an installed add-on with a status entry has a coverage, and so has an expected add-on that
is missing or installed in a version without the status entry. An answer without `checks` is
checked when it is valid, in time and rates something; otherwise its coverage is `unchecked`
(rates nothing), `stale`, `noaccess` or `unreadable` (Status unreadable, Command refused). An answer
with `checks` takes the worst of its checks that apply (`checksCoverage()`; `notapplicable`, the
profile's skips included, does not count), from better to worse `checked`, `partial`, `stale` (a
`checked` or `partial` check past its `checked_at + stale_after`), `unsupported`, `failed`,
`unconfigured`, `noaccess`; the tile keeps that check as `gapCheck` and every check with a gap as
`gapChecks`. When no check applies, the items decide as without checks. How a gap counts
(`tile.gap`) depends on whether the host is expected to have the add-on:

| Coverage | expected | not expected |
|---|---|---|
| `checked` | no gap | no gap |
| `partial`, `stale`, `failed` | Warning | Notice |
| `unconfigured`, `noaccess`, `unsupported`, `unchecked` | Warning | not rated |
| `unreadable` | Warning | Warning |
| `missing` (not installed) | Warning | none: a neutral Not installed tile |
| `unsupported` from No status (a version without the status entry) | Warning | none: a neutral No status tile |
| `notapplicable` (from the add-on, or the profile's skip) | does not count | does not count |

With checks, a gap of an add-on that is not expected counts as its most severe check: a partial
check is a notice even where another check has no access. A gap that counts is a task in that
state; an unrated one is none. Above both tabs (`#coverage`, outside the switch) the board says how
many of the expected add-ons are checked ("6 of 9 expected add-ons checked"), each gap of an
expected add-on with its count as a warning, how many hosts could not be read at all
(Unreachable, Key locked, Add-ons unreadable; with the worst of their labels), and as a notice how
many hosts send no target profile; "Complete" when no expected add-on has a gap and every host
could be read once loading is done. Add-ons a host is not expected to have count in none of these
figures. Below each host's name a line says the same for that host and names the expected add-ons
with a gap, and the check where a check shows it ("Security Monitor: Container hardening partly
checked"), then the profile's roles as neutral chips ("Role web") or the notice "No target
profile". A single item in state `none` is no gap: Cron Jobs uses it for jobs without recording and
Image Update Monitor for no pending roll-out, so version 1 of the contract cannot tell "nothing to
rate" from "could not check"; only a check in state `partial` says that.

**Checks, findings, profile** (the optional parts of the contract): `validateStatus()` reads them
when `features` names them (`validateExtension()`): `status.features`, `status.checks`,
`item.findings`, `status.profile` (only from Host Settings), and `status.extDropped` for what it
left out. Every list is bounded (50 checks, 100 findings per answer, 10 roles, 100 expectations,
50 skips), ids are kept in `Set`s and `Map`s, never as keys of plain objects, and a list counts as
complete only with a `checked` check naming its item. `evaluate()` takes an item's state from
`itemState()`: never better than its open findings. The coverage uses the checks, the tab Needs
attention the findings, and the expectation the profile (above). `test/fixtures/status/ext-*.json`
are the good, broken, hostile and incompatible answers.

**Versions.** A tile names the add-on's version in its facts. `buildBoard()` compares the versions
of the same add-on on all hosts (`compareVersions()`: three numbers, a suffix such as `~dev…` or
`-rc1` before the release; anything else is not compared) and gives every older tile the newest one
as `newer`, shown as "Version X runs on other hosts". It only compares what the hosts send; it does
not look for releases.

## Why a page of its own

Cockpit's Overview takes no cards from other packages:

- `pkg/systemd/overview.jsx` (L20-24, L160-164) builds five fixed cards.
- Its health card shows page states only for a fixed list, `["system/services", "updates"]`
  (`pkg/systemd/page-status.jsx` L81; on `main` with the comment "Explicit allowlist for now").
- The manifest has no entry for it: `dashboard` names only the menu section "Apps"
  (`doc/guide/pages/packages.adoc`).
- The old `dashboard` package for several hosts was dropped in Cockpit 234 (commit `90d1a633`).

Cockpit is working on a general way (issue #23221; pull request #23314, "notification boards",
open as of 2026-10-19). If it comes, the add-ons can feed it from the same `status.json`; the
contract does not change for that.

The board is a package of its own, not a tab in one of the add-ons: it has no root helper, it
belongs only on the host with the host switcher, and it works with whichever add-ons are installed.

## Tested against real Cockpit

What this file derives from the code of Cockpit 360 is checked in two ways.

**In CI**, the end-to-end test (`test/e2e_cockpit.py`, job `e2e`) runs against Cockpit from the
Ubuntu 24.04 backports, with `AllowMultiHost` on. The other hosts are the test machine itself under
other names, over SSH with a key in an ssh-agent, an encrypted key that is not in the agent, and a
closed port. It checks:

- that `cockpit.spawn()`, `cockpit.file()` and the echo channel with `host` reach the other hosts
  through the bridge, `/proc/sys/kernel/hostname` included;
- that a locked key arrives as `error: "locked identity: …"` in the close options of the echo
  channel;
- that the board, Refresh and the shell share one SSH connection per host (it counts connections
  and logins);
- what the shell does after `cockpit.jump()` to a host it is not connected to (`jump()` opens no
  connection, `pkg/shell/state.tsx`): it asks "Connect to HOST?" once (`pkg/shell/hosts_dialog.jsx`,
  `connect_host`), then connects and opens the page;
- that the board finds the shell's meta tag `allow-multihost`.

### Tested on a bastion

On 2026-10-20, by hand, the README's seven steps ("Trying it on the bastion") ran on a bastion with
Cockpit 360 and three hosts behind it, reached over SSH (Cockpit 360 and 362, Ubuntu 24.04 and
26.04), with the key that `pam_ssh_add` unlocks at login:

1. The rows match the switcher's hosts. The switcher names a host by its address (its entry in
   `machines.d` has no `label`) until it has connected to it, then by the host name from hostnamed
   (`pkg/shell/machines/machines.js`); the board names it by `/proc/sys/kernel/hostname` from the
   start. Both sort by name; the board puts this host first.
2. The board opens one SSH connection per host, and opening the host in the switcher afterwards
   adds none. The bridge keeps a master per host, `ssh -M -N -S SOCKET … -- HOST`, and runs
   `ssh -S SOCKET cockpit-bridge` over it.
3. Clicks open the add-ons on their hosts, at the key item's link.
4. No password prompt; on the other hosts the status verbs run without administrative access.
5. An address that never answers (`192.0.2.10`, in a file in `machines.d`, which the bridge reads
   again at once) turns "Unreachable" with "No answer within 20 seconds" after 20 seconds; the other
   rows are done before.
6. After `ssh-add -D` in Cockpit's terminal, which uses the session's agent, the other hosts show
   "Key locked" with the key file. Unlocking the key in the host switcher (the shell asks for the
   passphrase) brings the host back on Refresh.
7. With `AllowMultiHost = false` the board still reads every host, but a click on another host's
   tile opened the add-on of the bastion: the shell keeps path and fragment and swaps the host for
   `localhost`. Since then the board reads `allow-multihost` and leaves those tiles inert (see
   "Every call the page makes"). Run again the same day with that change: the alert "Without the
   host switcher" stands above the rows, only this host's tiles open their add-on, and the tiles of
   other hosts offer nothing to open. A test host `127.0.0.1` in `machines.d`, whose key is not in
   `known_hosts` under that name, turns "Unreachable" with the text for an unknown host key that
   names `ssh` in Cockpit's terminal.

The host key texts without the host switcher, also on 2026-10-20: a second test host `127.0.0.2`,
with a wrong key for it in the user's `known_hosts`, shows the text for a changed host key (the
bridge reports `invalid-hostkey` for the board's own connections too). Following the texts in
Cockpit's terminal, `ssh 127.0.0.1`, `ssh-keygen -R 127.0.0.2` and `ssh 127.0.0.2`, each with the
key accepted, was all it took: after Refresh both hosts got past the host key to the login (which
the bastion refused there, as its key is not authorized on itself).

Read from the code as well: neither the shell's router (`pkg/shell/router.jsx`, which passes a
frame's channels on unchanged) nor `cockpit-ws` checks the `host` of a channel, and the bridge
always routes it (`src/cockpit/bridge.py`, `HostRoutingRule`). `AllowMultiHost` only decides
whether the shell shows the host switcher and whether `cockpit-ws` serves the pages of other hosts
(`/@HOST/…`, else 403, `src/ws/cockpitchannelresponse.c`). The board connects without the shell's
warning before connecting to a host (`WarnBeforeConnecting`): it loads no page and no JavaScript
from there, only JSON.
