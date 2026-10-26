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


def open_page(browser, query="", width=1280, height=900, dark=False, cookie=None, tab="hosts"):
    """The board at BASE?query. tab: the location the page opens with (#/hosts, the rows and
    tiles most checks look at; None for none, which shows the tasks)."""
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
    page.goto(BASE + ("?" + query if query else "") + ("#/" + tab if tab else ""))
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


def renamed(page, value):
    """value (a text, or what JSON carries) with the neutral names of the page's scenario (demo,
    demo-tasks: NEUTRAL in test/web/mock-cockpit.js) in place of the recorded ones."""
    text = value if isinstance(value, str) else json.dumps(value)
    for recorded, neutral in mock(page, "names"):
        text = text.replace(recorded, neutral)
    return text if isinstance(value, str) else json.loads(text)


def recorded_names(page):
    """The recorded names that the page's scenario replaces and that are still in its document."""
    html = page.content()
    return [recorded for recorded, _ in mock(page, "names") if recorded in html]


def first_difference(a, b):
    """Where two texts part, with a little of each from there."""
    i = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    return repr(a[max(0, i - 40):i + 60]) + " instead of " + repr(b[max(0, i - 40):i + 60])


def labels_right(page):
    """The tiles whose label does not stand at the right edge of the tile's head."""
    return page.evaluate("""() => Array.from(document.querySelectorAll('.sb-tile__head')).filter(hd => {
        const l = hd.querySelector('.az-label');
        return l && Math.abs(l.getBoundingClientRect().right - hd.getBoundingClientRect().right) > 1;
    }).map(hd => hd.closest('.sb-tile').dataset.key)""")


SHELL_FRAME = "cockpit1:localhost/status-board"


def open_in_shell(browser, multihost, query="", tab="hosts"):
    """The board in the frame of a stand-in for Cockpit's shell (test/serve.py, /shell.html), whose
    document carries the meta tag allow-multihost as cockpit-ws writes it from AllowMultiHost.
    query goes on to the board (scenario=…); tab "hosts" clicks that tab once it has loaded.
    Returns the shell's page and the board's frame."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, timezone_id="Europe/Berlin", locale="de-DE")
    page = ctx.new_page()
    page.problems = []
    page.on("console", lambda m: page.problems.append(m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.problems.append("pageerror: " + str(e)))
    page.clock.install(time=NOW)
    page.goto(f"http://127.0.0.1:{PORT}/shell.html?multihost={multihost}" + ("&" + query if query else ""))
    frame = page.frame(name=SHELL_FRAME)
    wait_idle(frame)
    if tab == "hosts":
        frame.click("#tab-hosts")
        wait_js(frame, "document.querySelector('.sb-host')")
    return page, frame


def tasks(page):
    """The tasks as the tab shows them, in order."""
    return page.evaluate("""() => Array.from(document.querySelectorAll('.sb-task')).map(t => ({
        key: t.dataset.task, group: t.closest('.sb-group').dataset.group,
        label: [t.querySelector('.sb-task__head .az-label').className, t.querySelector('.sb-task__head .az-label').innerText.trim()],
        title: t.querySelector('.sb-task__title').innerText, isnew: (t.querySelector('.sb-chip--new') || {}).innerText || null,
        where: t.querySelector('.sb-task__where').innerText,
        chips: Array.from(t.querySelectorAll('.sb-task__why .sb-chip')).map(c => c.innerText),
        detail: (t.querySelector('.sb-task__detail') || {}).innerText || null,
        sub: (t.querySelector('.sb-task__sub') || {}).innerText || null,
        facts: Array.from(t.querySelectorAll('.sb-task__facts dt')).map(dt => [dt.innerText, dt.nextElementSibling.innerText]),
        button: (t.querySelector('.sb-task__act button') || {}).innerText || null }))""")


def task_button(page, key):
    return page.locator(f'[data-task="{key}"] .sb-task__act button')


def folds(page):
    """Each folded section: its name, number, whether it is open, and its table while it is."""
    return page.evaluate("""() => Array.from(document.querySelectorAll('.sb-fold')).map(f => {
        const b = f.querySelector('.sb-fold__toggle');
        return { fold: f.dataset.fold, title: b.querySelector('span').innerText, count: b.querySelector('.sb-count').innerText,
                 open: b.getAttribute('aria-expanded'), head: Array.from(f.querySelectorAll('th')).map(th => th.innerText),
                 rows: Array.from(f.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText)) }; })""")


def tab_state(page):
    return page.evaluate("""() => ({ hash: location.hash,
        selected: Array.from(document.querySelectorAll('[role=tab]')).filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.id),
        shown: Array.from(document.querySelectorAll('[role=tabpanel]')).filter(p => !p.hidden).map(p => p.id),
        rows: document.querySelectorAll('.sb-host').length, tasks: document.querySelectorAll('.sb-task').length,
        switch: !document.querySelector('#notable-wrap').hidden })""")


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
    check(page.inner_text(".az-signature__meta").startswith("Status Board " + VERSION) and "bastion" in page.inner_text(".az-signature__meta"),
          "signature with version and host: " + page.inner_text(".az-signature__meta"))
    check(page.evaluate("document.documentElement.lang") == "de", "html lang")
    ts = tab_state(page)
    check(ts == {"hash": "#/hosts", "selected": ["tab-hosts"], "shown": ["board"], "rows": 6, "tasks": 0, "switch": True},
          "opened at #/hosts: the tab Hosts and coverage with its switch, nothing in the other tab: " + repr(ts))

    check(rows(page) == ["localhost", "ci1", "db1", "locked-host", "old-host", "web1"],
          "this host first, then by label as in the host switcher: " + repr(rows(page)))
    heads = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host__header')).map(h =>
        [h.querySelector('h2').innerText, (h.querySelector('.az-meta') || {}).innerText || null])""")
    check(heads == [["bastion", "dieser Host"], ["ci1 (CI)", "ci1"], ["db1", "db1:2222"],
                    ["locked-host", None], ["old-host", None], ["web1", "stefan@web1"]],
          "host names: the switcher's label, else the host's own name; the connection when it differs: " + repr(heads))

    # tiles: one per add-on, in the same order on every host
    order = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s =>
        Array.from(s.querySelectorAll('.sb-tile')).map(t => t.dataset.key.split('/')[1]))""")
    check(order[0] == order[1] == order[2] == order[5] == ["cronjobs", "image-updates", "update-gaps"], "the same columns on every host: " + repr(order))

    check(tile_label(page, "web1/cronjobs") == [LABEL["danger"], "Problem", True], "failed runs are a problem")
    t = tile_text(page, "web1/cronjobs")
    check("Cron Jobs" in t and "2" in t and "Fehlgeschlagene Läufe (24 h)" in t and "2 Läufe in den letzten 24 Stunden fehlgeschlagen" in t
          and "Stand vor 10 Minuten" in t, "the tile: name, key figure, summary, age: " + t)
    check(page.evaluate("""() => document.querySelector('[data-key="web1/cronjobs"] .sb-tile__value').innerText""") == "2",
          "the key figure stands on its own")
    caption = page.evaluate("""() => { const t = document.querySelector('[data-key="web1/cronjobs"]');
        const v = t.querySelector('.sb-tile__value').getBoundingClientRect(), n = t.querySelector('.sb-tile__title').getBoundingClientRect();
        return [n.top >= v.bottom - 1, Math.abs(n.left - v.left) <= 1]; }""")
    check(caption == [True, True], "the key figure's title stands below it as a caption, not after it as a sentence: " + repr(caption))
    check(labels_right(page) == [], "every label stands at the right edge of its tile: " + repr(labels_right(page)))
    check(page.evaluate("document.querySelector('#board').dataset.multihost") == "unknown",
          "without a shell around it the page does not know AllowMultiHost and keeps the jumps")
    check(tile_label(page, "web1/image-updates") == [LABEL["info"], "Hinweis", True], "updates are a notice")
    check(tile_label(page, "web1/update-gaps") == [LABEL["warning"], "Achtung", True], "held packages are a warning")
    check(host_label(page, "web1") == [LABEL["danger"] + " az-label--strong", "Problem"], "the host's overall state: " + repr(host_label(page, "web1")))

    got = tile_label(page, "localhost/cronjobs")
    check(got == [LABEL["ok"], "In Ordnung", True], "nothing found is OK: " + repr(got))
    check(tile_label(page, "localhost/update-gaps") == [LABEL["none"], "Nicht installiert", True] and
          page.evaluate("""() => document.querySelector('[data-key="localhost/update-gaps"]').tagName""") == "DIV",
          "not installed: neutral and not a button")
    check(tile_label(page, "ci1/cronjobs") == [LABEL["warning"], "Kein Zugriff", True] and "Ohne Administratorzugriff" in tile_text(page, "ci1/cronjobs"),
          "exit 77: no access, a warning (nothing of the add-on can be read)")
    t = tile_text(page, "ci1/image-updates")
    check(tile_label(page, "ci1/image-updates") == [LABEL["warning"], "Veraltet", True] and "veraltet seit 18. Okt., 19:12" in t
          and "Stand vor 38 Stunden" in t, "out of date: a warning with since when: " + t)
    check(tile_label(page, "ci1/update-gaps") == [LABEL["none"], "Kein Status", True] and "meldet keinen Status" in tile_text(page, "ci1/update-gaps"),
          "a version without the status entry")
    t = tile_text(page, "db1/update-gaps")
    check(tile_label(page, "db1/update-gaps") == [LABEL["warning"], "Status nicht lesbar", True] and "(Exit 1)" in t and "PermissionError" in t,
          "a failing status command: " + t)
    check(tile_label(page, "db1/image-updates")[1] == "Nicht installiert", "db1 lacks the Image Update Monitor")

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

    # coverage: of the board above the hosts, of each host below its name
    cov = page.evaluate("""() => { const c = document.querySelector('#coverage');
        return { hidden: c.hidden, place: c.previousElementSibling.id + '|' + c.nextElementSibling.id,
                 title: c.querySelector('h2').innerText, figure: c.querySelector('.sb-coverage__figure').innerText,
                 labels: Array.from(c.querySelectorAll('.az-label')).map(l => [l.className, l.innerText.trim()]) }; }""")
    check(cov == {"hidden": False, "place": "alerts|tabs", "title": "Abdeckung", "figure": "6 von 9 erwarteten Add-ons geprüft",
                  "labels": [[LABEL["warning"], "1 Status nicht lesbar"], [LABEL["warning"], "1 kein Zugriff"], [LABEL["warning"], "1 veraltet"],
                             [LABEL["danger"], "2 Hosts nicht gelesen"], [LABEL["info"], "4 Hosts ohne Sollprofil"]]},
          "the board's coverage: expected add-ons checked (without a profile the installed ones), what keeps the others from it, "
          "hosts not read, hosts without a target profile as a notice: " + repr(cov))
    lines = dict(page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s => {
        const c = s.querySelector('.sb-host__header + .sb-host__coverage');
        return [s.dataset.host, c ? [(c.querySelector('.sb-host__figure') || {}).innerText || null,
            Array.from(c.querySelectorAll('.sb-host__profile > *')).map(x => [x.className, x.innerText.trim()])] : null]; })"""))
    none = [[LABEL["info"], "Kein Sollprofil"]]
    check(lines == {"localhost": ["2 von 2 erwarteten Add-ons geprüft", none], "web1": ["3 von 3 erwarteten Add-ons geprüft", none],
                    "ci1": ["0 von 2 erwarteten Add-ons geprüft · Cron Jobs: kein Zugriff · Image Update Monitor: veraltet", none],
                    "db1": ["1 von 2 erwarteten Add-ons geprüft · Update Gaps: Status nicht lesbar", none], "locked-host": None, "old-host": None},
          "each host's coverage below its name, and that it has no target profile (a notice); not installed and no status entry are "
          "no gap; nothing for hosts not read: " + repr(lines))
    shot(page, "board")
    no_problems(page, "board")

    # what the page did on the hosts
    channels = calls(page, "channel")
    check(sorted(c["host"] for c in channels) == sorted(["stefan@web1", "ci1", "db1:2222", "old-host", "locked-host"]) and
          all(c["payload"] == "echo" and sorted(c["opts"]) == ["host", "payload"] for c in channels),
          "one echo channel per other host, with the switcher's connection string: " + json.dumps(channels))
    spawns = calls(page, "spawn")
    reachable = {"stefan@web1", "ci1", "db1:2222"}
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
    tile(page, "web1/image-updates").click()
    tile(page, "localhost/cronjobs").click()
    tile(page, "ci1/update-gaps").click()
    tile(page, "old-host/unreachable").click()
    tile(page, "db1/image-updates").click()
    check(mock(page, "jumps") == [["/image-updates#/updates", "web1"], ["/cronjobs", None], ["/update-gaps", "ci1"],
                                  ["/system", "old-host"]],
          "a click opens the add-on on its host (with the link of the key item); not installed opens nothing: " + json.dumps(mock(page, "jumps")))
    tile(page, "web1/cronjobs").focus()
    page.keyboard.press("Enter")
    check(mock(page, "jumps")[-1] == ["/cronjobs", "web1"], "tiles work with the keyboard")

    # the times move on without a new load; focus stays where it was
    before = finds(page)
    tile(page, "web1/update-gaps").focus()
    page.clock.fast_forward("01:00")
    page.wait_for_timeout(200)
    check(finds(page) == before, "no new load within 5 minutes")
    check("Stand vor 11 Minuten" in tile_text(page, "web1/cronjobs"), "ages are shown again: " + tile_text(page, "web1/cronjobs"))
    check(page.evaluate("document.activeElement.dataset.key") == "web1/update-gaps", "focus stays on its tile")

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
    check("Problem" in tile_text(page, "web1/cronjobs"), "the tiles stay while loading")
    wait_idle(page)
    page.evaluate("() => { window.__mock.delay = 30; }")

    # a host that does not answer: no answer within 20 seconds
    page.evaluate("() => { window.__mock.hosts['db1:2222'].reach = 'hang'; }")
    n = len(calls(page, "channel"))
    page.click("#refresh")
    wait_js(page, f"window.__mock.calls.filter(c => c.kind === 'channel').length > {n + 4}")
    # the other hosts answer first, so that only the waiting host's time runs out
    page.wait_for_timeout(1500)
    page.clock.fast_forward("00:25")
    wait_idle(page)
    t = tile_text(page, "db1/unreachable")
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
    for key in ("web1/image-updates", "old-host/unreachable", "locked-host/locked", "localhost/cronjobs"):
        tile(f, key).click()
    check(mock(f, "jumps") == [["/cronjobs", None]], "only this host's add-ons open: " + json.dumps(mock(f, "jumps")))
    t = tile_text(f, "old-host/unreachable")
    check("Host öffnen" not in t and "Der Host ist nicht erreichbar." in t, "an unreachable host offers nothing to open: " + t)
    t = tile_text(f, "locked-host/locked")
    check("ssh-add" in t and "Host-Umschalter" not in t and "Host öffnen" not in t, "a locked key, without the host switcher: " + t)
    check("Problem" in tile_text(f, "web1/cronjobs"), "the other hosts are still read")
    shot(shell, "board-no-switcher")
    # the tasks of other hosts open nothing either
    f.click("#tab-tasks")
    wait_js(f, "document.querySelector('.sb-task')")
    listed = [x["key"] for x in tasks(f)]
    buttons = [x["key"] for x in tasks(f) if x["button"]]
    check(len(listed) > 5 and buttons == ["localhost/image-updates/item:updates"],
          "without the host switcher only this host's tasks have a button: " + repr(buttons) + " of " + repr(listed))
    task_button(f, "localhost/image-updates/item:updates").click()
    check(mock(f, "jumps")[-1] == ["/image-updates#/updates", None], "this host's task opens its add-on here: " + json.dumps(mock(f, "jumps")))
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
    tile(f, "web1/image-updates").click()
    tile(f, "old-host/unreachable").click()
    check(mock(f, "jumps") == [["/image-updates#/updates", "web1"], ["/system", "old-host"]],
          "with the host switcher the tiles of other hosts open their add-on: " + json.dumps(mock(f, "jumps")))
    f.click("#tab-tasks")
    wait_js(f, "document.querySelector('.sb-task')")
    check(f.evaluate("location.hash") == "#/tasks", "the tab is the frame's location: " + f.evaluate("location.hash"))
    task_button(f, "web1/cronjobs/item:failed-runs").click()
    task_button(f, "old-host/unreachable").click()
    check(mock(f, "jumps")[2:] == [["/cronjobs", "web1"], ["/system", "old-host"]],
          "and so do their tasks: " + json.dumps(mock(f, "jumps")))
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

    # the same answers in the tab of tasks: still only text
    page = open_page(browser, "scenario=hostile", tab=None)
    for key in page.evaluate("() => Array.from(document.querySelectorAll('.sb-task')).map(t => t.dataset.task)")[:12]:
        page.locator(f'[data-task="{key}"]').hover()
    check(page.evaluate("() => window.__pwned") is None, "no code from a host runs in the tasks")
    check(page.evaluate("() => document.querySelectorAll('#tasks img, #tasks script, #tasks b, #tasks i, #tasks a, #tasks iframe, #tasks style').length") == 0
          and page.evaluate("() => Array.from(document.querySelectorAll('#tasks svg')).every(s => s.classList.contains('az-icon'))"),
          "no elements from a host's texts in the tasks, only the page's icons")
    xss = [x for x in tasks(page) if x["key"] == "evil-host/cronjobs/item:xss"]
    check(len(xss) == 1 and xss[0]["title"] == "<svg onload=\"window.__pwned='title'\"></svg>: <i>7</i>"
          and xss[0]["where"] == "<img src=x onerror=window.__pwned='host'> · <img src=x onerror=\"window.__pwned='label'\">"
          and xss[0]["button"] == "In <img src=x onerror=\"window.__pwned='label'\"> öffnen",
          "title, value, host and add-on names as text: " + repr(xss))
    task_button(page, "evil-host/cronjobs/item:xss").click()
    check(mock(page, "jumps") == [["/cronjobs", "evil-host"]], "a task's link that leaves the page is not followed: " + json.dumps(mock(page, "jumps")))
    check(not any(c in page.inner_text("body") for c in INVISIBLE), "no invisible characters in the tasks")
    no_problems(page, "hostile tasks")
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
    check(page.evaluate("() => [document.querySelector('#coverage').hidden, document.querySelectorAll('.sb-host__coverage').length]") == [True, 0],
          "no coverage while no host has an add-on with a status")
    check(tile_label(page, "old-host/unreachable")[1] == "Nicht erreichbar", "a host that does not answer")
    no_problems(page, "empty")
    page.context.close()

    # ---------- English, and languages like Cockpit ----------
    page = open_page(browser, "lang=en")
    text = page.inner_text("body")
    check(not re.search(r"[äöüÄÖÜß„“]|\b(Nicht|Stand|Achtung|Hinweis|dieser|Verbindung)\b", text), "the English board has no German")
    for word in ("Not installed", "Unreachable", "Key locked", "Out of date", "No access", "No status", "Status unreadable", "Refresh", "this host",
                 "Coverage", "6 of 9 expected add-ons checked", "2 hosts not read", "4 hosts without a target profile", "No target profile",
                 "0 of 2 expected add-ons checked · Cron Jobs: no access · Image Update Monitor: out of date"):
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

    # ---------- the add-ons' real answers, in English (the README's screenshots: scenario demo, below) ----------
    page = open_page(browser, "scenario=real&lang=en")
    check(rows(page) == ["localhost", "ci1", "db1", "web1"], "the real scenario's hosts: " + repr(rows(page)))
    order = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s =>
        Array.from(s.querySelectorAll('.sb-tile')).map(t => t.dataset.key.split('/')[1]))""")
    check(all(o == ["cronjobs", "image-updates", "security", "update-gaps"] for o in order), "four columns on every host: " + repr(order))
    real = {"cronjobs": ("danger", "Problem", "1", "Failed jobs (last 24 hours)"),
            "image-updates": ("info", "Notice", "2", "Updates available"),
            "security": ("danger", "Problem", "1", "Container hardening"),
            "update-gaps": ("warning", "Warning", "6", "Held packages")}
    for name, (state, word, value, title) in real.items():
        key = "web1/" + name
        figure = page.evaluate("""k => { const t = document.querySelector('[data-key="' + k + '"]');
            return [t.querySelector('.sb-tile__value').innerText, t.querySelector('.sb-tile__title').innerText]; }""", key)
        check(tile_label(page, key) == [LABEL[state], word, True] and figure == [value, title],
              key + ": the add-on's real answer: " + repr([tile_label(page, key), figure]))
    figure = page.evaluate("""() => document.querySelector('[data-key="ci1/security"] .sb-tile__value').innerText""")
    check(figure == "5", "the Security Monitor on ci1: five containers with the Docker socket: " + repr(figure))
    check(tile_label(page, "db1/image-updates")[1] == "Not installed", "db1 lacks the Image Update Monitor")
    check(not re.search(r"[äöüÄÖÜß„“]", page.inner_text("body")), "the real answers in English have no German")
    check(labels_right(page) == [], "every label stands at the right edge of its tile: " + repr(labels_right(page)))

    # versions: a tile says when another host runs a newer version of its add-on
    hints = dict(page.evaluate("""() => Array.from(document.querySelectorAll('.sb-tile__hint'))
        .map(x => [x.closest('.sb-tile').dataset.key, x.innerText.trim()])"""))
    check(hints == {"localhost/cronjobs": "Version 2.9.0 runs on other hosts", "localhost/image-updates": "Version 0.24.1 runs on other hosts",
                    "localhost/update-gaps": "Version 0.6.0 runs on other hosts", "ci1/cronjobs": "Version 2.9.0 runs on other hosts",
                    "ci1/image-updates": "Version 0.24.1 runs on other hosts", "ci1/update-gaps": "Version 0.6.0 runs on other hosts",
                    "db1/cronjobs": "Version 2.9.0 runs on other hosts", "db1/update-gaps": "Version 0.6.0 runs on other hosts"},
          "older add-ons say which version runs elsewhere, the newest and the Security Monitor (0.2.0 everywhere) say nothing: " + repr(hints))
    check(page.inner_text('[data-key="web1/security"] .sb-tile__meta') == "Checked 8 minutes ago · Version 0.2.0",
          "the version in the tile's facts: " + page.inner_text('[data-key="web1/security"] .sb-tile__meta'))
    board_text = page.inner_text("body")
    tile(page, "web1/security").click()
    check(mock(page, "jumps")[-1] == ["/security#/containers", "web1"],
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

    key = "web1/security"
    check(toggle(key).inner_text().strip() == "All 5 entries" and toggle(key).get_attribute("aria-expanded") == "false" and entries(key) == [],
          "folded away at first, the toggle says how many: " + toggle(key).inner_text())
    check(page.evaluate("() => document.querySelectorAll('[data-key=\"db1/image-updates\"] + .sb-tile__more').length") == 0,
          "a tile without an answer has nothing to fold out")
    before = row_rects("web1")
    toggle(key).focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(50)
    got = entries(key)
    check(row_rects("web1") == before, "opening moves nothing in the row: no card, figure, age or toggle jumps")
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
    page.locator('[data-items-for="web1/security"] [data-item="ssh"] .sb-item__link').click()
    check(mock(page, "jumps")[-1] == ["/security#/ssh", "web1"], "an entry opens its own place: " + json.dumps(mock(page, "jumps")))
    page.click("#refresh")
    wait_idle(page)
    check(len(entries(key)) == 5, "an open tile stays open when the board loads again")
    # the first card of the row opened too: the cards after it still fill the row, the panels follow in order
    toggle("web1/cronjobs").click()
    page.wait_for_timeout(50)
    order = page.evaluate("""() => Array.from(document.querySelectorAll('[data-host="web1"] .sb-tiles > *')).map(e =>
        [e.matches('.sb-panel') ? 'panel:' + e.dataset.itemsFor : e.querySelector('.sb-tile').dataset.key, Math.round(e.getBoundingClientRect().top)])""")
    tops = {k: t for k, t in order}
    check(row_rects("web1") == before and tops["panel:web1/cronjobs"] < tops["panel:web1/security"],
          "two open tiles: the row stays, their panels below it in the order of the cards: " + repr(order))
    toggle("web1/cronjobs").click()
    page.wait_for_timeout(50)
    check(row_rects("web1") == before, "closing moves nothing either")

    # only what needs attention: OK, Unknown, Not installed, No status and No access are left out
    page.click(".az-switch")
    page.wait_for_timeout(50)
    keys = page.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => t.dataset.key)")
    hidden = ["localhost/cronjobs", "ci1/cronjobs", "db1/cronjobs", "db1/image-updates"]
    check(page.is_checked("#only-notable") and len(keys) == 12 and not any(k in keys for k in hidden),
          "the switch leaves out what needs no attention: " + repr(keys))
    cov = page.evaluate("""() => [document.querySelector('#coverage').hidden, document.querySelector('#coverage .sb-coverage__figure').innerText,
        Array.from(document.querySelectorAll('#coverage .az-label')).map(l => l.innerText.trim()),
        Array.from(document.querySelectorAll('.sb-host__coverage .sb-host__figure')).map(p => p.innerText),
        Array.from(document.querySelectorAll('.sb-host__coverage .sb-host__profile')).map(p => p.innerText.trim())]""")
    check(cov == [False, "14 of 15 expected add-ons checked", ["1 out of date", "4 hosts without a target profile"],
                  ["4 of 4 expected add-ons checked", "3 of 4 expected add-ons checked · Image Update Monitor: out of date", "3 of 3 expected add-ons checked",
                   "4 of 4 expected add-ons checked"], ["No target profile"] * 4],
          "the coverage stays with the switch, of the board and of every host: " + repr(cov))
    check(host_label(page, "db1") == [LABEL["danger"] + " az-label--strong", "Problem"], "the row's label still says the whole row")
    check(len(entries(key)) == 5, "an open tile stays open with the switch")
    details_text = page.inner_text("body")
    no_problems(page, "real")
    # the browser keeps the choice: a new page of the same session starts with it
    again = page.context.new_page()
    again.problems = []
    again.on("pageerror", lambda e: again.problems.append("pageerror: " + str(e)))
    again.clock.install(time=NOW)
    again.goto(BASE + "?scenario=real&lang=en#/hosts")
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

    # ---------- the same answers with neutral names (scenario demo): the README's screenshots ----------
    page = open_page(browser, "scenario=demo&lang=en")
    heads = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host__header')).map(h =>
        [h.closest('.sb-host').dataset.host, h.querySelector('h2').innerText, (h.querySelector('.az-meta') || {}).innerText || null])""")
    check(heads == [["localhost", "bastion", "this host"], ["ci1", "ci1 (CI)", "ci1"], ["db1", "db1", "db1:2222"], ["web1", "web1", "admin@web1"]],
          "demo: neutral names for the hosts, their labels and connections: " + repr(heads))
    text = page.inner_text("body")
    check(text == renamed(page, board_text), "demo shows what real shows, with the neutral names: " + first_difference(text, renamed(page, board_text)))
    shot(page, "readme-board")
    toggle("web1/security").click()
    page.click(".az-switch")
    page.wait_for_timeout(50)
    text = page.inner_text("body")
    check(text == renamed(page, details_text), "and so it does with only what needs attention and the entries of the Security Monitor: "
          + first_difference(text, renamed(page, details_text)))
    shot(page, "readme-board-details")
    page.click(".az-switch")
    page.wait_for_timeout(50)
    for _ in range(16):    # the entries of every tile that has more than one
        closed = page.locator('.sb-tile__toggle[aria-expanded="false"]')
        if not closed.count():
            break
        closed.first.click()
    check(page.evaluate("() => document.querySelectorAll('.sb-panel').length") == 14 and recorded_names(page) == [],
          "no recorded name of a host, user, job, container or service anywhere, with every entry folded out: " + repr(recorded_names(page)))
    no_problems(page, "demo")
    page.context.close()
    page = open_page(browser, "scenario=demo&lang=en", dark=True)
    shot(page, "readme-board-dark")
    no_problems(page, "demo, dark")
    page.context.close()
    page = open_page(browser, "scenario=demo&lang=en", width=390, height=844)
    shot(page, "readme-board-phone", full=False)
    no_problems(page, "demo, phone")
    page.context.close()

    # ---------- Needs attention: the tasks over all hosts (scenario tasks: checks, findings, profile) ----------
    # Expected values from lib/status.js (buildTasks, coverageSummary) at 2026-10-19 19:00 UTC; the
    # browser is in Europe/Berlin (UTC+2 until 25 October). Host Settings sends the target profile
    # (role web, five add-ons, update-gaps/cve left out) on bastion, which lacks three of them, and
    # on web1, where Open CVEs is then not applicable; ci1 sends none.
    TASKS_DE = [
        ("old-host/unreachable", "danger", "Problem", "Nicht erreichbar"),
        ("web1/security/finding:port.6379-tcp", "danger", "Problem", "6379/tcp redis"),
        ("web1/security/finding:port.5432-tcp", "danger", "Problem", "5432/tcp postgres"),
        ("web1/cronjobs/item:failed-runs", "danger", "Problem", "Fehlgeschlagene Läufe (24 h): 2"),
        ("locked-host/locked", "warning", "Achtung", "Schlüssel gesperrt"),
        ("web1/update-gaps/finding:restart.kernel", "warning", "Achtung", "Restart for kernel 6.8.0-49"),
        ("localhost/image-updates/coverage", "warning", "Achtung", "Image Update Monitor fehlt"),
        ("localhost/security/coverage", "warning", "Achtung", "Security Monitor fehlt"),
        ("localhost/update-gaps/coverage", "warning", "Achtung", "Update Gaps fehlt"),
        ("ci1/cronjobs/coverage", "warning", "Achtung", "Cron Jobs: kein Zugriff"),
        ("ci1/image-updates/coverage", "warning", "Achtung", "Image Update Monitor: veraltet"),
        ("web1/security/coverage", "warning", "Achtung", "Security Monitor: Container hardening teilweise geprüft"),
        ("ci1/profile", "info", "Hinweis", "Kein Sollprofil"),
        ("web1/image-updates/item:updates", "info", "Hinweis", "Updates verfügbar: 3"),
    ]
    page = open_page(browser, "scenario=tasks", tab=None)
    ts = tab_state(page)
    check(ts == {"hash": "", "selected": ["tab-tasks"], "shown": ["tasks"], "rows": 0, "tasks": 14, "switch": False},
          "without a location the board opens on Needs attention; the switch belongs to the other tab: " + repr(ts))
    tabs = page.evaluate("""() => Array.from(document.querySelectorAll('[role=tab]')).map(t =>
        [t.querySelector('[data-t]').innerText, (t.querySelector('.sb-count') || {}).innerText || '', t.tabIndex, Math.round(t.getBoundingClientRect().height) >= 44])""")
    check(tabs == [["Handlungsbedarf", "14", 0, True], ["Hosts und Abdeckung", "", -1, True]] and
          page.evaluate("document.querySelector('[role=tablist]').getAttribute('aria-label')") == "Ansichten",
          "two tabs, the number of tasks on the first: " + repr(tabs))
    got = tasks(page)
    check([(x["key"], x["group"], x["label"][1], x["title"]) for x in got] == TASKS_DE and all(x["label"][0] == LABEL[x["group"]] for x in got),
          "the tasks in order: state, a host not read first, exposure, older first, then host and add-on: "
          + repr([(x["key"], x["label"][1], x["title"]) for x in got]))
    check(not any(x["key"] == "web1/update-gaps/coverage" for x in got), "Open CVEs, left out by web1's profile, is no gap there")
    groups = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-group')).map(g =>
        [g.dataset.group, g.querySelector('h2 .az-label').innerText.trim(), g.querySelector('h2 .sb-count').innerText])""")
    check(groups == [["danger", "Problem", "4"], ["warning", "Achtung", "8"], ["info", "Hinweis", "2"]], "grouped by the board's words: " + repr(groups))
    by = {x["key"]: x for x in got}
    want = {
        "web1/security/finding:port.6379-tcp": {
            "isnew": None, "where": "web1 · Security Monitor · Reachable from the internet",
            "chips": ["aus dem Internet erreichbar", "Abhilfe verfügbar"], "detail": None, "sub": None,
            "facts": [["Seit", "17. Okt., 09:30"], ["Nachweis", "Stand 20:50, vollständig"], ["Behoben, wenn", "eine vollständige Prüfung den Befund nicht mehr findet"]],
            "button": "In Security Monitor öffnen"},
        "web1/security/finding:port.5432-tcp": {
            "isnew": "neu", "where": "web1 · Security Monitor · Reachable from the internet",
            "chips": ["aus dem Internet erreichbar", "Abhilfe verfügbar"], "detail": None, "sub": None,
            "facts": [["Seit", "20:30"], ["Nachweis", "Stand 20:50, vollständig"], ["Behoben, wenn", "eine vollständige Prüfung den Befund nicht mehr findet"]],
            "button": "In Security Monitor öffnen"},
        "web1/cronjobs/item:failed-runs": {
            "isnew": None, "where": "web1 · Cron Jobs", "chips": ["nur Zusammenfassung"], "detail": "backup-files, update-geoip", "sub": None,
            "facts": [["Nachweis", "Stand 20:50"], ["Behoben, wenn", "das Add-on den Eintrag wieder als in Ordnung bewertet"]],
            "button": "In Cron Jobs öffnen"},
        "old-host/unreachable": {
            "isnew": None, "where": "old-host", "chips": ["Befunde unbekannt"], "detail": "Der Host ist nicht erreichbar.",
            "sub": "[Errno -2] Name or service not known", "facts": [["Behoben, wenn", "das Board den Host wieder lesen kann"]], "button": "Host öffnen"},
        "web1/update-gaps/finding:restart.kernel": {
            "isnew": None, "where": "web1 · Update Gaps · Restart", "chips": ["Abhilfe verfügbar"], "detail": None, "sub": None,
            "facts": [["Seit", "16. Okt., 06:00"], ["Nachweis", "Stand 20:45, vollständig"], ["Behoben, wenn", "eine vollständige Prüfung den Befund nicht mehr findet"]],
            "button": "In Update Gaps öffnen"},
        "web1/security/coverage": {
            "isnew": None, "where": "web1 · Security Monitor", "chips": ["erwartet für Rolle web"], "detail": "Container hardening: Docker could not be asked",
            "sub": None, "facts": [["Nachweis", "Stand 20:50"], ["Behoben, wenn", "das Add-on rechtzeitig und mit vollständigen Prüfungen antwortet"]],
            "button": "In Security Monitor öffnen"},
        "localhost/security/coverage": {
            "isnew": None, "where": "bastion · Security Monitor", "chips": ["erwartet für Rolle web"],
            "detail": "Auf diesem Host nicht installiert, obwohl sein Sollprofil es erwartet.", "sub": None,
            "facts": [["Behoben, wenn", "das Add-on auf diesem Host installiert ist und rechtzeitig antwortet"]], "button": None},
        "ci1/profile": {
            "isnew": None, "where": "ci1 (CI)", "chips": [],
            "detail": "Ohne Sollprofil gilt jedes installierte Add-on als erwartet; ein fehlendes fällt so nicht auf. "
                      "Das Sollprofil legen Sie in Host Settings auf jedem Host fest.", "sub": None,
            "facts": [["Behoben, wenn", "Host Settings für diesen Host ein Sollprofil meldet"]], "button": None},
        "ci1/image-updates/coverage": {
            "isnew": None, "where": "ci1 (CI) · Image Update Monitor", "chips": [], "detail": "Seine Daten sind seit 18. Okt., 19:12 veraltet.", "sub": None,
            "facts": [["Nachweis", "Stand 18. Okt., 07:12"], ["Behoben, wenn", "das Add-on rechtzeitig und mit vollständigen Prüfungen antwortet"]],
            "button": "In Image Update Monitor öffnen"},
    }
    for key, w in want.items():
        have = {k: v for k, v in by.get(key, {}).items() if k in w}
        check(have == w, "the task " + key + ": " + repr(have))
    check(by["ci1/cronjobs/coverage"]["detail"].startswith("Ohne Administratorzugriff ist hier nichts lesbar."), "no access says why")
    check(by["locked-host/locked"]["sub"] == "/home/stefan/.ssh/id_ed25519" and by["locked-host/locked"]["button"] == "Host öffnen", "a locked key")
    check([by[k]["chips"] for k in ("ci1/cronjobs/coverage", "ci1/image-updates/coverage")] == [[], []],
          "the gaps of a host without a target profile name no role")

    # the coverage above both tabs, with the gaps that checks show, the expected add-ons that are
    # missing, and the host without a target profile as a notice
    cov = page.evaluate("""() => [document.querySelector('#coverage .sb-coverage__figure').innerText,
        Array.from(document.querySelectorAll('#coverage .az-label')).map(l => [l.className, l.innerText.trim()])]""")
    check(cov == ["6 von 12 erwarteten Add-ons geprüft", [[LABEL["warning"], "3 nicht installiert"], [LABEL["warning"], "1 kein Zugriff"],
                                                          [LABEL["warning"], "1 veraltet"], [LABEL["warning"], "1 teilweise geprüft"],
                                                          [LABEL["danger"], "2 Hosts nicht gelesen"], [LABEL["info"], "1 Host ohne Sollprofil"]]],
          "the board's coverage with gaps of single checks and missing add-ons: " + repr(cov))

    # a click opens the add-on on the task's host, at the finding's, item's or check's place
    for key in ("web1/security/finding:port.6379-tcp", "web1/update-gaps/finding:restart.kernel", "web1/security/coverage",
                "ci1/image-updates/coverage", "ci1/cronjobs/coverage",
                "web1/cronjobs/item:failed-runs", "web1/image-updates/item:updates", "old-host/unreachable"):
        task_button(page, key).click()
    check(mock(page, "jumps") == [["/security#/exposure/6379-tcp", "web1"], ["/update-gaps#/restart", "web1"],
                                  ["/security#/containers", "web1"], ["/image-updates#/updates", "ci1"],
                                  ["/cronjobs", "ci1"], ["/cronjobs", "web1"], ["/image-updates#/updates", "web1"],
                                  ["/system", "old-host"]],
          "the jumps of the tasks, each on its host: " + json.dumps(mock(page, "jumps")))
    check(page.evaluate("""() => ['localhost/image-updates/coverage', 'localhost/security/coverage', 'localhost/update-gaps/coverage', 'ci1/profile']
        .map(k => document.querySelectorAll('[data-task="' + k + '"] button').length)""") == [0, 0, 0, 0],
          "a missing add-on opens nothing, nor does the notice of a host without Host Settings")

    # the folds: accepted findings and checks that do not apply, closed at first
    check(folds(page) == [{"fold": "accepted", "title": "Befristet akzeptiert", "count": "1", "open": "false", "head": [], "rows": []},
                          {"fold": "notapplicable", "title": "Nicht anwendbar", "count": "2", "open": "false", "head": [], "rows": []}],
          "two folds, closed: " + repr(folds(page)))
    page.focus('[data-fold="accepted"] .sb-fold__toggle')
    page.keyboard.press("Enter")
    page.click('[data-fold="notapplicable"] .sb-fold__toggle')
    page.focus('[data-fold="accepted"] .sb-fold__toggle')
    want_folds = [
        {"fold": "accepted", "title": "Befristet akzeptiert", "count": "1", "open": "true", "head": ["Befund", "Host", "Add-on", "Akzeptiert bis"],
         "rows": [["postgresql-16 is held", "web1", "Update Gaps", "30. Okt., 01:00"]]},
        {"fold": "notapplicable", "title": "Nicht anwendbar", "count": "2", "open": "true", "head": ["Prüfung", "Host", "Add-on", "Grund", "Festgelegt durch"],
         "rows": [["fail2ban", "web1", "Security Monitor", "fail2ban is not installed", "Add-on"],
                  ["Open CVEs (network data)", "web1", "Update Gaps", "network data off on purpose", "Sollprofil"]]},
    ]
    check(folds(page) == want_folds, "open: the accepted finding until when, the checks with their reason and who left them out: " + repr(folds(page)))
    page.evaluate("() => document.querySelector('#refresh').click()")   # a load, while the focus stays on the toggle
    wait_idle(page)
    check(folds(page) == want_folds and page.evaluate("document.activeElement.dataset.focus") == "fold:accepted",
          "open folds stay open when the board loads again, the focus stays on the toggle")
    shot(page, "tasks")
    no_problems(page, "tasks")

    # the tab is the location: a click sets #/hosts, Back returns, the keyboard moves between the tabs
    page.click("#tab-hosts")
    ts = tab_state(page)
    check(ts == {"hash": "#/hosts", "selected": ["tab-hosts"], "shown": ["board"], "rows": 5, "tasks": 0, "switch": True}
          and mock(page, "locations") == ["/hosts"], "a click on the tab sets the location: " + repr(ts) + " " + repr(mock(page, "locations")))
    lines = dict(page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s => {
        const c = s.querySelector('.sb-host__header + .sb-host__coverage');
        return [s.dataset.host, c ? [(c.querySelector('.sb-host__figure') || {}).innerText || null,
            Array.from(c.querySelectorAll('.sb-host__profile > *')).map(x => [x.className, x.innerText.trim()])] : null]; })"""))
    role = [["sb-chip", "Rolle web"]]
    check(lines == {"localhost": ["2 von 5 erwarteten Add-ons geprüft · Image Update Monitor: nicht installiert · Security Monitor: nicht installiert"
                                  " · Update Gaps: nicht installiert", role],
                    "web1": ["4 von 5 erwarteten Add-ons geprüft · Security Monitor: Container hardening teilweise geprüft", role],
                    "ci1": ["0 von 2 erwarteten Add-ons geprüft · Cron Jobs: kein Zugriff · Image Update Monitor: veraltet",
                                   [[LABEL["info"], "Kein Sollprofil"]]], "locked-host": None, "old-host": None},
          "each host's line names the add-on and the check, then its roles as neutral chips or that it has no target profile: " + repr(lines))
    # an expected add-on that is missing is a warning; on a host without a profile it stays neutral
    check(tile_label(page, "localhost/security") == [LABEL["warning"], "Fehlt", True]
          and "Auf diesem Host nicht installiert, obwohl sein Sollprofil es erwartet." in tile_text(page, "localhost/security")
          and page.evaluate("""() => document.querySelector('[data-key="localhost/security"]').tagName""") == "DIV",
          "missing, although expected: a warning that opens nothing: " + repr(tile_label(page, "localhost/security")))
    check(tile_label(page, "ci1/security") == [LABEL["none"], "Nicht installiert", True] and
          tile_label(page, "ci1/host-settings") == [LABEL["none"], "Nicht installiert", True],
          "not installed and not expected: neutral, as before")
    check(host_label(page, "localhost") == [LABEL["warning"] + " az-label--strong", "Achtung"], "the missing add-ons make the row a warning")
    check(tile_label(page, "web1/update-gaps") == [LABEL["warning"], "Achtung", True], "the tile itself says what the add-on says")
    page.click(".az-switch")
    page.wait_for_timeout(50)
    shown = page.evaluate("() => Array.from(document.querySelectorAll('[data-host=\"localhost\"] .sb-tile')).map(t => t.dataset.key)")
    check(shown == ["localhost/image-updates", "localhost/security", "localhost/update-gaps"] and
          page.evaluate("() => document.querySelectorAll('.sb-host__coverage .sb-host__profile').length") == 3,
          "only what needs attention keeps the missing add-ons and every host's line: " + repr(shown))
    shot(page, "tasks-hosts")
    page.click(".az-switch")
    page.wait_for_timeout(50)
    page.evaluate("() => history.back()")
    wait_js(page, "location.hash === '' && document.querySelector('.sb-task')")
    ts = tab_state(page)
    check(ts["selected"] == ["tab-tasks"] and ts["tasks"] == 14 and ts["rows"] == 0, "Back returns to the tasks: " + repr(ts))
    page.focus("#tab-tasks")
    page.keyboard.press("ArrowRight")
    check(tab_state(page)["selected"] == ["tab-hosts"] and page.evaluate("document.activeElement.id") == "tab-hosts", "the arrow keys move to the next tab")
    page.keyboard.press("Home")
    check(tab_state(page)["selected"] == ["tab-tasks"] and page.evaluate("[document.activeElement.id, location.hash]") == ["tab-tasks", "#/tasks"],
          "Home goes to the first tab, and to #/tasks")
    page.evaluate("() => { location.hash = '#/hosts'; }")
    wait_js(page, "document.querySelector('.sb-host')")
    check(tab_state(page)["selected"] == ["tab-hosts"], "the location set from outside (the shell) selects the tab")
    page.evaluate("() => { location.hash = '#/nonsense'; }")
    wait_js(page, "document.querySelector('.sb-task')")
    check(tab_state(page)["selected"] == ["tab-tasks"], "an unknown location is the first tab")
    no_problems(page, "tasks, tabs")
    page.context.close()

    page = open_page(browser, "scenario=tasks")
    check(tab_state(page)["selected"] == ["tab-hosts"] and mock(page, "locations") == [], "opened at #/hosts, the board shows that tab")
    page.context.close()

    # in English
    page = open_page(browser, "scenario=tasks&lang=en", tab=None)
    text = page.inner_text("body")
    check(not re.search(r"[äöüÄÖÜß„“]|\b(Nicht|Stand|Achtung|Hinweis|dieser|Verbindung|Seit|Nachweis|Befund)\b", text), "the English tasks have no German")
    got = tasks(page)
    check([x["title"] for x in got] == ["Unreachable", "6379/tcp redis", "5432/tcp postgres", "Failed runs (24 h): 2", "Key locked", "Restart for kernel 6.8.0-49",
                                        "Image Update Monitor is missing", "Security Monitor is missing", "Update Gaps is missing",
                                        "Cron Jobs: no access", "Image Update Monitor: out of date", "Security Monitor: Container hardening partly checked",
                                        "No target profile", "Updates available: 3"],
          "the English titles: " + repr([x["title"] for x in got]))
    missing = next((x for x in got if x["key"] == "localhost/update-gaps/coverage"), {})
    check({k: missing.get(k) for k in ("chips", "detail", "facts", "button")} == {
        "chips": ["expected for role web"], "detail": "Not installed on this host, although its profile expects it.",
        "facts": [["Resolved when", "the add-on is installed on this host and answers in time"]], "button": None},
          "a missing add-on in English: " + repr(missing))
    notice = next((x for x in got if x["key"] == "ci1/profile"), {})
    check(notice.get("group") == "info" and (notice.get("detail") or "").startswith("Without a target profile every installed add-on counts as expected")
          and notice.get("facts") == [["Resolved when", "Host Settings sends a target profile for this host"]],
          "the notice in English: " + repr(notice))
    fresh = [x for x in got if x["key"] == "web1/security/finding:port.5432-tcp"][0]
    check({k: fresh[k] for k in ("isnew", "chips", "facts", "button")} == {
        "isnew": "new", "chips": ["reachable from the internet", "fix available"],
        "facts": [["Since", "20:30"], ["Evidence", "Checked 20:50, complete"], ["Resolved when", "a complete check no longer finds it"]],
        "button": "Open in Security Monitor"}, "a new finding in English: " + repr(fresh))
    check([x["chips"] for x in got if x["key"].endswith("item:updates")] == [["summary only"]], "summary only")
    for word in ("Needs attention", "Hosts and coverage", "6 of 12 expected add-ons checked", "1 partly checked", "3 not installed",
                 "1 host without a target profile", "Accepted", "Not applicable", "Resolved when", "findings unknown", "Open the host"):
        check(word in text, "English: " + word)
    page.click('[data-fold="accepted"] .sb-fold__toggle')
    check(folds(page)[0]["rows"] == [["postgresql-16 is held", "web1", "Update Gaps", "Oct 30, 01:00"]] and
          folds(page)[0]["head"] == ["Finding", "Host", "Add-on", "Accepted until"], "the accepted finding in English: " + repr(folds(page)[0]))
    page.click('[data-fold="notapplicable"] .sb-fold__toggle')
    check(folds(page)[1]["head"] == ["Check", "Host", "Add-on", "Reason", "Set by"] and
          [r[4] for r in folds(page)[1]["rows"]] == ["Add-on", "Target profile"], "who left a check out, in English: " + repr(folds(page)[1]))
    tasks_en, folds_en = tasks(page), folds(page)   # the same with neutral names: scenario demo-tasks, below
    page.click("#tab-hosts")
    line = page.inner_text('[data-host="web1"] .sb-host__coverage .sb-host__figure')
    check(line == "4 of 5 expected add-ons checked · Security Monitor: Container hardening partly checked", "the host's line in English: " + line)
    profiles = page.evaluate("() => Array.from(document.querySelectorAll('.sb-host__profile')).map(p => p.innerText.trim())")
    check(profiles == ["Role web", "No target profile", "Role web"], "roles and the notice in English: " + repr(profiles))
    check("Missing" in tile_text(page, "localhost/security") and "although its profile expects it" in tile_text(page, "localhost/security"),
          "a missing add-on's tile in English: " + tile_text(page, "localhost/security"))
    no_problems(page, "tasks, English")
    page.context.close()

    # the same with neutral names (scenario demo-tasks): the README's screenshot of the tasks
    page = open_page(browser, "scenario=demo-tasks&lang=en", tab=None)
    page.click('[data-fold="accepted"] .sb-fold__toggle')
    page.click('[data-fold="notapplicable"] .sb-fold__toggle')
    got = tasks(page)
    check(got == renamed(page, tasks_en) and folds(page) == renamed(page, folds_en) and recorded_names(page) == []
          and next((x["sub"] for x in got if x["key"] == "locked-host/locked"), None) == "/home/admin/.ssh/id_ed25519",
          "demo-tasks shows the tasks of the scenario tasks with neutral names, and no recorded name: "
          + repr([[x["key"], x["where"], x["sub"]] for x in got]) + " " + repr(recorded_names(page)))
    shot(page, "readme-tasks")
    no_problems(page, "demo-tasks")
    page.context.close()

    # dark, and on a phone
    page = open_page(browser, "scenario=tasks", tab=None, dark=True)
    check(page.evaluate("document.documentElement.classList.contains('pf-v6-theme-dark')"), "the tasks in Cockpit's dark style")
    shot(page, "tasks-dark")
    page.click("#tab-hosts")
    wait_js(page, "document.querySelector('.sb-host__profile')")
    shot(page, "tasks-hosts-dark")
    no_problems(page, "tasks, dark")
    page.context.close()
    page = open_page(browser, "scenario=tasks", tab=None, width=375, height=812)

    def phone(page):
        return page.evaluate("""() => ({ scroll: document.documentElement.scrollWidth,
            low: Array.from(document.querySelectorAll('button')).filter(b => b.getBoundingClientRect().height < 44).map(b => b.id || b.dataset.focus),
            narrow: Array.from(document.querySelectorAll('.sb-task')).filter(t => { const b = t.querySelector('.sb-task__act button');
                return b && Math.abs(b.getBoundingClientRect().width - t.querySelector('.sb-task__main').getBoundingClientRect().width) > 1; })
                .map(t => t.dataset.task) })""")
    layout = phone(page)
    check(layout == {"scroll": 375, "low": [], "narrow": []},
          "the tasks on a phone: no sideways scrolling, controls at least 44 px high, buttons across the card: " + repr(layout))
    page.click('[data-fold="accepted"] .sb-fold__toggle')
    page.click('[data-fold="notapplicable"] .sb-fold__toggle')
    layout = phone(page)
    check(layout == {"scroll": 375, "low": [], "narrow": []}, "the same with the folds open: " + repr(layout))
    shot(page, "tasks-phone")
    page.click("#tab-hosts")
    layout = phone(page)
    check(layout["scroll"] <= 375 and layout["low"] == [],
          "and on the hosts tab with the lines of the checks, the roles and the notice: " + repr(layout))
    shot(page, "tasks-hosts-phone")
    no_problems(page, "tasks, phone")
    page.context.close()

    # ---------- every add-on a host's profile expects, installed or not (scenario expected) ----------
    # board-host's profile (role build) expects Host Settings, Update Gaps and Image Update Monitor:
    # Update Gaps is installed in a version without the status entry, and no host reports it with
    # one; Image Update Monitor is not installed; Cron Jobs, only on web-host, is not expected there.
    def expected_coverage(page):
        lines = dict(page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s => {
            const c = s.querySelector('.sb-host__header + .sb-host__coverage');
            return [s.dataset.host, c ? [(c.querySelector('.sb-host__figure') || {}).innerText || null,
                Array.from(c.querySelectorAll('.sb-host__profile > *')).map(x => [x.className, x.innerText.trim()])] : null]; })"""))
        board = page.evaluate("""() => [document.querySelector('#coverage').hidden, document.querySelector('#coverage .sb-coverage__figure').innerText,
            Array.from(document.querySelectorAll('#coverage .az-label')).map(l => [l.className, l.innerText.trim()])]""")
        return lines, board

    EXPECTED_LINES = {
        "localhost": ["1 of 3 expected add-ons checked · Image Update Monitor: not installed · Update Gaps: not supported",
                      [["sb-chip", "Role build"]]],
        "web-host": ["2 of 2 expected add-ons checked", [[LABEL["info"], "No target profile"]]],
    }
    EXPECTED_BOARD = [False, "3 of 5 expected add-ons checked", [[LABEL["warning"], "1 not installed"], [LABEL["warning"], "1 not supported"],
                                                                 [LABEL["info"], "1 host without a target profile"]]]
    page = open_page(browser, "scenario=expected&lang=en")
    keys = page.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => t.dataset.key)")
    check(rows(page) == ["localhost", "web-host"] and keys == [
        "localhost/cronjobs", "localhost/host-settings", "localhost/image-updates", "localhost/update-gaps",
        "web-host/cronjobs", "web-host/host-settings", "web-host/image-updates"],
          "the expected Update Gaps has a tile, on its own host only: " + repr(keys))
    check(tile_label(page, "localhost/update-gaps") == [LABEL["warning"], "No status", True]
          and "reports no status" in tile_text(page, "localhost/update-gaps") and "Update Gaps" in tile_text(page, "localhost/update-gaps"),
          "expected and installed without the status entry: a warning, named by its manifest: " + tile_text(page, "localhost/update-gaps"))
    check(tile_label(page, "localhost/image-updates") == [LABEL["warning"], "Missing", True], "expected and not installed: missing, a warning")
    check(tile_label(page, "localhost/cronjobs") == [LABEL["none"], "Not installed", True], "not expected and not installed: neutral")
    check(host_label(page, "localhost") == [LABEL["warning"] + " az-label--strong", "Warning"], "the gaps make the row a warning")
    check(expected_coverage(page) == (EXPECTED_LINES, EXPECTED_BOARD),
          "1 of 3 expected add-ons checked on board-host, both gaps named: " + repr(expected_coverage(page)))
    # only what needs attention keeps both gaps and every coverage line
    page.click(".az-switch")
    page.wait_for_timeout(50)
    keys = page.evaluate("() => Array.from(document.querySelectorAll('.sb-tile')).map(t => t.dataset.key)")
    check(page.is_checked("#only-notable") and keys == ["localhost/image-updates", "localhost/update-gaps", "web-host/image-updates"],
          "the switch keeps the expected add-ons that are missing or report no status: " + repr(keys))
    check(expected_coverage(page) == (EXPECTED_LINES, EXPECTED_BOARD),
          "the coverage of the board and of each host stays with the switch: " + repr(expected_coverage(page)))
    shot(page, "expected-hosts")
    no_problems(page, "expected")
    page.context.close()

    page = open_page(browser, "scenario=expected&lang=en", tab=None)
    got = tasks(page)
    check([(x["key"], x["group"], x["label"][1], x["title"]) for x in got] == [
        ("localhost/image-updates/coverage", "warning", "Warning", "Image Update Monitor is missing"),
        ("localhost/update-gaps/coverage", "warning", "Warning", "Update Gaps: not supported"),
        ("web-host/profile", "info", "Notice", "No target profile"),
        ("web-host/image-updates/item:updates", "info", "Notice", "Updates available: 3")],
          "both gaps of board-host are tasks: " + repr([(x["key"], x["label"][1], x["title"]) for x in got]))
    gap = next((x for x in got if x["key"] == "localhost/update-gaps/coverage"), {})
    check({k: gap.get(k) for k in ("where", "chips", "detail", "facts", "button")} == {
        "where": "board-host · Update Gaps", "chips": ["expected for role build"], "detail": "This version of the add-on reports no status.",
        "facts": [["Resolved when", "the add-on answers in time, with every check complete"]], "button": "Open in Update Gaps"},
          "the task of an add-on that reports no status: " + repr(gap))
    task_button(page, "localhost/update-gaps/coverage").click()
    check(mock(page, "jumps") == [["/update-gaps", None]], "it opens Update Gaps on its host: " + json.dumps(mock(page, "jumps")))
    shot(page, "expected-tasks")
    no_problems(page, "expected, tasks")
    page.context.close()

    # ---------- what the suite does not cover yet, and the evidence of an item with findings (scenario limits) ----------
    # Expected values from lib/status.js (buildBoard, buildTasks, coverageSummary) at 2026-10-19
    # 19:00 UTC: this host has the Security Monitor (its list counts one finding and lists none, its
    # check checked at 18:55 UTC), Update Gaps and Image Update Monitor; plain-host has Cron Jobs
    # only. Neither sends a target profile. The five areas are planned scope: no check, no gap, no task.
    AREAS = ["backup", "vulnerabilities", "tls", "drift", "identity"]
    LIMIT_TITLES = {"backup": "Proof of backup and restore", "vulnerabilities": "All known vulnerabilities", "tls": "TLS certificate lifecycle",
                    "drift": "Configuration drift", "identity": "Identity checks"}
    LIMIT_GAPS = {
        "backup": "Nothing proves across the suite that backups exist and that a restore works.",
        "vulnerabilities": "Not every package, image and container is checked for known vulnerabilities.",
        "tls": "Certificates, their expiry and their renewal are not checked.",
        "drift": "Changes against a known configuration are not tracked.",
        "identity": "Accounts, groups and sudo rights are not reviewed."}
    LIMIT_PARTS = {
        "backup": "In part: Image Update Monitor keeps database dumps and image rollbacks from before an update, on this host only.",
        "vulnerabilities": "In part: Update Gaps shows CVE data for selected Ubuntu packages (with its network data).",
        "identity": "In part: Security Monitor shows SSH keys and the logins of the last 14 days."}
    LIMIT_NOTE = "No add-on of the suite checks these areas yet. They count neither as checked nor as gaps, and they create no tasks."
    LIMIT_TOGGLE = "5 areas not covered yet (planned)"
    LIMIT_TASKS = ["localhost/security/item:exposure", "localhost/update-gaps/item:held", "localhost/update-gaps/item:reboot",
                   "localhost/profile", "localhost/image-updates/item:updates", "localhost/update-gaps/item:pro", "plain-host/profile"]

    def limits(page):
        """Each host's fold of what the suite does not cover yet: its toggle, whether it is open, and
        while it is the note and each area (id, title, what is missing, what an add-on covers)."""
        return page.evaluate("""() => Array.from(document.querySelectorAll('.sb-host')).map(s => {
            const f = s.querySelector(':scope > .sb-limits'), b = f && f.querySelector('.sb-limits__toggle');
            return [s.dataset.host, f ? { toggle: b.innerText.trim(), open: b.getAttribute('aria-expanded'),
                note: (f.querySelector('.sb-limits__note') || {}).innerText || null,
                areas: Array.from(f.querySelectorAll('.sb-limits__area')).map(dt => [dt.dataset.area, dt.innerText,
                    dt.nextElementSibling.firstChild.textContent, (dt.nextElementSibling.querySelector('.sb-limits__part') || {}).innerText || null]) }
                : null]; })""")

    def limits_open(parts):
        return {"toggle": LIMIT_TOGGLE, "open": "true", "note": LIMIT_NOTE,
                "areas": [[a, LIMIT_TITLES[a], LIMIT_GAPS[a], LIMIT_PARTS[a] if a in parts else None] for a in AREAS]}

    def limit_counts(page):
        """What counts on the page: the board's figure and labels, each host's figure, the tasks."""
        return page.evaluate("""() => [document.querySelector('#coverage .sb-coverage__figure').innerText,
            Array.from(document.querySelectorAll('#coverage .az-label')).map(l => l.innerText.trim()),
            Array.from(document.querySelectorAll('.sb-host__coverage .sb-host__figure')).map(f => f.innerText),
            document.querySelector('#count-tasks').innerText]""")

    LIMITS_CLOSED = {"toggle": LIMIT_TOGGLE, "open": "false", "note": None, "areas": []}
    page = open_page(browser, "scenario=limits&lang=en", tab=None)
    got = tasks(page)
    check([x["key"] for x in got] == LIMIT_TASKS, "the tasks of the scenario limits, none for an area the suite does not cover: "
          + repr([x["key"] for x in got]))
    item = next((x for x in got if x["key"] == "localhost/security/item:exposure"), {})
    check({k: item.get(k) for k in ("group", "title", "where", "chips", "facts")} == {
        "group": "danger", "title": "Reachable from the internet: 1", "where": "bastion · Security Monitor", "chips": [],
        "facts": [["Evidence", "Checked 20:55, partial"], ["Resolved when", "the add-on rates the entry OK again"]]},
          "an item whose list counts a finding it does not list: its evidence is not complete, although its check is checked: " + repr(item))
    check([x["facts"][0] for x in got if x["key"].startswith("localhost/update-gaps/item:")] == [["Evidence", "Checked 19:02"]] * 3,
          "an item without findings and without a check names no completeness, as before")
    cov = page.evaluate("""() => [Array.from(document.querySelectorAll('#coverage .az-label')).map(l => [l.className, l.innerText.trim()]),
        Array.from(document.querySelectorAll('#coverage .sb-chip')).map(c => [c.className, c.innerText.trim()])]""")
    check(cov == [[[LABEL["info"], "2 hosts without a target profile"], [LABEL["ok"], "Complete"]], [["sb-chip sb-coverage__limits", LIMIT_TOGGLE]]],
          "the board's coverage is complete for the add-ons, and names the areas not covered yet as a neutral chip, not a label: " + repr(cov))
    counted = limit_counts(page)
    check(counted == ["4 of 4 expected add-ons checked", ["2 hosts without a target profile", "Complete"], [], "7"],
          "the areas count in no figure and make no task: " + repr(counted))
    no_problems(page, "limits, tasks")

    page.click("#tab-hosts")
    wait_js(page, "document.querySelector('.sb-limits')")
    check(limits(page) == [["localhost", LIMITS_CLOSED], ["plain-host", LIMITS_CLOSED]],
          "every host that could be read has the fold, closed at first: " + repr(limits(page)))
    before = limit_counts(page)
    check(before[2] == ["3 of 3 expected add-ons checked", "1 of 1 expected add-ons checked"], "each host's figure counts its add-ons only: " + repr(before))
    place = page.evaluate("""() => Array.from(document.querySelectorAll('.sb-limits')).map(f =>
        [f.previousElementSibling.className, f.nextElementSibling.className])""")
    check(place == [["sb-host__coverage", "sb-tiles"]] * 2, "the fold stands below the host's coverage line, above its tiles: " + repr(place))
    page.click('[data-limits="localhost"] .sb-limits__toggle')
    page.focus('[data-limits="plain-host"] .sb-limits__toggle')
    page.keyboard.press("Enter")
    want_limits = [["localhost", limits_open({"backup", "vulnerabilities", "identity"})], ["plain-host", limits_open(set())]]
    check(limits(page) == want_limits, "open: each area with what is missing, and what an add-on on that host covers of it, only there: "
          + repr(limits(page)))
    check(page.evaluate("""() => Array.from(document.querySelectorAll('.sb-limits__toggle')).map(b =>
        [b.getAttribute('aria-controls'), !!document.getElementById(b.getAttribute('aria-controls'))])""") == [["limits-0", True], ["limits-1", True]],
          "each toggle controls its fold")
    check(limit_counts(page) == before and page.evaluate("() => document.querySelectorAll('.sb-limits .az-label, .sb-limits .sb-chip').length") == 0,
          "opening changes no figure, and the fold carries no label of a state")
    page.evaluate("() => document.querySelector('#refresh').click()")
    wait_idle(page)
    check(limits(page) == want_limits and page.evaluate("document.activeElement.dataset.focus") == "limits:plain-host",
          "open folds stay open when the board loads again, the focus stays on the toggle")
    page.click(".az-switch")
    page.wait_for_timeout(50)
    check(limits(page) == want_limits and page.evaluate("""() => document.querySelector('[data-host="plain-host"] .sb-note').innerText""") == "Nothing that needs attention.",
          "only what needs attention keeps the folds, also on a host left without tiles")
    shot(page, "limits-hosts")
    page.click(".az-switch")
    no_problems(page, "limits, hosts")
    page.context.close()

    # in German, dark, and on a phone
    page = open_page(browser, "scenario=limits", tab=None)
    item = next((x for x in tasks(page) if x["key"] == "localhost/security/item:exposure"), {})
    check(item.get("facts") == [["Nachweis", "Stand 20:55, teilweise"], ["Behoben, wenn", "das Add-on den Eintrag wieder als in Ordnung bewertet"]],
          "the evidence of the item in German: " + repr(item.get("facts")))
    check(page.inner_text("#coverage .sb-coverage__limits") == "5 Bereiche noch nicht abgedeckt (geplant)", "the chip in German")
    page.click("#tab-hosts")
    page.click('[data-limits="localhost"] .sb-limits__toggle')
    de = dict(limits(page))["localhost"]
    check(de["toggle"] == "5 Bereiche noch nicht abgedeckt (geplant)" and [a[1] for a in de["areas"]] == [
        "Nachweis von Sicherung und Wiederherstellung", "Alle bekannten Schwachstellen", "Lebenszyklus der TLS-Zertifikate", "Konfigurationsdrift",
        "Prüfung von Identitäten"] and de["note"].startswith("Diese Bereiche prüft noch kein Add-on der Suite.")
          and de["areas"][1][3] == "Teilweise: Update Gaps zeigt CVE-Daten für ausgewählte Ubuntu-Pakete (mit seinen Netzdaten).",
          "the fold in German: " + repr(de))
    shot(page, "limits-hosts-de")
    no_problems(page, "limits, German")
    page.context.close()
    page = open_page(browser, "scenario=limits&lang=en", dark=True)
    page.click('[data-limits="localhost"] .sb-limits__toggle')
    check(page.evaluate("document.documentElement.classList.contains('pf-v6-theme-dark')") and len(dict(limits(page))["localhost"]["areas"]) == 5,
          "the fold in Cockpit's dark style")
    shot(page, "limits-hosts-dark")
    no_problems(page, "limits, dark")
    page.context.close()
    page = open_page(browser, "scenario=limits", width=375, height=812)
    for host in ("localhost", "plain-host"):
        page.click(f'[data-limits="{host}"] .sb-limits__toggle')
    layout = page.evaluate("""() => ({ scroll: document.documentElement.scrollWidth,
        low: Array.from(document.querySelectorAll('button')).filter(b => b.getBoundingClientRect().height < 44).map(b => b.id || b.dataset.focus || b.dataset.key),
        wide: Array.from(document.querySelectorAll('.sb-limits, .sb-limits *, .sb-coverage__limits')).filter(e => e.getBoundingClientRect().right > 375).length,
        stacked: Array.from(document.querySelectorAll('[data-limits="localhost"] .sb-limits__area')).every(dt =>
            dt.nextElementSibling.getBoundingClientRect().top >= dt.getBoundingClientRect().bottom - 1) })""")
    check(layout == {"scroll": 375, "low": [], "wide": 0, "stacked": True},
          "the folds on a phone: no sideways scrolling, toggles at least 44 px high, each area above its text: " + repr(layout))
    shot(page, "limits-phone")
    no_problems(page, "limits, phone")
    page.context.close()

    # the hosts tab of scenario demo-tasks, with the target profiles and web1's fold open: the
    # README's screenshot of the coverage (web1 has Image Update Monitor, Update Gaps and Security Monitor)
    page = open_page(browser, "scenario=demo-tasks&lang=en")
    page.click('[data-limits="web1"] .sb-limits__toggle')
    demo = dict(limits(page))
    check(demo.get("web1") == limits_open({"backup", "vulnerabilities", "identity"}) and demo.get("ci1") == LIMITS_CLOSED
          and demo.get("old-host") is None and recorded_names(page) == []
          and page.inner_text("#coverage .sb-coverage__figure") == "6 of 12 expected add-ons checked",
          "demo-tasks: web1's fold open, the others closed, none for a host not read, the figure as before: " + repr(demo))
    shot(page, "readme-coverage")
    no_problems(page, "demo-tasks, hosts")
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
