# Contributing

Bug reports, ideas and pull requests for Status Board are welcome. Security problems do not belong
in public issues: report them as described in [SECURITY.md](SECURITY.md). For a larger change, open
an issue first so we can agree on the approach.

## Setup

```bash
git clone https://github.com/Azentrius/cockpit-status-board.git
cd cockpit-status-board
pip install -r test/requirements.txt   # pinned check tools: playwright, ruff, shellcheck
python3 -m playwright install chromium # the browser for make check-ui
```

- The page is plain JavaScript without a build step and without runtime dependencies.
- Node.js (CI uses Node 22) runs the offline tests; they need no npm packages.
- Python 3 (CI uses 3.12) runs the stand-in for Cockpit (`test/serve.py`) and the browser tests.

## Tests and checks

```bash
make check               # offline tests: the status contract against the fixtures, texts, page files, design files, version
make lint                # shellcheck and ruff, as in CI
make check-ui            # the page in Chromium against a stand-in for Cockpit with Cockpit's CSP
make packages            # .deb and .rpm in dist/ (needs dpkg-deb and rpmbuild)
python3 test/serve.py    # the page with the stand-in: http://127.0.0.1:8773/pkg/status-board/index.html?scenario=real
```

The offline tests need no browser, no Cockpit and no network: `test/status.test.js` checks
`src/lib/status.js` against good, broken and hostile answers in `test/fixtures/status/`,
`test/i18n.test.js` the texts and `test/page.test.js` what the page's files may contain. The
fixtures are written for 2026-10-19 19:00 UTC; the tests pass that time, and the browser tests set
the clock to it.

The `test` workflow runs the lint, the offline tests, the archive and the packages (each built twice
to the same bytes, installed on Debian and Fedora) and the browser tests on every pull request and every
push to `main`. The job `e2e` runs the board in a real Cockpit with SSH to the runner itself
(`test/e2e_cockpit.py`). Its steps install Cockpit and an SSH server, add a user and change
`/etc/hosts`, so it runs only on CI's throwaway machine, never on one you use. The job `e2e-el`
runs the same test with the `.rpm` in Rocky Linux 9 and 10 VMs with SELinux enforcing
(`tools/vm.sh`, the same file in every Azentrius add-on; do not edit it here alone), as the
machine's user `ci`, with the browser on the runner; it is a pilot, not yet a required check, and
fails on every SELinux denial during the test. Its artifacts `e2e-rocky-9` and `e2e-rocky-10` have
the screenshots and the logs of Cockpit, the SSH server, the journal and the audit log.

## How the board is built

- **Read only.** The page runs `find` with fixed arguments and each add-on's status command, reads
  manifests and the host name, and asks for no administrative access (`superuser: "try"`, never
  `"require"`). It has no actions and no root helper. Every call it makes is listed in
  [docs/INTERNALS.md](docs/INTERNALS.md#every-call-the-page-makes); a new one goes there, into
  `test/page.test.js` and into the stand-in.
- **Everything from a host is data.** Texts reach the page through `textContent` only, never
  `innerHTML`; jumps go only to checked package folders and links; a host names only its own tiles.
- **The same host strings as the host switcher,** so the bridge shares the switcher's connection.
- **The status contract** (`docs/STATUS-CONTRACT.md`) belongs to this repository. A change goes into
  `src/lib/status.js`, the fixtures, the tests and the contract together; the add-ons follow in their
  own repositories.
- **No build step, no runtime dependencies.** JavaScript without a framework; Python only for the
  tests.
- **Browser without network.** No CDNs, external fonts or images; the fonts ship with the page and
  Cockpit's strict CSP stays.
- **Shared files.** The design files (`src/azentrius.*`, `src/icons.js`, the fonts) are
  byte-identical copies from Cron Jobs, pinned in `tools/design-files.sha256`, and
  `tools/build-packages.sh` is the same in every Azentrius add-on. Do not edit them here.

## Requirements for a change

- **English and German.** Every user-facing text goes into `src/i18n/en.js` and `src/i18n/de.js`.
  German addresses the user formally ("Sie"). The tests check that every text exists in both
  languages with the same shape and that the English texts contain no German.
- **English in the repository.** Code, comments, docs, commit messages and pull requests are in
  English; the only German is the translation and the tests that check it.
- **Tests** for new behaviour; `make check` and `make lint` green.
- **SPDX header** `SPDX-License-Identifier: Apache-2.0` in every new source file.
- **Versions and changelog** are the maintainer's: the pull request that raises the version adds its
  section to `CHANGELOG.md`. Describe user-visible changes in your pull request.
- **No private data.** No secrets, keys, host names, IP addresses other than the documentation
  ranges, user names or other real data in issues, pull requests, tests or fixtures.

## Pull requests

- Open them against `main`. `main` is protected: every change goes through a pull request and is
  squash-merged once the checks are green.
- The title becomes the commit on `main`: short, imperative, English, without a version number
  (e.g. "Open the entries in a panel below the row").
- Keep one topic per pull request and fill in the template: what and why, how it was tested.

## License

Status Board is licensed under the [Apache License 2.0](LICENSE); contributions are accepted under
the same license. Third-party material keeps its own license and is listed in [NOTICE](NOTICE); new
third-party material needs a compatible license and an entry there.
