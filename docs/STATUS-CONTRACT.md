# The status contract

Version 1. How an Azentrius Cockpit add-on reports its state to Status Board, which shows it as a
tile per host and add-on. This file is the reference for authors of add-ons. Status Board's checks
follow it (`src/lib/status.js`, `validateStatus`), and `test/fixtures/status` holds good, broken and
hostile answers.

Cron Jobs, Image Update Monitor (since 0.20.0) and Update Gaps implement it.

## Verb

```
/usr/lib/<package>/<helper> status --lang en|de
```

Read-only, fast (at most 2 seconds), offline, usable without root: the board calls it with
`superuser: "try"`, and on other hosts its session usually has no administrative access (a login
with an SSH key starts without it). What is expensive is prepared by the add-on's own timer, which
writes a world-readable `status.json` (0644, no IP addresses, no user names) that `status` reads.
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
      "link": "#/updates",
      "checked_at": "2026-10-19T18:36:00Z",
      "stale_after": 43200
    }
  ]
}
```

What the board accepts:

| Field | Required | Rule | Otherwise |
|---|---|---|---|
| (the answer) | yes | UTF-8 JSON object, at most 64 KiB | unreadable |
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

**Out of date:** an item whose `checked_at` lies more than `stale_after` seconds back counts as a
`warning`. The tile is then at least a warning, says "out of date since …", and its label reads
"Out of date" when the age alone made it a warning.

**The key figure** is the most important item: the most severe one (out of date counts as a
warning), one with a `value` before one without, else the first. Its `link` is where a click on the
tile goes.

## Optional: a state in Cockpit's menu

The same `status.json` can give the add-on's own menu entry a symbol, on the host whose menu is
shown. Image Update Monitor does this since 0.21.0 (`plugin/menu-status.js`).

- The page sets it with `cockpit.transport.control("notify", { page_status: { type, title } })`:
  `danger` becomes `error`, `warning` and `info` stay, `ok` and `none` send no symbol; the title is
  the `summary`. Cockpit files the status under the page of the frame that sends it, so only the
  page behind the menu entry can set it.
- `"preload": ["index"]` in the manifest loads that page hidden right after the login. While hidden
  it should only read `status.json` and send the symbol; the rest of the page starts when
  `cockpit.hidden` is false for the first time.
- Cockpit calls `notify` and `page_status` experimental; a successor is in the works
  (cockpit-project/cockpit pull request 23314, "notification boards").

## Changing the contract

- A change that old boards or old add-ons would misread raises `schema`. The board accepts only the
  versions it knows and names any other one ("follows version N").
- New optional fields need no new version: unknown fields are ignored on both sides.
- A change goes into `src/lib/status.js`, the fixtures, the tests and this file together; the
  add-ons follow in their own repositories.
