# Internals

How Status Board finds hosts and add-ons, what it asks them, and how it reads the answers. The
second half is the **status contract**, version 1, which every Azentrius add-on implements; this
file says exactly what the board accepts.

The Cockpit code named here is that of Cockpit 360 (Ubuntu 26.04),
`https://github.com/cockpit-project/cockpit/blob/360/<path>`. The board was written against it and
tested against a stand-in for Cockpit (`test/web/mock-cockpit.js`); see "Not proven yet" at the end.

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
| `COMMAND status --lang xx` | every host with the add-on | `host`, `superuser: "try"`, `err: "message"` |
| `cockpit.jump("/PKG" + link, host)`, `cockpit.jump("/system", host)` | the shell | (navigation) |

Nothing else: no shell scripts, no `superuser: "require"`, no writes. `test/page.test.js` and
`test/ui_test.py` check this list.

## The status contract, version 1

### Verb

```
/usr/lib/<package>/<helper> status --lang en|de
```

Read-only, fast (at most 2 seconds), offline, usable without root: the board calls it with
`superuser: "try"`, and on other hosts its session usually has no administrative access. What is
expensive is prepared by the add-on's own timer, which writes a world-readable `status.json` (0644,
no IP addresses, no user names) that `status` reads. Exit codes: 0 with an answer (a finding is no
error, `danger` exits 0 too), 64 wrong call, 77 nothing readable without root.

### Finding the add-ons

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

### The answer

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

What the board accepts (`src/lib/status.js`, `validateStatus`; fixtures in `test/fixtures/status`):

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

### States

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

## Tiles

| Case | Label | Click |
|---|---|---|
| a valid answer | the state's word (Unknown, OK, Notice, Warning, Problem) or Out of date | the add-on, at the key item's link |
| exit 77, or access denied | No access (`none`) | the add-on |
| invalid answer, exit 64, other exit codes, missing command, timeout, unreadable manifest | Status unreadable (`warning`), with the reason | the add-on |
| a status command outside `/usr/lib/cockpit-` | Command refused (`warning`) | the add-on |
| installed in a version without `azentrius.status` | No status (`none`) | the add-on |
| not installed here, but on another host | Not installed (`none`) | nothing |
| the host cannot be reached | Unreachable (`danger`), with Cockpit's reason | the host's Overview |
| the SSH key is locked | Key locked (`warning`) | the host's Overview |
| `find` failed | Add-ons unreadable (`warning`) | nothing |

The tiles of a row are sorted by name, the same on every host, so the columns line up. A tile is
named by the label its own host sends (else its manifest's menu label); the name used for sorting
and for "Not installed" comes from the first host that has one, this host first. One host cannot
rename another host's tiles. The row's header carries the most severe state of its add-on tiles as
a strong label.

## Not proven yet

Derived from the code of Cockpit 360 and tested against the stand-in only:

- that `cockpit.spawn()`, `cockpit.file()` and the echo channel with `host` reach the other hosts
  through the bastion's bridge, with the switcher's connection, with `AllowMultiHost` on and off;
- that a locked key arrives as `error: "locked identity: …"` in the close options of the echo channel;
- that `cockpit.file()` reads `/proc/sys/kernel/hostname` on the other hosts;
- what the shell shows after `cockpit.jump()` to a host it is not connected to (`jump()` opens no
  connection, `pkg/shell/state.tsx`).

Read from the code as well: neither the shell's router (`pkg/shell/router.jsx`, which passes a
frame's channels on unchanged) nor `cockpit-ws` checks the `host` of a channel, and the bridge
always routes it (`src/cockpit/bridge.py`, `HostRoutingRule`). `AllowMultiHost` only decides
whether the shell shows the host switcher and whether `cockpit-ws` serves the pages of other hosts
(`/@HOST/…`). Without it the board still reads every host, but a jump to another host cannot load
that host's page. The board connects without the shell's warning before connecting to a host
(`WarnBeforeConnecting`): it loads no page and no JavaScript from there, only JSON.

The README's "Trying it on the bastion" lists the steps.
