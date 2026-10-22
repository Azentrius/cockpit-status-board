<!--
Title: short, imperative, English, without a version number. It becomes the commit on main.
Security problems: do not open a pull request, see SECURITY.md.
-->

## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## How tested

- [ ] `make check`
- [ ] `make lint`
- [ ] The page with the stand-in (`python3 test/serve.py`), `make check-ui` or in Cockpit (when `src/` changed)

<!-- Anything else you tried, and on which system. -->

## Checklist

- [ ] Every new or changed text exists in English and German (`src/i18n/en.js`, `src/i18n/de.js`)
- [ ] What a host sends still reaches the page as text only, and jumps go only to checked package folders and links
- [ ] The page still makes only the calls in `docs/INTERNALS.md` ("Every call the page makes"): no administrative access, no writes on any host
- [ ] Changes to the status contract are made in `src/lib/status.js`, `test/fixtures/`, the tests and `docs/STATUS-CONTRACT.md` together
- [ ] No secrets, keys or real data (host names, IP addresses, user names) in code, tests, fixtures or this description
- [ ] SPDX header on every new source file
