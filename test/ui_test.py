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
    check(host_label(page, "old-host") is None, "no overall label next to a host that cannot be read")
    t = tile_text(page, "locked-host/locked")
    check(tile_label(page, "locked-host/locked") == [LABEL["warning"], "Schlüssel gesperrt", True] and "/home/stefan/.ssh/id_ed25519" in t
          and "Host-Umschalter" in t, "a locked SSH key: " + t)
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
        "hostkey-host/unreachable": "Sein Hostschlüssel ist noch nicht bekannt.",
    }
    for key, want in expect.items():
        check(want in tile_text(page, key), key + ": " + want + " in " + repr(tile_text(page, key)))
    check(page.evaluate("""() => document.querySelector('[data-key="nobridge-host/unreachable"] code').innerText""") == "cockpit-bridge",
          "code in the page's own texts")
    check(tile_label(page, "dark-host/discovery") == [LABEL["warning"], "Add-ons nicht lesbar", True], "find failed")
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
