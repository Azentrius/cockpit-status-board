# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately through GitHub instead:
[Report a vulnerability](https://github.com/Azentrius/cockpit-status-board/security/advisories/new)
(tab **Security → Report a vulnerability** in this repository).
If you cannot use GitHub, write to **support@azentrius.com**.

Please include:

- what is affected (page or package; version or commit),
- steps to reproduce,
- the impact you expect.

Do not send real credentials, keys, passwords or other private data from your hosts. Redact
screenshots, the browser console and command output before you attach them (host names, IP
addresses, user names, paths of SSH keys); a made-up example is just as good.

We aim to acknowledge reports within 7 days. This is a small project, so a fix may take longer; we
will keep you informed and credit you in the advisory unless you prefer to stay anonymous. Please keep
the details private until a fixed release is out.

## Supported versions

| Version | Security fixes |
|---|---|
| Newest release | yes |
| Older releases | no |

The board is in its 0.x line: only the newest release is supported. Security fixes go into a new
patch or minor release of the latest release line; older releases get no backports. The `main` branch
is a development state, not a supported installation.

To stay on a supported version, upgrade to the newest release:

```bash
# From packages.azentrius.com (Debian, Ubuntu, Fedora, RHEL; see README)
sudo apt update && sudo apt install cockpit-status-board   # Debian, Ubuntu
sudo dnf upgrade cockpit-status-board                      # Fedora, RHEL

# From the files of the release: check the download first, then install it
sha256sum --ignore-missing -c SHA256SUMS
gh attestation verify <file> --repo Azentrius/cockpit-status-board
sudo apt install ./cockpit-status-board_X.Y.Z-1_all.deb      # Debian, Ubuntu
sudo dnf install ./cockpit-status-board-X.Y.Z-1.noarch.rpm   # Fedora, RHEL
```

## How fixes are announced

A fixed vulnerability is announced with:

- a GitHub security advisory in this repository (tab **Security**), with a CVE ID where one is assigned,
- an entry in `CHANGELOG.md` marked as a security fix,
- the release notes of the fixed release, which come from `CHANGELOG.md`.

packages.azentrius.com takes the new release within an hour. To be notified, watch this repository's
releases on GitHub (**Watch › Custom › Releases**).

## Especially relevant

Status Board runs in a Cockpit session that reaches several hosts through the host switcher, and it
reads what those hosts send. A host that is compromised can send anything. Reports are particularly
welcome for:

- anything a host sends (the output of a status verb, a manifest, a host name) that the page turns
  into markup, script or a style instead of plain text,
- a jump (`cockpit.jump`) to anything but a checked package folder and a link inside it,
- a command the page runs on a host other than `find` with fixed arguments and a status command
  below `/usr/lib/cockpit-` with `status --lang en|de`,
- the page asking for administrative access, or running anything with it,
- one host changing what the board shows for another host,
- a click on another host's tile that opens a page on this host (Cockpit without `AllowMultiHost`),
- release archives, packages or `SHA256SUMS` that do not match the tagged source.
