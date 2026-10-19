# SPDX-License-Identifier: Apache-2.0
"""End-to-end test of Status Board against a real Cockpit, with SSH.

The browser tests (test/ui_test.py) imitate Cockpit with a stand-in. This test checks against the
real Cockpit what docs/INTERNALS.md derives from its code:
  - the host switcher's list comes from the bridge (/etc/cockpit/machines.d);
  - the echo channel, find, the manifests, the status verb and the host name reach another host
    through the bridge over SSH, without administrative access there;
  - all of that, Refresh and the shell's own connection to the host share one SSH connection;
  - a key that is encrypted and not in the agent shows as "Key locked", a closed port as
    "Unreachable";
  - a click on a tile opens the add-on on its host at the key item's link; for a host the shell
    is not connected to yet, after the shell asks.

The other hosts are this machine under other names. It changes the machine, so the job e2e in
.github/workflows/test.yml sets it up on the runner's throwaway VM:
  - Cockpit (cockpit-ws, cockpit-bridge, cockpit-system) with src/ as
    /usr/share/cockpit/status-board and "AllowMultiHost = true" in /etc/cockpit/cockpit.conf, run
    as this user, with the ssh-agent below and without login:
      cockpit-ws --no-tls --port 9091 --address 127.0.0.1 --local-session=cockpit-bridge
  - the add-on test/e2e/addon as /usr/share/cockpit/e2e, its status verb as
    /usr/lib/cockpit-e2e/status;
  - e2e-peer, e2e-locked and e2e-closed as 127.0.0.1 in /etc/hosts, and test/e2e/99-webui.json
    in /etc/cockpit/machines.d: e2e-peer:2022, e2elocked@e2e-locked:2022 and e2e-closed:2023;
  - an SSH server with test/e2e/sshd_config on 127.0.0.1:2022 that logs to $RUNNER_TEMP/sshd.log
    (readable by this user): this user logs in with a key that is only in the ssh-agent, the user
    e2elocked only with the encrypted key ~/.ssh/id_ed25519, which is not in the agent; nothing
    listens on port 2023; the host keys of e2e-peer and e2e-locked are in ~/.ssh/known_hosts.
Run: python3 test/e2e_cockpit.py   (screenshots go to test/shots/)"""
import getpass
import os
import subprocess
import sys
import time
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

here = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(here, "shots")
os.makedirs(SHOTS, exist_ok=True)
ROOT = os.environ.get("COCKPIT_URL", "http://127.0.0.1:9091")
SSH_PORT = "2022"
SSHD_LOG = os.environ.get("E2E_SSHD_LOG", os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "sshd.log"))
MACHINES = "/etc/cockpit/machines.d/99-webui.json"
USER = getpass.getuser()
LOCKED_KEY = os.path.expanduser("~/.ssh/id_ed25519")
BOARD = 'iframe[name="cockpit1:localhost/status-board"]'


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


if not os.path.exists("/usr/lib/cockpit-e2e/status") or '"e2e-peer"' not in read(MACHINES):
    sys.exit("needs the setup of the job e2e in .github/workflows/test.yml (see the top of this file)")
HOSTNAME = read("/proc/sys/kernel/hostname").strip()

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
            print("::error title=End-to-end test::" + msg.replace("\n", " ")[:900])


def wait_js(target, expr, timeout=30):
    """True once expr holds in the page or frame, False after timeout seconds. Cockpit's CSP
    blocks the eval behind wait_for_function, so this polls with evaluate."""
    end = time.time() + timeout
    while time.time() < end:
        if target.evaluate("() => !!(" + expr + ")"):
            return True
        target.wait_for_timeout(100)
    return False


def visible(locator, timeout):
    try:
        locator.first.wait_for(state="visible", timeout=timeout * 1000)
        return True
    except PlaywrightTimeout:
        return False


def shell_frame(page, selector, timeout=30):
    """The shell's iframe that matches selector, once it has loaded (the shell sets data-loaded),
    as a Playwright frame; None when it does not come within timeout seconds."""
    try:
        el = page.wait_for_selector(selector + "[data-loaded]", state="attached", timeout=timeout * 1000)
    except PlaywrightTimeout:
        return None
    return page.frame(name=el.get_attribute("name"))


def wait_idle(b, timeout=60):
    """True once the board has loaded every host (Refresh is enabled again)."""
    done = wait_js(b, "document.querySelector('#refresh') && !document.querySelector('#refresh').disabled", timeout)
    b.wait_for_timeout(300)
    return done


def rows(b):
    return b.evaluate("() => Array.from(document.querySelectorAll('.sb-host')).map(s => s.dataset.host)")


def head(b, host):
    """The row's name and the line next to it (the connection, or "this host")."""
    return b.evaluate("""h => { const s = document.querySelector('[data-host="' + h + '"] .sb-host__header');
        if (!s) return null;
        const m = s.querySelector('.az-meta');
        return [s.querySelector('h2').innerText.trim(), m ? m.innerText.trim() : null]; }""", host)


def tiles(b, host):
    return b.evaluate("""h => Array.from(document.querySelectorAll('[data-host="' + h + '"] .sb-tile'))
        .map(t => t.dataset.key)""", host)


def tile_text(b, key):
    return b.evaluate("""k => { const t = document.querySelector('[data-key="' + k + '"]');
        return t ? t.innerText : ''; }""", key)


def tile_word(b, key):
    return b.evaluate("""k => { const l = document.querySelector('[data-key="' + k + '"] .sb-tile__head .az-label');
        return l ? l.innerText.trim() : null; }""", key)


def tile_value(b, key):
    return b.evaluate("""k => { const v = document.querySelector('[data-key="' + k + '"] .sb-tile__value');
        return v ? v.innerText.trim() : null; }""", key)


def oneline(text):
    return " | ".join(line.strip() for line in str(text).splitlines() if line.strip())


def ssh_connections():
    """The TCP connections to the test's SSH server that are open now (the client's side of each)."""
    out = subprocess.run(["ss", "-Htn", "state", "established", f"( dport = :{SSH_PORT} )"],
                         capture_output=True, text=True).stdout
    return len([line for line in out.splitlines() if line.strip()])


def ssh_logins(user):
    """How many logins of user the test's SSH server has accepted so far."""
    return read(SSHD_LOG).count(f"Accepted publickey for {user} ")


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)


def open_here(page, b):
    """A click on this host's tile opens the add-on in the shell, at the key item's link. Returns
    the board again (the add-on jumps back to it), or None."""
    if not tile_word(b, "localhost/e2e"):
        check(False, "no tile of the test add-on on this host to click")
        return b
    b.click('[data-key="localhost/e2e"]')
    check(wait_js(page, "location.pathname === '/e2e'", 15), "the shell goes to the add-on: " + page.url)
    url = urlsplit(page.url)
    check(url.path == "/e2e" and url.fragment == "/probe", "on this host, at #/probe: " + page.url)
    f = shell_frame(page, 'iframe[name="cockpit1:localhost/e2e"]')
    probe = f.evaluate("() => (document.querySelector('#probe') || {}).innerText") if f else None
    check(f is not None and "#/probe" in f.url and probe == "E2E Probe", "the add-on's page: " + (f.url if f else "no frame"))
    shot(page, "e2e-addon-here")
    if f is not None:
        f.evaluate("() => cockpit.jump('/status-board')")
    else:
        page.goto(ROOT + "/status-board")
    check(wait_js(page, "location.pathname === '/status-board'", 15), "back on the board: " + page.url)
    b = shell_frame(page, BOARD)
    return b if b is not None and wait_idle(b) else None


def open_on_peer(page, b):
    """A click on e2e-peer's tile: the shell asks before it connects to a host it is not connected
    to yet, then opens the add-on there, over the board's SSH connection."""
    if not tile_word(b, "e2e-peer/e2e"):
        check(False, "no tile of the test add-on on e2e-peer to click")
        return
    b.click('[data-key="e2e-peer/e2e"]')
    check(wait_js(page, "location.pathname.startsWith('/@e2e-peer')", 15), "the shell goes to the add-on on e2e-peer: " + page.url)
    url = urlsplit(page.url)
    check(url.path == "/@e2e-peer/e2e" and url.fragment == "/probe", "on e2e-peer, at #/probe: " + page.url)
    dialog = page.locator("#hosts_connect_server_dialog")
    asked = visible(dialog, 20)
    if not asked and visible(page.locator("#machine-troubleshoot"), 1):
        print("the shell shows a button to connect instead of asking")
        page.click("#machine-troubleshoot")
        asked = visible(dialog, 10)
    check(asked, "the shell asks before it connects to a host it is not connected to yet (Connect to …?)")
    if asked:
        print("the shell asks:", oneline(dialog.first.inner_text()))
        shot(page, "e2e-connect")
        dialog.first.locator("button.pf-m-warning").first.click()
    rf = shell_frame(page, 'iframe[name^="cockpit1:e2e-peer"][name$="/e2e"]', 45)
    probe = rf.evaluate("() => (document.querySelector('#probe') || {}).innerText") if rf else None
    check(rf is not None and "#/probe" in rf.url and probe == "E2E Probe",
          "the add-on's page from e2e-peer, at #/probe: " + (rf.name + " " + rf.url if rf else "no frame"))
    page.wait_for_timeout(500)
    open_now, new = ssh_connections(), ssh_logins(USER) - logins
    check(open_now == 1 and new == 1, f"the shell uses the board's SSH connection to e2e-peer: {open_now} open, {new} login(s)")
    shot(page, "e2e-addon-on-peer")


logins = ssh_logins(USER)
check(logins >= 1, "the SSH server's log has the job's test login, so that logins can be counted: " + SSHD_LOG)
check(ssh_connections() == 0, "no SSH connection before the board opens")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
    ctx.add_cookies([{"name": "CockpitLang", "value": "en-us", "url": ROOT + "/"}])
    page = ctx.new_page()
    # Errors and failed loads of the board's own files; the shell's are not this test's business.
    problems = []

    def board_file(where):
        return "/status-board/" in (where or "")

    page.on("console", lambda m: problems.append(m.text) if m.type == "error" and board_file(m.location.get("url")) else None)
    page.on("pageerror", lambda e: problems.append("pageerror: " + str(e)) if board_file(e.stack) else None)
    page.on("response", lambda r: problems.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and board_file(r.url) else None)

    # ---------- the board in Cockpit's shell ----------
    started = time.time()
    page.goto(ROOT + "/status-board")
    b = shell_frame(page, BOARD)
    if b is None:
        shot(page, "e2e-no-board")
        sys.exit("the shell did not load Status Board (frame cockpit1:localhost/status-board)")
    check(wait_idle(b), "the board has loaded every host within 60 seconds")
    print(f"board loaded in {time.time() - started:.1f} s")

    # the host switcher's list, from the bridge
    r = rows(b)
    check(r[:1] == ["localhost"] and sorted(r[1:]) == ["e2e-closed", "e2e-locked", "e2e-peer"],
          "this host first, then the hosts of machines.d: " + repr(r))
    alerts = b.inner_text("#alerts").strip()
    check(alerts == "", "no alert about the host list: " + alerts)
    meta = b.inner_text("#meta")
    check(meta.endswith(" · 4 hosts"), "the header counts the hosts: " + meta)

    # this host: its manifests from cockpit.manifests, the status verb run here
    check(head(b, "localhost") == [HOSTNAME, "this host"], "this host's row: " + repr(head(b, "localhost")))
    check(tiles(b, "localhost") == ["localhost/e2e"], "this host has the test add-on: " + repr(tiles(b, "localhost")))
    t = tile_text(b, "localhost/e2e")
    print("this host's tile:", oneline(t))
    check(tile_word(b, "localhost/e2e") == "Notice" and "E2E Probe" in t and "without SSH (en)" in t,
          "the add-on's answer on this host, asked in English: " + oneline(t))

    # e2e-peer: the echo channel, find, the manifests, the host name and the status verb over SSH
    check(head(b, "e2e-peer") == [HOSTNAME, "e2e-peer:2022"],
          "named by the host name read there (else it would be the key), next to the switcher's connection string: "
          + repr(head(b, "e2e-peer")))
    check(tiles(b, "e2e-peer") == ["e2e-peer/e2e"], "find and the manifests there give the test add-on: " + repr(tiles(b, "e2e-peer")))
    t = tile_text(b, "e2e-peer/e2e")
    print("e2e-peer's tile:", oneline(t))
    check(tile_word(b, "e2e-peer/e2e") == "Notice" and f"Ran as {USER} over SSH to port {SSH_PORT} (en)" in t,
          "the status verb ran there over SSH, as the SSH user, without administrative access: " + oneline(t))
    check(tile_value(b, "e2e-peer/e2e") == "1" and "Probe answers" in t, "with the key figure of its answer: " + oneline(t))

    # e2e-locked: the only key it takes is encrypted and not in the agent
    check(head(b, "e2e-locked") == ["e2e-locked", "e2elocked@e2e-locked:2022"], "the locked host's row: " + repr(head(b, "e2e-locked")))
    t = tile_text(b, "e2e-locked/locked")
    check(tile_word(b, "e2e-locked/locked") == "Key locked" and LOCKED_KEY in t,
          "the bridge's close options say 'locked identity: " + LOCKED_KEY + "', the board shows Key locked: " + oneline(t))

    # e2e-closed: nothing listens on its port
    t = tile_text(b, "e2e-closed/unreachable")
    check(tile_word(b, "e2e-closed/unreachable") == "Unreachable", "a closed port is Unreachable: " + oneline(t))
    check("The host cannot be reached." in t and "Connection refused" in t,
          "with Cockpit's reason (no-host) and the system's message: " + oneline(t))

    # one SSH connection to e2e-peer for all of it, also after Refresh; never a login with the locked key
    b.wait_for_timeout(500)
    open_now, new = ssh_connections(), ssh_logins(USER) - logins
    check(open_now == 1 and new == 1, f"one SSH connection and one login for everything on e2e-peer: {open_now} open, {new} login(s)")
    for _ in range(2):
        b.click("#refresh")
        check(wait_idle(b), "Refresh loads every host again within 60 seconds")
    words = [tile_word(b, k) for k in ("e2e-peer/e2e", "e2e-locked/locked", "e2e-closed/unreachable")]
    check(words == ["Notice", "Key locked", "Unreachable"], "the same after Refresh: " + repr(words))
    b.wait_for_timeout(500)
    open_now, new = ssh_connections(), ssh_logins(USER) - logins
    check(open_now == 1 and new == 1, f"Refresh uses the same connection: {open_now} open, {new} login(s)")
    check(ssh_logins("e2elocked") == 0, "the encrypted key never logged in")
    shot(page, "e2e-board")

    # ---------- a click opens the add-on on its host, at the key item's link ----------
    b = open_here(page, b)
    check(b is not None, "the board comes back when the add-on jumps to it")
    if b is not None:
        open_on_peer(page, b)

    check(not problems, "no errors from the board's files: " + repr(problems))
    browser.close()

print(f"\n{passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
