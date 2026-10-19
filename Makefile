# Status Board, a Cockpit page with the status of the Azentrius add-ons on every host
# SPDX-License-Identifier: Apache-2.0

PREFIX ?= /usr/local
DESTDIR ?=
PKGDIR = $(DESTDIR)$(PREFIX)/share/cockpit/status-board
VERSION := $(shell sed -n 's/^ *const VERSION = "\(.*\)";/\1/p' src/app.js)
# Reproducible archives: file times from the last commit.
SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || date +%s)
PACKAGE = cockpit-status-board-$(VERSION).tar.gz

.PHONY: all install uninstall devel-install devel-uninstall check check-ui lint dist package stage packages

all:
	@echo "Nothing to build. Try: make install, make check, make check-ui, make package, make packages"

install:
	install -d $(PKGDIR) $(PKGDIR)/lib $(PKGDIR)/i18n
	install -m 644 src/index.html src/manifest.json src/*.js src/*.css src/*.woff2 src/OFL.txt \
		src/CC-BY-4.0-Font-Awesome.txt $(PKGDIR)/
	install -m 644 src/lib/*.js $(PKGDIR)/lib/
	install -m 644 src/i18n/*.js $(PKGDIR)/i18n/

uninstall:
	rm -rf $(PKGDIR)

# Cockpit also loads packages from ~/.local/share/cockpit (for the logged-in user).
devel-install:
	mkdir -p ~/.local/share/cockpit
	ln -sfn $(CURDIR)/src ~/.local/share/cockpit/status-board

devel-uninstall:
	rm -f ~/.local/share/cockpit/status-board

# The offline tests: the rules for what hosts send (against the fixtures), the texts, the page's
# files, the shared design files, and version and changelog.
check:
	node test/status.test.js
	node test/i18n.test.js
	node test/page.test.js
	sh tools/check-design-files.sh
	sh tools/check-version.sh

# The page in a browser against a stand-in for Cockpit (needs Python Playwright with Chromium).
check-ui:
	python3 test/ui_test.py

# Source archive of the last commit.
dist:
	git archive --format=tar.gz --prefix=cockpit-status-board-$(VERSION)/ -o cockpit-status-board-$(VERSION)-source.tar.gz HEAD
	@echo cockpit-status-board-$(VERSION)-source.tar.gz

# Ready-to-install package: a directory "status-board" for /usr/share/cockpit or
# /usr/local/share/cockpit, with LICENSE and NOTICE, plus SHA256SUMS.
package:
	rm -rf build && mkdir -p build/status-board
	cp -R src/. build/status-board/
	cp LICENSE NOTICE build/status-board/
	find build/status-board -type d -exec chmod 755 {} +
	find build/status-board -type f -exec chmod 644 {} +
	cd build && tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@$(SOURCE_DATE_EPOCH) \
		-cf - status-board | gzip -9n > ../$(PACKAGE)
	sha256sum $(PACKAGE) > SHA256SUMS
	cd build/status-board && find . -type f | sort | xargs sha256sum | sed 's|  \./|  status-board/|' >> ../../SHA256SUMS
	rm -rf build
	@cat SHA256SUMS

# The files of the .deb and .rpm, as installed, in build/root.
stage:
	rm -rf build/root
	$(MAKE) install DESTDIR=build/root PREFIX=/usr
	install -D -m 644 packaging/de.azentrius.status_board.metainfo.xml \
		build/root/usr/share/metainfo/de.azentrius.status_board.metainfo.xml
	install -D -m 644 NOTICE build/root/usr/share/doc/cockpit-status-board/copyright
	install -m 644 LICENSE src/CC-BY-4.0-Font-Awesome.txt build/root/usr/share/doc/cockpit-status-board/

# cockpit-status-board_VERSION-1_all.deb and cockpit-status-board-VERSION-1.noarch.rpm in dist/
# (needs dpkg-deb and rpmbuild), reproducible like the archive.
packages: stage
	SOURCE_DATE_EPOCH=$(SOURCE_DATE_EPOCH) sh tools/build-packages.sh build/root $(VERSION) dist

# As in CI: shell scripts with shellcheck, Python with ruff
# (the tools: pip install -r test/requirements.txt).
lint:
	shellcheck --severity=warning tools/*.sh test/e2e/addon/status
	ruff check .
