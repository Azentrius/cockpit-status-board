# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately through GitHub instead:
[Report a vulnerability](https://github.com/Azentrius/cockpit-status-board/security/advisories/new)
(tab **Security → Report a vulnerability** in this repository).

Please include:

- what is affected (page, packages; version or commit),
- steps to reproduce,
- the impact you expect.

We aim to acknowledge reports within 7 days. This is a small project, so a fix
may take longer; we will keep you informed and credit you in the advisory
unless you prefer to stay anonymous.

## Supported versions

Only the latest release and the latest state of the `main` branch receive
security fixes.

## Especially relevant

Status Board runs in a Cockpit session that reaches several hosts through the
host switcher, and it reads what those hosts send. A host that is compromised
can send anything. Reports are particularly welcome for:

- anything a host sends (the output of a status verb, a manifest, a host name)
  that the page turns into markup, script or a style instead of plain text,
- a jump (`cockpit.jump`) to anything but a checked package folder and a link
  inside it,
- a command the page runs on a host other than `find` with fixed arguments and
  a status command below `/usr/lib/cockpit-` with `status --lang en|de`,
- the page asking for administrative access, or running anything with it,
- one host changing what the board shows for another host,
- release archives, packages or `SHA256SUMS` that do not match the tagged
  source.
