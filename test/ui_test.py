# SPDX-License-Identifier: Apache-2.0
"""Browser tests for Status Board against the stand-in for Cockpit (test/web/mock-cockpit.js),
with Cockpit's strict CSP (test/serve.py). The clock stands at 2026-10-19 19:00 UTC, the time the
fixtures are written for; the browser is in Europe/Berlin.
Run: python3 test/ui_test.py   (needs Playwright with Chromium; screenshots go to test/shots/)"""
import atexit
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

here = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(here, "shots")
os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get("PORT", "8773"))
BASE = f"http://127.0.0.1:{PORT}/pkg/status-board/index.html"
NOW = datetime(2026, 10, 19, 19, 0, 0, tzinfo=timezone.utc)
FIND = ["find", "/usr/share/cockpit", "-mindepth", "2", "-maxdepth", "2", "-name", "manifest.json"]
with open(os.path.join(here, "..", "src", "app.js"), encoding="utf-8") as f:
    VERSION = re.search(r'const VERSION = "([^"]+)";', f.read()).group(1)
INVISIBLE = [chr(c) for c in (0x202E, 0x202C, 0x200B, 0xFEFF, 0x2066, 0x2069, 0x2028, 0x07)]

srv = subprocess.Popen([sys.executable, os.path.join(here, "serve.py"), str(PORT)])
atexit.register(srv.terminate)
time.sleep(0.8)

failures = []
passed = 0


def check(cond, msg):
    global passed
    if cond:
        passed += 1
    else:
        failures.append(msg)
        print("FAIL:", msg)
        if os.environ.get("GITHUB_ACTIONS"):
            print("::error title=Browser test::" + msg.replace("\n", " ")[:900])


def wait_js(page, expr, timeout=10):
    """CSP blocks the eval behind wait_for_function; poll with evaluate instead."""
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate("() => !!(" + expr + ")"):
            return True
        page.wait_for_timeout(40)
    raise TimeoutError("wait_js timed out: " + expr)


def wait_idle(page):
    wait_js(page, "!document.querySelector('#refresh').disabled")
    page.wait_for_timeout(80)


def open_page(browser, query="", width=1280, height=900, dark=False, cookie=None):
    ctx = browser.new_context(viewport={"width": width, "height": height}, timezone_id="Europe/Berlin", locale="de-DE")
    if dark:
        ctx.add_init_script("localStorage.setItem('shell:style', 'dark')")
    if cookie:
        ctx.add_cookies([{"name": "CockpitLang", "value": cookie, "url": f"http://127.0.0.1:{PORT}/"}])
    page = ctx.new_page()
    page.problems = []
    page.on("console", lambda m: page.problems.append(m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.problems.append("pageerror: " + str(e)))
    page.clock.install(time=NOW)
    page.goto(BASE + ("?" + query if query else ""))
    wait_idle(page)
    return page


def mock(page, expr):
    return page.evaluate("() => window.__mock." + expr)


def rows(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('.sb-host')).map(s => s.dataset.host)")


def tile(page, key):
    return page.locator(f'[data-key="{key}"]')


def tile_text(page, key):
    return tile(page, key).inner_text()


def tile_label(page, key):
    return page.evaluate("""k => { const l = document.querySelector('[data-key="' + k + '"] .sb-tile__head .az-label');
        return l ? [l.className, l.innerText.trim(), l.firstElementChild && l.firstElementChild.matches('svg.az-icon')] : null; }""", key)


def host_label(page, host):
    return page.evaluate("""h => { const l = document.querySelector('[data-host="' + h + '"] .sb-host__header .az-label');
        return l ? [l.className, l.innerText.trim()] : null; }""", host)


def calls(page, kind):
    return [c for c in mock(page, "calls") if c["kind"] == kind]


def finds(page):
    return len([c for c in calls(page, "spawn") if c["args"] == FIND])


def shot(page, name, full=True):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)


def no_problems(page, what):
    check(not page.problems, "no console problems (" + what + "): " + repr(page.problems))


def labels_right(page):
    """The tiles whose label does not stand at the right edge of the tile's head."""
    return page.evaluate("""() => Array.from(document.querySelectorAll('.sb-tile__head')).filter(hd => {
        const l = hd.querySelector('.az-label');
        return l && Math.abs(l.getBoundingClientRect().right - hd.getBoundingClientRect().right) > 1;
    }).map(hd => hd.closest('.sb-tile').dataset.key)""")


SHELL_FRAME = "cockpit1:localhost/status-board"


def open_in_shell(browser, multihost, query=""):
    """The board in the frame of a stand-in for Cockpit's shell (test/serve.py, /shell.html), whose
    document carries the meta tag allow-multihost as cockpit-ws writes it from AllowMultiHost.
    query goes on to the board (scenario=…). Returns the shell's page and the board's frame."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, timezone_id="Europe/Berlin", locale="de-DE")
    page = ctx.new_page()
    page.problems = []
    page.on("console", lambda m: page.problems.append(m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.problems.append("pageerror: " + str(e)))
    page.clock.install(time=NOW)
    page.goto(f"http://127.0.0.1:{PORT}/shell.html?multihost={multihost}" + ("&" + query if query else ""))
    frame = page.frame(name=SHELL_FRAME)
    wait_idle(frame)
    return page, frame


LABEL = {"none": "az-label", "ok": "az-label az-label--success", "info": "az-label az-label--info",
         "warning": "az-label az-label--warning", "danger": "az-label az-label--danger"}

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- the board on the bastion, German ----------
    page = open_page(browser)
    check(page.inner_text("h1").strip() == "Status Board", "the title is the product name")
    check(page.evaluate("getComputedStyle(document.querySelector('.az-page-title'), '::after').content") == '"."',
          "the title carries the dot of the wordmark")
    refresh = page.evaluate("""() => { const b = document.querySelector('#refresh');
        return { cls: b.className, icon: b.firstElementChild.matches('svg.az-icon'), text: b.innerText.trim(),
                 meta: b.previousElementSibling.matches('.az-meta'), disabled: b.disabled }; }""")
    check(refresh == {"cls": "az-btn az-btn--primary", "icon": True, "text": "Aktualisieren", "meta": True, "disabled": False},
          "Refresh: primary, with its icon, the state next to it: " + repr(refresh))
    check(page.evaluate("() => document.querySelectorAll('.az-btn--primary').length") == 1, "Refresh is the only filled button")
    meta = page.inner_text("#meta")
    check(meta == "Geladen um 21:00 · 6 Hosts", "the state of the data in the header: " + meta)
    check(page.inner_text(".az-signature__meta").startswith("Status Board " + VERSION) and "vpn-host" in page.inner_text(".az-signature__meta"),
          "signature with version and host: " + page.inner_text(".az-signature__meta"))
    check(page.evaluate("document.documentElement.lang") == "de", "html lang")

    check(rows(page) == ["localhost", "build-host", "claw-host", "locked-host", "old-host", "public-host"],
          "this host first, then by label as in the host switcher: " + repr(rows(page)))
    heads = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host__header')).map(h =>
        [h.querySelector('h2').innerText, (h.querySelector('.az-meta') || {}).innerText || null])""")
    check(heads == [["vpn-host", "dieser Host"], ["build-host (CI)", "build-host"], ["claw-host", "claw-host:2222"],
                    ["locked-host", None], ["old-host", None], ["public-host", "stefan@public-host"]],
          "host names: the switcher's label, else the host's own name; the connection when it differs: " + repr(heads))

    # tiles: one per add-on, in the same order on every host
    order = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s =>
        Array.from(s.querySelectorAll('.sb-tile')).map(t => t.dataset.key.split('/')[1]))""")
    check(order[0] == order[1] == order[2] == order[5] == ["cronjobs", "image-updates", "update-gaps"], "the same columns on every host: " + repr(order))

    check(tile_label(page, "public-host/cronjobs") == [LABEL["danger"], "Problem", True], "failed runs are a problem")
    t = tile_text(page, "public-host/cronjobs")
    check("Cron Jobs" in t and "2" in t and "Fehlgeschlagene Läufe (24 h)" in t and "2 Läufe in den letzten 24 Stunden fehlgeschlagen" in t
          and "Stand vor 10 Minuten" in t, "the tile: name, key figure, summary, age: " + t)
    check(page.evaluate("""() => document.querySelector('[data-key="public-host/cronjobs"] .sb-tile__value').innerText""") == "2",
          "the key figure stands on its own")
    caption = page.evaluate("""() => { const t = document.querySelector('[data-key="public-host/cronjobs"]');
        const v = t.querySelector('.sb-tile__value').getBoundingClientRect(), n = t.querySelector('.sb-tile__title').getBoundingClientRect();
        return [n.top >= v.bottom - 1, Math.abs(n.left - v.left) <= 1]; }""")
    check(caption == [True, True], "the key figure's title stands below it as a caption, not after it as a sentence: " + repr(caption))
    check(labels_right(page) == [], "every label stands at the right edge of its tile: " + repr(labels_right(page)))
    check(page.evaluate("document.querySelector('#board').dataset.multihost") == "unknown",
          "without a shell around it the page does not know AllowMultiHost and keeps the jumps")
    check(tile_label(page, "public-host/image-updates") == [LABEL["info"], "Hinweis", True], "updates are a notice")
    check(tile_label(page, "public-host/update-gaps") == [LABEL["warning"], "Achtung", True], "held packages are a warning")
    check(host_label(page, "public-host") == [LABEL["danger"] + " az-label--strong", "Problem"], "the host's overall state: " + repr(host_label(page, "public-host")))

    got = tile_label(page, "localhost/cronjobs")
    check(got == [LABEL["ok"], "In Ordnung", True], "nothing found is OK: " + repr(got))
    check(tile_label(page, "localhost/update-gaps") == [LABEL["none"], "Nicht installiert", True] and
          page.evaluate("""() => document.querySelector('[data-key="localhost/update-gaps"]').tagName""") == "DIV",
          "not installed: neutral and not a button")
    check(tile_label(page, "build-host/cronjobs") == [LABEL["none"], "Kein Zugriff", True] and "Ohne Administratorzugriff" in tile_text(page, "build-host/cronjobs"),
          "exit 77: no access")
    t = tile_text(page, "build-host/image-updates")
    check(tile_label(page, "build-host/image-updates") == [LABEL["warning"], "Veraltet", True] and "veraltet seit 18. Okt., 19:12" in t
          and "Stand vor 38 Stunden" in t, "out of date: a warning with since when: " + t)
    check(tile_label(page, "build-host/update-gaps") == [LABEL["none"], "Kein Status", True] and "meldet keinen Status" in tile_text(page, "build-host/update-gaps"),
          "a version without the status entry")
    t = tile_text(page, "claw-host/update-gaps")
    check(tile_label(page, "claw-host/update-gaps") == [LABEL["warning"], "Status nicht lesbar", True] and "(Exit 1)" in t and "PermissionError" in t,
          "a failing status command: " + t)
    check(tile_label(page, "claw-host/image-updates")[1] == "Nicht installiert", "claw-host lacks the Image Update Monitor")

    t = tile_text(page, "old-host/unreachable")
    check(tile_label(page, "old-host/unreachable") == [LABEL["danger"], "Nicht erreichbar", True] and "Verbindung" in t and
          "Der Host ist nicht erreichbar." in t and "[Errno -2]" in t and "Host öffnen" in t, "an unreachable host: " + t)
    check(host_label(page, "old-host") == [LABEL["danger"] + " az-label--strong", "Nicht erreichbar"],
          "a host that cannot be reached says so next to its name: " + repr(host_label(page, "old-host")))
    t = tile_text(page, "locked-host/locked")
    check(tile_label(page, "locked-host/locked") == [LABEL["warning"], "Schlüssel gesperrt", True] and "/home/stefan/.ssh/id_ed25519" in t
          and "Host-Umschalter" in t, "a locked SSH key: " + t)
    check(host_label(page, "locked-host") == [LABEL["warning"] + " az-label--strong", "Schlüssel gesperrt"],
          "and so does a locked key: " + repr(host_label(page, "locked-host")))
    shot(page, "board")
    no_problems(page, "board")

    # what the page did on the hosts
    channels = calls(page, "channel")
    check(sorted(c["host"] for c in channels) == sorted(["stefan@public-host", "build-host", "claw-host:2222", "old-host", "locked-host"]) and
          all(c["payload"] == "echo" and sorted(c["opts"]) == ["host", "payload"] for c in channels),
          "one echo channel per other host, with the switcher's connection string: " + json.dumps(channels))
    spawns = calls(page, "spawn")
    reachable = {"stefan@public-host", "build-host", "claw-host:2222"}
    bad = [c for c in spawns if not (
        (c["args"] == FIND and c["host"] in reachable and c["opts"] == {"host": c["host"], "err": "message"}) or
        (len(c["args"]) == 4 and re.match(r"^/usr/lib/cockpit-[a-z0-9-]+/", c["args"][0]) and c["args"][1:] == ["status", "--lang", "de"] and
         c["opts"].get("superuser") == "try" and (c["host"] == "localhost") == ("host" not in c["opts"])))]
    check(not bad and spawns, "only find and the status verb, with superuser try: " + json.dumps(bad))
    check(sorted(c["host"] for c in spawns if c["args"] == FIND) == sorted(reachable), "find runs on the other hosts, not here")
    files = calls(page, "file")
    check(all(c["path"] == "/proc/sys/kernel/hostname" or (re.match(r"^/usr/share/cockpit/[a-z0-9-]+/manifest\.json$", c["path"]) and c["opts"]["syntax"] == "JSON")
              for c in files), "reads only host names and manifests (as JSON)")
    check(not [c for c in mock(page, "calls") if c["host"] in ("old-host", "locked-host") and c["kind"] != "channel"],
          "nothing else on hosts that cannot be reached")
    check(not [c for c in spawns + files if c["host"] == "localhost" and "manifest" in json.dumps(c)],
          "this host's manifests come from cockpit.manifests")
    check(mock(page, "watches") == [] and mock(page, "unexpected") == [], "no watch(), no unexpected command")
    check(mock(page, "dbusOpen") == 0, "the D-Bus client for the host list is closed again")
    check(not any(c["opts"].get("superuser") == "require" for c in spawns), "never asks for administrative access")

    # jumps into the add-ons
    tile(page, "public-host/image-updates").click()
    tile(page, "localhost/cronjobs").click()
    tile(page, "build-host/update-gaps").click()
    tile(page, "old-host/unreachable").click()
    tile(page, "claw-host/image-updates").click()
    check(mock(page, "jumps") == [["/image-updates#/updates", "public-host"], ["/cronjobs", None], ["/update-gaps", "build-host"],
                                  ["/system", "old-host"]],
          "a click opens the add-on on its host (with the link of the key item); not installed opens nothing: " + json.dumps(mock(page, "jumps")))
    tile(page, "public-host/cronjobs").focus()
    page.keyboard.press("Enter")
    check(mock(page, "jumps")[-1] == ["/cronjobs", "public-host"], "tiles work with the keyboard")

    # the times move on without a new load; focus stays where it was
    before = finds(page)
    tile(page, "public-host/update-gaps").focus()
    page.clock.fast_forward("01:00")
    page.wait_for_timeout(200)
    check(finds(page) == before, "no new load within 5 minutes")
    check("Stand vor 11 Minuten" in tile_text(page, "public-host/cronjobs"), "ages are shown again: " + tile_text(page, "public-host/cronjobs"))
    check(page.evaluate("document.activeElement.dataset.key") == "public-host/update-gaps", "focus stays on its tile")

    # every 5 minutes while visible, not while hidden
    page.clock.fast_forward("05:00")
    wait_js(page, f"window.__mock.calls.filter(c => c.kind === 'spawn' && c.args[0] === 'find').length > {before}")
    wait_idle(page)
    check(finds(page) == 2 * before, "loads again after 5 minutes")
    page.evaluate("() => window.__mock.setHidden(true)")
    page.clock.fast_forward("06:00")
    page.wait_for_timeout(300)
    check(finds(page) == 2 * before, "nothing while the page is hidden")
    page.evaluate("() => window.__mock.setHidden(false)")
    wait_js(page, f"window.__mock.calls.filter(c => c.kind === 'spawn' && c.args[0] === 'find').length > {2 * before}")
    wait_idle(page)
    check(finds(page) == 3 * before, "back on the page after 5 minutes: loads at once")

    # Refresh: busy while it loads, the old tiles stay until a host answers again
    page.evaluate("() => { window.__mock.delay = 400; }")
    page.click("#refresh")
    busy = page.evaluate("() => [document.querySelector('#refresh').disabled, document.querySelector('#refresh').innerText.trim()]")
    check(busy == [True, "Lädt …"], "Refresh is busy while loading: " + repr(busy))
    check("Problem" in tile_text(page, "public-host/cronjobs"), "the tiles stay while loading")
    wait_idle(page)
    page.evaluate("() => { window.__mock.delay = 30; }")

    # a host that does not answer: no answer within 20 seconds
    page.evaluate("() => { window.__mock.hosts['claw-host:2222'].reach = 'hang'; }")
    n = len(calls(page, "channel"))
    page.click("#refresh")
    wait_js(page, f"window.__mock.calls.filter(c => c.kind === 'channel').length > {n + 4}")
    # the other hosts answer first, so that only the waiting host's time runs out
    page.wait_for_timeout(1500)
    page.clock.fast_forward("00:25")
    wait_idle(page)
    t = tile_text(page, "claw-host/unreachable")
    check("Nicht erreichbar" in t and "Keine Antwort innerhalb von 20 Sekunden." in t, "timeout of a host: " + t)

    # the host switcher's list cannot be read
    page.evaluate("() => { window.__mock.failMachines = true; }")
    page.click("#refresh")
    wait_idle(page)
    alerts = page.inner_text("#alerts")
    check("Die Liste des Host-Umschalters ließ sich nicht lesen" in alerts and "Das Board zeigt nur diesen Host." in alerts,
          "an alert when the host list cannot be read: " + alerts)
    check(rows(page) == ["localhost"], "then only this host")
    no_problems(page, "board after reloads")
    page.context.close()

    # ---------- in the shell: with and without the host switcher (AllowMultiHost) ----------
    # Without it the shell turns a jump to another host into one to this host with the same path
    # (pkg/shell/state.tsx), so a tile of another host would open this host's add-on.
    shell, f = open_in_shell(browser, "no")
    check(f.evaluate("document.querySelector('#board').dataset.multihost") == "no", "the page reads the shell's meta tag")
    alerts = f.inner_text("#alerts")
    check("Ohne Host-Umschalter" in alerts and "AllowMultiHost" in alerts and "öffnen nichts" in alerts,
          "says why the tiles of other hosts open nothing: " + alerts)
    kinds = dict(f.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => [t.dataset.key, t.tagName])"))
    other = sorted(k for k, tag in kinds.items() if not k.startswith("localhost/") and tag == "BUTTON")
    check(not other and kinds.get("localhost/cronjobs") == "BUTTON",
          "only this host's tiles are buttons: " + repr(other) + " " + repr(kinds.get("localhost/cronjobs")))
    for key in ("public-host/image-updates", "old-host/unreachable", "locked-host/locked", "localhost/cronjobs"):
        tile(f, key).click()
    check(mock(f, "jumps") == [["/cronjobs", None]], "only this host's add-ons open: " + json.dumps(mock(f, "jumps")))
    t = tile_text(f, "old-host/unreachable")
    check("Host öffnen" not in t and "Der Host ist nicht erreichbar." in t, "an unreachable host offers nothing to open: " + t)
    t = tile_text(f, "locked-host/locked")
    check("ssh-add" in t and "Host-Umschalter" not in t and "Host öffnen" not in t, "a locked key, without the host switcher: " + t)
    check("Problem" in tile_text(f, "public-host/cronjobs"), "the other hosts are still read")
    shot(shell, "board-no-switcher")
    no_problems(shell, "without the host switcher")
    shell.context.close()

    # host keys: without the host switcher the texts name the terminal (ssh, ssh-keygen -R)
    shell, f = open_in_shell(browser, "no", "scenario=broken")
    t = tile_text(f, "hostkey-host/unreachable")
    check("Sein Hostschlüssel ist noch nicht bekannt." in t and "mit ssh im Terminal von Cockpit" in t and "Host-Umschalter" not in t,
          "an unknown host key, without the host switcher: " + t)
    t = tile_text(f, "changedkey-host/unreachable")
    check("Sein Hostschlüssel hat sich geändert." in t and "ssh-keygen -R" in t and "Host-Umschalter" not in t,
          "a changed host key, without the host switcher: " + t)
    check(f.evaluate("""() => document.querySelector('[data-key="changedkey-host/unreachable"] code').innerText""") == "ssh-keygen -R",
          "the command as code")
    check("Dort ist cockpit-bridge nicht installiert." in tile_text(f, "nobridge-host/unreachable"),
          "other reasons stay as they are")
    no_problems(shell, "host keys without the host switcher")
    shell.context.close()

    shell, f = open_in_shell(browser, "yes")
    check(f.evaluate("document.querySelector('#board').dataset.multihost") == "yes" and f.inner_text("#alerts").strip() == "",
          "with the host switcher: no alert")
    tile(f, "public-host/image-updates").click()
    tile(f, "old-host/unreachable").click()
    check(mock(f, "jumps") == [["/image-updates#/updates", "public-host"], ["/system", "old-host"]],
          "with the host switcher the tiles of other hosts open their add-on: " + json.dumps(mock(f, "jumps")))
    no_problems(shell, "with the host switcher")
    shell.context.close()

    # ---------- invalid names in the host list ----------
    page = open_page(browser, "badhosts=1")
    alerts = page.inner_text("#alerts")
    check("Aus der Hostliste ausgelassen (kein einfacher Hostname): bad host; rm -rf /, bad-user" in alerts, "skipped names are named: " + alerts)
    check(not [c for c in mock(page, "calls") if c["host"].startswith("bad")], "and never used")
    page.context.close()

    # ---------- hosts that send what they should not ----------
    page = open_page(browser, "scenario=hostile")
    for key in page.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => t.dataset.key)"):
        tile(page, key).hover()
    check(page.evaluate("() => window.__pwned") is None, "no code from a host runs")
    check(page.evaluate("() => document.querySelectorAll('#board img, #board script, #board b, #board i, #board a, #board iframe, #board style').length") == 0,
          "no elements from a host's texts")
    check(page.evaluate("() => Array.from(document.querySelectorAll('#board svg')).every(s => s.classList.contains('az-icon'))"), "only the page's icons")
    check(page.inner_text('[data-host="evil-host"] h2') == "<img src=x onerror=window.__pwned='host'>", "a host label as text")
    check(page.inner_text('[data-key="evil-host/cronjobs"] .sb-tile__name') == "<img src=x onerror=\"window.__pwned='label'\">", "an add-on label as text")
    check(page.inner_text('[data-key="evil-host/cronjobs"] .sb-tile__value') == "<i>7</i>", "a value as text")
    check(page.inner_text('[data-key="localhost/cronjobs"] .sb-tile__name') == "Cron Jobs", "another host cannot rename this host's tiles")
    tile(page, "evil-host/cronjobs").click()
    check(mock(page, "jumps") == [["/cronjobs", "evil-host"]], "a link that leaves the page is not followed: " + json.dumps(mock(page, "jumps")))
    for key in ("evil-host/image-updates", "evil-host/dotdot"):
        check(tile_label(page, key) == [LABEL["warning"], "Befehl abgelehnt", True], key + ": a command outside /usr/lib/cockpit- is refused")
    spawned = json.dumps([c["args"] for c in calls(page, "spawn")])
    check("/bin/sh" not in spawned and "touch" not in spawned and "cockpit-x" not in spawned, "refused commands never run: " + spawned)
    check(["/usr/lib/cockpit-extra/status-helper", "status", "--lang", "de"] in [c["args"] for c in calls(page, "spawn")] and
          "--delete-everything" not in spawned, "arguments from a manifest are ignored")
    check("länger als 64 KiB" in tile_text(page, "evil-host/extra"), "an answer longer than 64 KiB is not read")
    name = page.inner_text('[data-key="evil-host/update-gaps"] .sb-tile__name')
    check(len(name) == 60 and name.endswith("…") and "31 Einträge ausgelassen (ungültig)" in tile_text(page, "evil-host/update-gaps"),
          "long texts are cut, invalid items counted: " + name)
    check(labels_right(page) == [], "below a long name the label keeps to the right: " + repr(labels_right(page)))
    check(page.inner_text('[data-key="bidi-host/update-gaps"] .sb-tile__name') == "Updatespag Gaps", "bidirectional controls are gone")
    text = page.inner_text("body")
    check(not any(c in text for c in INVISIBLE), "no invisible characters on the page")
    check(page.inner_text('[data-host="bidi-host"] h2') == "bidi-host<script>", "a host name as text")
    read = [c["path"] for c in calls(page, "file")]
    check(not [x for x in read if "Bad_Name" in x or ".." in x or x == "/etc/passwd"], "find output that is no package folder is not read: " + json.dumps(read))
    check(page.evaluate("() => ({}).polluted === undefined && Object.prototype.polluted === undefined"), "prototype keys are only data")
    check(mock(page, "unexpected") == [], "no unexpected command")
    shot(page, "hostile")
    no_problems(page, "hostile")
    page.context.close()

    # ---------- broken answers and hosts that cannot be read ----------
    page = open_page(browser, "scenario=broken")
    expect = {
        "broken-host/cronjobs": "Die Antwort ist kein JSON.",
        "broken-host/image-updates": "Die Antwort folgt Version 2 des Status-Vertrags; dieses Board liest Version 1.",
        "broken-host/update-gaps": "Die Antwort gehört zu einem anderen Add-on (cronjobs).",
        "broken-host/extra": "Der Status-Befehl fehlt.",
        "half-host/cronjobs": "Sein Manifest ließ sich nicht lesen.",
        "dark-host/discovery": "Die Pakete auf diesem Host ließen sich nicht auflisten.",
        "nobridge-host/unreachable": "Dort ist cockpit-bridge nicht installiert.",
        "hostkey-host/unreachable": "Sein Hostschlüssel ist noch nicht bekannt. Verbinden Sie sich einmal über den Host-Umschalter.",
        "changedkey-host/unreachable": "Sein Hostschlüssel hat sich geändert. Prüfen Sie ihn im Host-Umschalter.",
    }
    for key, want in expect.items():
        check(want in tile_text(page, key), key + ": " + want + " in " + repr(tile_text(page, key)))
    check(page.evaluate("""() => document.querySelector('[data-key="nobridge-host/unreachable"] code').innerText""") == "cockpit-bridge",
          "code in the page's own texts")
    check(tile_label(page, "dark-host/discovery") == [LABEL["warning"], "Add-ons nicht lesbar", True], "find failed")
    check(host_label(page, "dark-host") == [LABEL["warning"] + " az-label--strong", "Add-ons nicht lesbar"],
          "the row says it next to the host's name: " + repr(host_label(page, "dark-host")))
    no_problems(page, "broken")
    page.context.close()

    # ---------- nothing to show ----------
    page = open_page(browser, "scenario=empty")
    check(page.inner_text("#board .az-empty__title") == "Keine Add-ons mit Status", "the empty state names what is missing")
    check(page.evaluate("() => document.querySelector('#board .az-empty__icon svg').getBoundingClientRect().height") == 48, "a 48 px icon")
    check(rows(page) == ["localhost", "old-host", "quiet-host"], "the hosts still show, so it shows which answer: " + repr(rows(page)))
    quiet = page.evaluate("""() => { const s = document.querySelector('[data-host="quiet-host"]');
        return [s.querySelector('h2').innerText, s.querySelectorAll('.sb-tile, .sb-note').length]; }""")
    check(quiet == ["quiet-host", 0], "a host that answers, without a note of its own: " + repr(quiet))
    check(tile_label(page, "old-host/unreachable")[1] == "Nicht erreichbar", "a host that does not answer")
    no_problems(page, "empty")
    page.context.close()

    # ---------- English, and languages like Cockpit ----------
    page = open_page(browser, "lang=en")
    text = page.inner_text("body")
    check(not re.search(r"[äöüÄÖÜß„“]|\b(Nicht|Stand|Achtung|Hinweis|dieser|Verbindung)\b", text), "the English board has no German")
    for word in ("Not installed", "Unreachable", "Key locked", "Out of date", "No access", "No status", "Status unreadable", "Refresh", "this host"):
        check(word in text, "English: " + word)
    check(all(c["args"][3] == "en" for c in calls(page, "spawn") if c["args"][1:3] == ["status", "--lang"]), "the status verb in English")
    check(page.inner_text("#meta") == "Loaded at 21:00 · 6 hosts", "English header: " + page.inner_text("#meta"))
    page.context.close()
    page = open_page(browser, "nopo=1")
    check(page.inner_text("#refresh").strip() == "Refresh", "English without po.js and cookie")
    page.context.close()
    page = open_page(browser, "nopo=1", cookie="de-de")
    check(page.inner_text("#refresh").strip() == "Aktualisieren", "German from the CockpitLang cookie")
    page.context.close()
    page = open_page(browser, "lang=fr")
    check(page.inner_text("#refresh").strip() == "Refresh", "other languages fall back to English")
    page.context.close()

    # ---------- the add-ons' real answers, in English: the README's screenshots ----------
    page = open_page(browser, "scenario=real&lang=en")
    check(rows(page) == ["localhost", "build-host", "claw-host", "public-host"], "the real scenario's hosts: " + repr(rows(page)))
    order = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s =>
        Array.from(s.querySelectorAll('.sb-tile')).map(t => t.dataset.key.split('/')[1]))""")
    check(all(o == ["cronjobs", "image-updates", "security", "update-gaps"] for o in order), "four columns on every host: " + repr(order))
    real = {"cronjobs": ("danger", "Problem", "1", "Failed jobs (last 24 hours)"),
            "image-updates": ("info", "Notice", "2", "Updates available"),
            "security": ("danger", "Problem", "1", "Container hardening"),
            "update-gaps": ("warning", "Warning", "6", "Held packages")}
    for name, (state, word, value, title) in real.items():
        key = "public-host/" + name
        figure = page.evaluate("""k => { const t = document.querySelector('[data-key="' + k + '"]');
            return [t.querySelector('.sb-tile__value').innerText, t.querySelector('.sb-tile__title').innerText]; }""", key)
        check(tile_label(page, key) == [LABEL[state], word, True] and figure == [value, title],
              key + ": the add-on's real answer: " + repr([tile_label(page, key), figure]))
    figure = page.evaluate("""() => document.querySelector('[data-key="build-host/security"] .sb-tile__value').innerText""")
    check(figure == "5", "the Security Monitor on build-host: five containers with the Docker socket: " + repr(figure))
    check(tile_label(page, "claw-host/image-updates")[1] == "Not installed", "claw-host lacks the Image Update Monitor")
    check(not re.search(r"[äöüÄÖÜß„“]", page.inner_text("body")), "the real answers in English have no German")
    check(labels_right(page) == [], "every label stands at the right edge of its tile: " + repr(labels_right(page)))

    # versions: a tile says when another host runs a newer version of its add-on
    hints = dict(page.evaluate("""() => Array.from(document.querySelectorAll('.sb-tile__hint'))
        .map(x => [x.closest('.sb-tile').dataset.key, x.innerText.trim()])"""))
    check(hints == {"localhost/cronjobs": "Version 2.9.0 runs on other hosts", "localhost/image-updates": "Version 0.24.1 runs on other hosts",
                    "localhost/update-gaps": "Version 0.6.0 runs on other hosts", "build-host/cronjobs": "Version 2.9.0 runs on other hosts",
                    "build-host/image-updates": "Version 0.24.1 runs on other hosts", "build-host/update-gaps": "Version 0.6.0 runs on other hosts",
                    "claw-host/cronjobs": "Version 2.9.0 runs on other hosts", "claw-host/update-gaps": "Version 0.6.0 runs on other hosts"},
          "older add-ons say which version runs elsewhere, the newest and the Security Monitor (0.2.0 everywhere) say nothing: " + repr(hints))
    check(page.inner_text('[data-key="public-host/security"] .sb-tile__meta') == "Checked 8 minutes ago · Version 0.2.0",
          "the version in the tile's facts: " + page.inner_text('[data-key="public-host/security"] .sb-tile__meta'))
    shot(page, "readme-board")
    tile(page, "public-host/security").click()
    check(mock(page, "jumps")[-1] == ["/security#/containers", "public-host"],
          "a click opens the Security Monitor at its key item: " + json.dumps(mock(page, "jumps")))

    # every entry of a tile, in a panel across the row below the tile's row of cards
    def toggle(key):
        return page.locator(f'[data-key="{key}"] + .sb-tile__more .sb-tile__toggle')

    def entries(key):
        return page.evaluate("""k => Array.from(document.querySelectorAll('[data-items-for="' + k + '"] .sb-item')).map(li => [
            li.dataset.item, li.querySelector('.az-label').innerText.trim(), (li.querySelector('.sb-item__link, .sb-item__title') || {}).innerText,
            !!li.querySelector('button.sb-item__link'), (li.querySelector('.sb-item__value') || {}).innerText || null])""", key)

    def row_rects(host):
        """Where the cards of a row and the parts inside them are in the document (a click scrolls
        its target into view): none of it may move. (A toggle's width follows its text, "All 5
        entries" or "Hide the entries".)"""
        return page.evaluate("""h => Array.from(document.querySelectorAll('[data-host="' + h + '"] .sb-cell')).map(c =>
            [c.querySelector('.sb-tile').dataset.key].concat(Array.from(c.querySelectorAll('.sb-tile, .sb-tile__meta, .sb-tile__toggle'))
                .map(e => { const r = e.getBoundingClientRect();
                    return [Math.round(r.x + window.scrollX), Math.round(r.y + window.scrollY),
                            e.matches('.sb-tile__toggle') ? null : Math.round(r.width), Math.round(r.height)]; })))""", host)

    key = "public-host/security"
    check(toggle(key).inner_text().strip() == "All 5 entries" and toggle(key).get_attribute("aria-expanded") == "false" and entries(key) == [],
          "folded away at first, the toggle says how many: " + toggle(key).inner_text())
    check(page.evaluate("() => document.querySelectorAll('[data-key=\"claw-host/image-updates\"] + .sb-tile__more').length") == 0,
          "a tile without an answer has nothing to fold out")
    before = row_rects("public-host")
    toggle(key).focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(50)
    got = entries(key)
    check(row_rects("public-host") == before, "opening moves nothing in the row: no card, figure, age or toggle jumps")
    panel = page.evaluate("""k => { const p = document.querySelector('[data-items-for="' + k + '"]'), row = p.parentElement.getBoundingClientRect();
        const r = p.getBoundingClientRect(), cards = Array.from(p.parentElement.querySelectorAll('.sb-cell')).map(c => c.getBoundingClientRect());
        return [Math.round(r.width) === Math.round(row.width), Math.round(r.top) > Math.max(...cards.map(c => Math.round(c.bottom)))]; }""", key)
    check(panel == [True, True], "the panel spans the row, below all of its cards: " + repr(panel))
    table = page.evaluate("""k => { const p = document.querySelector('[data-items-for="' + k + '"]');
        const x = sel => Array.from(new Set(Array.from(p.querySelectorAll(sel)).map(e => Math.round(e.getBoundingClientRect().left))));
        return { head: Array.from(p.querySelectorAll('thead th')).map(th => th.innerText.trim()),
                 cells: Array.from(p.querySelectorAll('tbody tr')).map(tr => tr.children.length),
                 names: x('.sb-item__name'), values: x('.sb-item__value'), states: x('.sb-item__state .az-label'), details: x('.sb-item__detail') }; }""", key)
    check(table["head"] == ["Entry", "Value", "State", "Details"] and table["cells"] == [4] * 5
          and all(len(table[c]) == 1 for c in ("names", "values", "states", "details")),
          "the entries are a table: one row each, names, values, labels and details in their columns: " + repr(table))
    check(got == [["exposure", "Warning", "Reachable from the internet", True, "10"], ["ssh", "Notice", "SSH", True, None],
                  ["logins", "OK", "Logins", True, "0"], ["containers", "Problem", "Container hardening", True, "1"],
                  ["scan", "OK", "Check", False, None]],
          "every entry in the add-on's order, with label, title and value; an entry without a place opens nothing: " + repr(got))
    check(toggle(key).get_attribute("aria-expanded") == "true" and toggle(key).inner_text().strip() == "Hide the entries"
          and page.evaluate("document.activeElement.dataset.focus") == key + "#items",
          "the toggle with the keyboard; it keeps the focus")
    check(page.evaluate("""k => { const t = document.querySelector('[data-key="' + k + '"] + .sb-tile__more .sb-tile__toggle');
        const p = document.getElementById(t.getAttribute('aria-controls'));
        return p && p.dataset.itemsFor === k && document.getElementById(p.getAttribute('aria-labelledby')).innerText; }""", key) == "Entries of Security Monitor",
          "the toggle controls the panel, which is named by its heading")
    page.locator('[data-items-for="public-host/security"] [data-item="ssh"] .sb-item__link').click()
    check(mock(page, "jumps")[-1] == ["/security#/ssh", "public-host"], "an entry opens its own place: " + json.dumps(mock(page, "jumps")))
    page.click("#refresh")
    wait_idle(page)
    check(len(entries(key)) == 5, "an open tile stays open when the board loads again")
    # the first card of the row opened too: the cards after it still fill the row, the panels follow in order
    toggle("public-host/cronjobs").click()
    page.wait_for_timeout(50)
    order = page.evaluate("""() => Array.from(document.querySelectorAll('[data-host="public-host"] .sb-tiles > *')).map(e =>
        [e.matches('.sb-panel') ? 'panel:' + e.dataset.itemsFor : e.querySelector('.sb-tile').dataset.key, Math.round(e.getBoundingClientRect().top)])""")
    tops = {k: t for k, t in order}
    check(row_rects("public-host") == before and tops["panel:public-host/cronjobs"] < tops["panel:public-host/security"],
          "two open tiles: the row stays, their panels below it in the order of the cards: " + repr(order))
    toggle("public-host/cronjobs").click()
    page.wait_for_timeout(50)
    check(row_rects("public-host") == before, "closing moves nothing either")

    # only what needs attention: OK, Unknown, Not installed, No status and No access are left out
    page.click(".az-switch")
    page.wait_for_timeout(50)
    keys = page.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => t.dataset.key)")
    hidden = ["localhost/cronjobs", "build-host/cronjobs", "claw-host/cronjobs", "claw-host/image-updates"]
    check(page.is_checked("#only-notable") and len(keys) == 12 and not any(k in keys for k in hidden),
          "the switch leaves out what needs no attention: " + repr(keys))
    check(host_label(page, "claw-host") == [LABEL["danger"] + " az-label--strong", "Problem"], "the row's label still says the whole row")
    check(len(entries(key)) == 5, "an open tile stays open with the switch")
    shot(page, "readme-board-details")
    no_problems(page, "real")
    # the browser keeps the choice: a new page of the same session starts with it
    again = page.context.new_page()
    again.problems = []
    again.on("pageerror", lambda e: again.problems.append("pageerror: " + str(e)))
    again.clock.install(time=NOW)
    again.goto(BASE + "?scenario=real&lang=en")
    wait_idle(again)
    check(again.is_checked("#only-notable") and again.evaluate("document.querySelector('#board').dataset.onlyNotable") == "true"
          and again.evaluate("() => document.querySelectorAll('.sb-tile').length") == 12, "the switch is kept in the browser")
    again.click(".az-switch")
    check(again.evaluate("() => document.querySelectorAll('.sb-tile').length") == 16, "and off again shows every tile")
    no_problems(again, "real, again")
    page.context.close()

    # a host left without tiles says so
    page = open_page(browser, "scenario=hostile")
    page.click(".az-switch")
    page.wait_for_timeout(50)
    note = page.evaluate("""() => { const s = document.querySelector('[data-host="localhost"]');
        return [s.querySelectorAll('.sb-tile').length, (s.querySelector('.sb-note') || {}).innerText]; }""")
    check(note == [0, "Nichts Auffälliges."], "a host with nothing that needs attention says so: " + repr(note))
    check(host_label(page, "localhost") == [LABEL["ok"] + " az-label--strong", "In Ordnung"], "and its label still says OK")
    page.context.close()
    page = open_page(browser, "scenario=real&lang=en", dark=True)
    shot(page, "readme-board-dark")
    no_problems(page, "real, dark")
    page.context.close()
    page = open_page(browser, "scenario=real&lang=en", width=390, height=844)
    shot(page, "readme-board-phone", full=False)
    no_problems(page, "real, phone")
    page.context.close()

    # ---------- package names like "constructor", and status output at and past 64 KiB ----------
    def edge_round(page, what):
        keys = page.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => t.dataset.key)")
        check(rows(page) == ["localhost", "big-host", "fine-host"], what + ": every host has its row: " + repr(rows(page)))
        check(not page.is_disabled("#refresh"), what + ": Refresh is enabled again after loading")
        for key, label, word, value in (("localhost/aaa", "Alpha", "Hinweis", "1"), ("localhost/constructor", "Constructor", "Achtung", "2")):
            name = page.evaluate("k => (document.querySelector('[data-key=\"' + k + '\"] .sb-tile__name') || {}).innerText", key)
            check(name == label and tile_label(page, key)[1] == word and value in tile_text(page, key),
                  what + ": the package " + key + " shows as itself: " + repr([name, tile_label(page, key), tile_text(page, key)]))
        for key in ("fine-host/aaa", "fine-host/constructor"):
            check(tile_label(page, key)[1] == "Nicht installiert", what + ": " + key + " is not installed, not taken from Object: " + repr(tile_label(page, key)))
        check(tile_label(page, "fine-host/cronjobs")[1] == "In Ordnung", what + ": another host is read as usual")
        check(tile_label(page, "big-host/exact")[1] == "In Ordnung" and "Exact 65536" in tile_text(page, "big-host/exact"),
              what + ": an answer of exactly 64 KiB, in 66 chunks, is read: " + tile_text(page, "big-host/exact"))
        for key in ("big-host/over", "big-host/flood"):
            check(tile_label(page, key)[1] == "Status nicht lesbar" and "länger als 64 KiB" in tile_text(page, key),
                  what + ": " + key + " is too large: " + tile_text(page, key))
        return keys

    page = open_page(browser, "scenario=edge")
    edge_round(page, "first load")
    closes = mock(page, "closes")
    over = [c for c in closes if c["problem"] == "too-large"]
    check(sorted(c["args"][0] for c in over) == ["/usr/lib/cockpit-edge-flood/status", "/usr/lib/cockpit-edge-over/status"]
          and all(c["streamed"] <= 65536 + 16384 for c in over),
          "the channels past the limit are closed as soon as they go past it, the endless one too: " + json.dumps(over))
    check(not any(c["args"][0].endswith("edge-exact/status") for c in closes), "the answer at the limit is not cut off")
    page.click("#refresh")
    wait_idle(page)
    edge_round(page, "after Refresh")
    check(len([c for c in mock(page, "closes") if c["problem"] == "too-large"]) == 4, "and again on Refresh")
    no_problems(page, "edge")
    page.context.close()
    page = open_page(browser, "scenario=edge&chunk=65536")
    check(tile_label(page, "big-host/over")[1] == "Status nicht lesbar" and tile_label(page, "big-host/exact")[1] == "In Ordnung",
          "the same with large chunks: one chunk at the limit, the next one past it")
    no_problems(page, "edge, large chunks")
    page.context.close()

    # ---------- dark, and on a phone ----------
    page = open_page(browser, dark=True)
    check(page.evaluate("document.documentElement.classList.contains('pf-v6-theme-dark')"), "follows Cockpit's dark style")
    shot(page, "board-dark")
    no_problems(page, "dark")
    page.context.close()

    page = open_page(browser, width=375, height=812)
    layout = page.evaluate("""() => ({ scroll: document.documentElement.scrollWidth,
        xs: Array.from(new Set(Array.from(document.querySelectorAll('.sb-tile')).map(t => Math.round(t.getBoundingClientRect().x)))),
        low: Array.from(document.querySelectorAll('button')).filter(b => b.getBoundingClientRect().height < 44).map(b => b.id || b.dataset.key) })""")
    check(layout["scroll"] <= 375, "no sideways scrolling on a phone: " + repr(layout["scroll"]))
    check(len(layout["xs"]) == 1, "tiles stand as blocks, one below the other: " + repr(layout["xs"]))
    check(layout["low"] == [], "controls are at least 44 px high on a phone: " + repr(layout["low"]))
    shot(page, "board-phone")
    no_problems(page, "phone")
    page.context.close()

    browser.close()

srv.terminate()
print(f"\n{passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
