# Changelog

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
