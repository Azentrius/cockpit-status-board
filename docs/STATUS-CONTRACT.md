# The status contract

Version 1. How an Azentrius Cockpit add-on reports its state to Status Board, which shows it as a
tile per host and add-on. This file is the reference for authors of add-ons. Status Board's checks
follow it (`src/lib/status.js`, `validateStatus`), and `test/fixtures/status` holds good, broken and
hostile answers.

Cron Jobs (since 2.8.1), Image Update Monitor (since 0.20.0), Update Gaps and Security Monitor
(both since their first release, 0.1.0) implement it.

## Verb

```
/usr/lib/<package>/<helper> status --lang en|de
```

Read-only, fast (at most 2 seconds), offline, usable without root: the board calls it with
`superuser: "try"`, and on other hosts its session usually has no administrative access (a login
with an SSH key starts without it). What is expensive is prepared by the add-on's own timer, which
writes a world-readable `status.json` (0644, no IP addresses, no user names, no URLs, no paths)
that `status` reads.
Exit codes: 0 with an answer (a finding is no error, `danger` exits 0 too), 64 wrong call, 77
nothing readable without root.

## Finding the add-ons

The add-on's `manifest.json` has a section of its own:

```json
"azentrius": {
    "status": ["/usr/lib/cockpit-image-updates/diun-update.py", "status"]
}
```

The board takes only the first element, and only when it matches
`^/usr/lib/cockpit-[a-z0-9][a-z0-9-]{0,40}(/[A-Za-z0-9_][A-Za-z0-9._-]{0,80}){1,3}$` (below
`/usr/lib/cockpit-NAME/`, no `.` or `..` segments, no spaces). It always runs it as
`COMMAND status --lang xx`; further arguments in the manifest are ignored. Any other command is
refused and shown as "Command refused". The manifest belongs to root and comes with the package.

## The answer

```json
{
  "schema": 1,
  "addon": "image-updates",
  "label": "Image Update Monitor",
  "version": "0.20.0",
  "checked_at": "2026-10-19T18:36:00Z",
  "state": "info",
  "summary": "3 updates available",
  "items": [
    {
      "id": "updates",
      "state": "info",
      "title": "Updates available",
      "value": "3",
      "detail": "postgres, glitchtip-web, caddy",
      "link": "#/updates/update",
      "checked_at": "2026-10-19T18:36:00Z",
      "stale_after": 43200
    }
  ]
}
```

What the board accepts:

| Field | Required | Rule | Otherwise |
|---|---|---|---|
| (the answer) | yes | UTF-8 JSON object, at most 64 KiB (the board closes the channel as soon as more arrives) | unreadable |
| `schema` | yes | the number `1` | unreadable ("follows version N") |
| `addon` | yes | `^[a-z0-9][a-z0-9-]{0,40}$` and the package folder the manifest was found in | unreadable |
| `state` | yes | `none`, `ok`, `info`, `warning`, `danger` | unreadable |
| `items` | yes | a list (may be empty) | unreadable |
| `label` | no | text, cut to 60 characters; the product name, never translated | the manifest's menu label |
| `version` | no | text, cut to 40 | left out |
| `checked_at` | no | ISO 8601 with a zone (`Z` or `±hh:mm`) | left out |
| `summary` | no | text in the language asked for, cut to 200 | left out |
| `items[].id` | yes | `^[a-z0-9-]{1,40}$`, once per answer | the item is left out |
| `items[].state` | yes | one of the five states | the item is left out |
| `items[].title` | yes | text, cut to 80 | the item is left out |
| `items[].value` | no | text (a number is taken as text), cut to 40 | left out |
| `items[].detail` | no | text, cut to 200 | left out |
| `items[].link` | no | `^#/[A-Za-z0-9/_-]{0,80}$`, a place inside the add-on's page | left out |
| `items[].checked_at` | no | as above | left out |
| `items[].stale_after` | no | whole seconds, 1 to ten years | left out |

Unknown fields are ignored. At most 50 items count; the tile says how many were left out.
"Text" means: control characters, zero-width and bidirectional characters are removed, line
breaks and tabs become spaces, and the page sets it with `textContent` only.

**An add-on that sets `link` must follow it while it is open.** Cockpit keeps a page's frame once
it is loaded; a jump to `/PACKAGE#/place` then only changes `cockpit.location`, and the page does
not load again. The page therefore listens to `cockpit.addEventListener("locationchanged", …)` and
shows the place named there, not only the one it found when it started. Cron Jobs, Image Update
Monitor, Update Gaps and Security Monitor do this. Two more rules follow from it:

- **A tab chosen on the page goes into the location** (`cockpit.location.go([tab])`). Otherwise the
  location still names the place of the last link, and a second click on the same tile changes
  nothing, so the page stays on the tab the user chose.
- **Scroll only once the page is shown.** The location can change while the frame is still hidden
  (`cockpit.hidden`; a page Cockpit preloaded or one the user left); scrolling then does nothing and
  the link is lost. The page keeps the place and scrolls on `visibilitychange`.

`test/fixtures/status/real-*.json` are the answers the four add-ons give, from their own verbs.

**`status.json` is the add-on's own file.** Its format is up to the add-on (Update Gaps, for
example, keeps the German texts in an extra field there); the board reads only what the verb
prints.

## States

The five states of the status language (`design-system/grundlagen.md`):

| `state` | Label | Icon | Example |
|---|---|---|---|
| `none` | `az-label` | `ban` | unknown, not set up |
| `ok` | `az-label--success` | `check-circle` | current, nothing found |
| `info` | `az-label--info` | `info-circle` | update available |
| `warning` | `az-label--warning` | `exclamation-triangle` | restart needed |
| `danger` | `az-label--danger` | `exclamation-circle` | database port reachable from the internet |

The add-on's `state` is the most severe of its items' `danger`, `warning` and `info`; else `ok`
when one item is `ok`; else `none`. The board never shows a state better than the items say: an
answer with `"state": "ok"` and an item in `danger` is a danger.

**Nothing checked:** an answer whose state is `none` and that rates no item (every item `none`, or
no item) tells that the add-on has checked nothing yet; the board shows it as a warning, "Not
checked", and so it shows exit 77 ("No access"). Both count as gaps in the board's coverage. A
single item in `none` next to rated ones is fine: it may mean "nothing to rate".

**Out of date:** an item whose `checked_at` lies more than `stale_after` seconds back counts as a
`warning`. The tile is then at least a warning, says "out of date since …", and its label reads
"Out of date" when the age alone made it a warning.

**The key figure** is the most important item: the most severe one (out of date counts as a
warning), one with a `value` before one without, else the first. Its `link` is where a click on the
tile goes.

## Optional: checks, findings and a host's profile

Three optional parts of version 1 say more than the items do: which checks an add-on runs on this
host and how they went (`checks`), the single findings behind an item (`findings`), and what a
host is expected to check (`profile`, from Host Settings only). Old boards and old add-ons ignore
them (`schema` stays `1`). An add-on names the parts it sends in `features`; a part it does not
name is not read. What breaks the rules below is left out and counted, it never makes the answer
unreadable. The board checks them (`validateStatus()`, `test/fixtures/status/ext-*.json`), lets
open findings count for an item's state (below), takes an add-on's coverage from its checks and
lists open findings as tasks ([INTERNALS.md](INTERNALS.md), "Needs attention"); it does not read
the profile yet.

```json
{
  "schema": 1,
  "addon": "security",
  "state": "danger",
  "features": ["checks", "findings"],
  "checks": [
    {"id": "exposure", "state": "checked", "title": "Reachable from the internet", "item": "exposure",
     "checked_at": "2026-10-19T18:50:00Z", "stale_after": 3600},
    {"id": "fail2ban", "state": "notapplicable", "title": "fail2ban", "reason": "fail2ban is not installed"}
  ],
  "items": [
    {"id": "exposure", "state": "danger", "title": "Reachable from the internet", "value": "2",
     "checked_at": "2026-10-19T18:50:00Z", "stale_after": 3600,
     "findings": {"complete": true, "total": 2, "list": [
       {"fid": "port.5432-tcp", "state": "danger", "title": "5432/tcp postgres", "since": "2026-10-19T18:30:00Z",
        "exposure": "internet", "fix": "available", "link": "#/exposure/5432-tcp"},
       {"fid": "port.6379-tcp", "state": "danger", "title": "6379/tcp redis", "exposure": "internet"}
     ]}}
  ]
}
```

| Field | Rule | Otherwise |
|---|---|---|
| `features` | a list; `checks`, `findings` and `profile` are read, anything else is ignored | no part is read |
| `checks` | a list, at most 50 count | left out and counted |
| `checks[].id` | `^[a-z0-9-]{1,40}$`, once per answer, the same on every host | the check is left out |
| `checks[].state` | `checked` (fully, in time), `partial` (some of it could not be read), `failed`, `unconfigured` (installed, does not check: timer off, never ran), `noaccess`, `unsupported` (cannot check on this system), `notapplicable` (nothing to check here, e.g. no Docker) | the check is left out |
| `checks[].title` | text, cut to 80 | the check is left out |
| `checks[].item` | the id of the item of this answer that shows the result | left out |
| `checks[].checked_at`, `stale_after`, `link` | as for items | left out |
| `checks[].reason` | text, cut to 200: why it is not `checked` | left out |
| `items[].findings` | an object `{complete, total, list}` | left out and counted |
| `findings.complete` | `true` only when `list` holds every finding of the item | (required) |
| `findings.total` | how many there are, listed or not | the length of `list` |
| `findings.list` | at most 100 findings per answer, over all items; more are left out | left out and counted |
| `list[].fid` | `^[a-z0-9][a-z0-9._:-]{0,63}$`, once per answer | the finding is left out |
| `list[].state` | one of the five states | the finding is left out |
| `list[].title` | text, cut to 80 | the finding is left out |
| `list[].since` | ISO 8601 with a zone: when the add-on first saw it | left out |
| `list[].exposure` | `internet`, `restricted` (from some addresses), `internal`, `local` | left out |
| `list[].fix` | `available`, `none`, `unknown` | left out |
| `list[].exploited` | `known` | left out |
| `list[].accepted_until` | ISO 8601 with a zone, at most 90 days after the item's `checked_at` (else the answer's) | left out: not accepted |
| `list[].link` | as for items | the item's link |
| `profile` | an object, read only from `addon: "host-settings"` | left out and counted |
| `profile.roles` | at most 10 of `^[a-z0-9-]{1,40}$` | each one left out |
| `profile.expect` | at most 100 add-ons or checks the host should have: `security`, `security/exposure` | each one left out |
| `profile.skip` | at most 50 of `{check, reason, until}`: a check left out on purpose, `reason` text cut to 200, `until` optional | each one left out |
| `profile.set_at` | ISO 8601 with a zone | left out |

**Findings.** A finding is one thing found: a port reachable from the internet, a held package, a
container with the Docker socket. Its `fid` comes from the add-on's rule and the resource, never
from a text, a count, a time or the order (`port.5432-tcp`, `held.postgresql-16`), so the same
finding has the same `fid` in every language and on every run; what changes about it (which
families reach a port, a version) belongs in its title or the item, not in the `fid`. Where the
resource itself is not for everyone's eyes (an account, a path, an address), the `fid` takes a key
instead: `h-` and 16 hex digits of an HMAC-SHA256 with a random key the add-on keeps for itself on
the host. Like every other text of the answer, titles name no IP addresses, user names, URLs or
paths.

- **A list is complete** only when the add-on says so and a check of state `checked` names the
  item in `item`; a list with findings left out, or one without such a check, counts as not
  complete. Only a complete list says that a finding missing from it is gone; anything else
  (a check that failed, ran in part, is out of date, an answer cut short) says nothing about it.
- **An item is never better than its open findings:** the board takes the most severe state of the
  item and of its findings that are not accepted, or whose `accepted_until` has passed. An add-on
  may keep accepted findings out of the item's state (Update Gaps does), but it keeps them in the
  list: accepted is not fixed.
- An acceptance ends on its day; one more than 90 days ahead of the check does not count at all.

**Checks and coverage.** `checks` lists what the add-on can check on this host, also what it does
not check and why (`unconfigured`, `unsupported`, `notapplicable`). A check that applies (every
state but `notapplicable`) and is not `checked`, or whose `checked_at` lies more than `stale_after`
back, is a gap in what the board knows about the host, not a finding; the worst of them is the
add-on's coverage on that host. A single item in state `none` cannot say that in version 1, because
add-ons use `none` for "nothing to rate" as well.

**A host's profile.** Host Settings sends what its host is expected to check: roles, the add-ons
and checks they expect, and checks left out on purpose. It names only its own host.

## Optional: a state in Cockpit's menu

The same `status.json` can give the add-on's own menu entry a symbol, on the host whose menu is
shown. Image Update Monitor does this since 0.21.0 (`plugin/menu-status.js`), Update Gaps since
0.2.0 and Cron Jobs since 2.9.0 in the same way, and Security Monitor with its own
`plugin/menu-status.js` since its first release, 0.1.0 (`"preload": ["index"]`, `stale_after` one
hour, so its symbol is at least a warning an hour after the last check).

- The page sets it with `cockpit.transport.control("notify", { page_status: { type, title } })`:
  `danger` becomes `error`, `warning` and `info` stay, `ok` and `none` send no symbol; the title is
  the `summary`. Cockpit files the status under the page of the frame that sends it, so only the
  page behind the menu entry can set it.
- `"preload": ["index"]` in the manifest loads that page hidden right after the login. While hidden
  it should only read `status.json` and send the symbol; the rest of the page starts when
  `cockpit.hidden` is false for the first time.
- The symbol should say what the board would say for the same file: never better than an item, an
  item older than its `stale_after` at least a warning (checked again when it turns old).
- A page opened without the shell (`/cockpit/@localhost/PACKAGE/index.html`) may send `notify` all
  the same: cockpit-ws drops a control message without a channel that it does not know
  (`dispatch_inbound_command` in `src/ws/cockpitwebservice.c`, read on 2026-10-20).
- Cockpit calls `notify` and `page_status` experimental; a successor is in the works
  (cockpit-project/cockpit pull request 23314, "notification boards").

## Changing the contract

- A change that old boards or old add-ons would misread raises `schema`. The board accepts only the
  versions it knows and names any other one ("follows version N").
- New optional fields need no new version: unknown fields are ignored on both sides. The optional
  parts above came that way.
- A change goes into `src/lib/status.js`, the fixtures, the tests and this file together; the
  add-ons follow in their own repositories.
