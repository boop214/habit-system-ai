"""PWA test: manifest, service worker, asset accessibility and real offline boot.

Verifies the application can be installed (manifest + SW reachable) and that
it boots offline after a first online visit, with IndexedDB data preserved.
"""
import io
import json
import os
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from flask import Flask, send_from_directory

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(BASE, "static")
PORT = 5562

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC, filename)


@app.route("/service-worker.js")
def service_worker():
    resp = send_from_directory(STATIC, "service-worker.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


def run_server():
    app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False)


def http_get(path):
    url = "http://127.0.0.1:%d%s" % (PORT, path)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, dict(r.headers), r.read()


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    server = threading.Thread(target=run_server, daemon=True)
    server.start()
    time.sleep(2)

    passed = [0]
    failed = [0]
    errors = []

    def check(condition, msg):
        if condition:
            passed[0] += 1
            print("  PASS " + msg)
        else:
            failed[0] += 1
            errors.append(msg)
            print("  FAIL " + msg)

    # ---- 1. Manifest reachable + valid ----
    print("\n=== Manifest ===")
    try:
        status, headers, body = http_get("/static/manifest.webmanifest")
        check(status == 200, "manifest status 200")
        manifest = json.loads(body.decode("utf-8"))
        check(bool(manifest.get("name")), "manifest has name")
        check(bool(manifest.get("short_name")), "manifest has short_name")
        check(manifest.get("start_url") == "/", "manifest start_url '/'")
        check(manifest.get("display") == "standalone", "manifest display standalone")
        check(bool(manifest.get("theme_color")), "manifest theme_color")
        check(bool(manifest.get("background_color")), "manifest background_color")
        icons = manifest.get("icons", [])
        sizes = {i.get("sizes") for i in icons}
        check("192x192" in sizes, "icon 192x192 present")
        check("512x512" in sizes, "icon 512x512 present")
        check(any(i.get("purpose") == "maskable" for i in icons), "maskable icon present")
        for icon in icons:
            st, _, _ = http_get(icon["src"])
            check(st == 200, "icon reachable: " + icon["src"])
    except Exception as e:
        check(False, "manifest load error: " + str(e))

    # ---- 2. Service worker reachable ----
    print("\n=== Service Worker ===")
    try:
        status, headers, body = http_get("/service-worker.js")
        check(status == 200, "service-worker.js status 200")
        ctype = (headers.get("Content-Type") or "").lower()
        check("javascript" in ctype, "service-worker.js content-type js (" + ctype + ")")
    except Exception as e:
        check(False, "service-worker load error: " + str(e))

    # ---- 3. Core assets reachable ----
    print("\n=== App assets ===")
    for asset in [
        "/static/css/styles.css",
        "/static/js/periods.js",
        "/static/js/db.js",
        "/static/js/stats.js",
        "/static/js/obstacles.js",
        "/static/js/semantics.js",
        "/static/js/identity.js",
        "/static/js/seed.js",
        "/static/js/services.js",
        "/static/js/api.js",
        "/static/js/format.js",
        "/static/js/charts.js",
        "/static/js/app.js",
    ]:
        try:
            st, _, _ = http_get(asset)
            check(st == 200, "asset reachable: " + asset)
        except Exception as e:
            check(False, "asset error " + asset + ": " + str(e))

    # ---- 4. Boot online, register SW, load data, then go offline ----
    print("\n=== Offline boot (Playwright) ===")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        page.goto("http://127.0.0.1:%d/" % PORT, wait_until="networkidle")
        time.sleep(1)

        check("Habit" in page.title(), "app title online: " + page.title())

        # Service worker registered + activated
        try:
            page.wait_for_function(
                "navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r => r !== null)",
                timeout=10000,
            )
            reg = page.evaluate("navigator.serviceWorker.getRegistration().then(r => r ? r.scope : null)")
            check(reg is not None and reg.endswith("/"), "SW registered, scope=" + str(reg))
            page.wait_for_function("navigator.serviceWorker.ready.then(() => true)", timeout=10000)
            check(True, "SW active/ready")
        except Exception as e:
            check(False, "SW registration failed: " + str(e))

        # Populate IndexedDB online
        r = page.evaluate("api.loadDemo()")
        check(r.get("created") == 4, "demo loaded online (" + str(r.get("created")) + ")")
        count_online = page.evaluate("api.listHabits().then(h => h.length)")
        check(count_online == 4, "habits persisted online: " + str(count_online))

        # Cache should contain the app shell
        cached = page.evaluate(
            "caches.keys().then(keys => Promise.all(keys.map(k => caches.open(k).then(c => c.match('/').then(x => !!x))))).then(arr => arr.some(Boolean))"
        )
        check(cached, "app shell cached in CacheStorage")

        # ---- Go offline and reload ----
        context.set_offline(True)
        time.sleep(1)
        reloaded_ok = True
        try:
            page.reload(wait_until="domcontentloaded", timeout=15000)
        except Exception as e:
            reloaded_ok = False
            check(False, "offline reload threw: " + str(e))
        if reloaded_ok:
            try:
                page.wait_for_function("typeof api !== 'undefined'", timeout=10000)
                check("Habit" in page.title(), "app title offline: " + page.title())
                modules = ["periods", "habitDB", "stats", "obstacles", "semantics",
                           "identity", "seed", "services", "api"]
                allmods = all(page.evaluate("typeof " + m + " !== 'undefined'") for m in modules)
                check(allmods, "all JS modules loaded offline")
                count_offline = page.evaluate("api.listHabits().then(h => h.length)")
                check(count_offline == 4, "habits preserved offline via IndexedDB: " + str(count_offline))
                detail = page.evaluate("(async () => { const h = await api.listHabits(); return api.getHabit(h[0].id); })()")
                check("stats" in detail, "habit detail works offline")
            except Exception as e:
                check(False, "offline boot assertion error: " + str(e))

        real_errors = [e for e in console_errors if "favicon" not in e.lower()]
        check(len(real_errors) == 0, "no console errors offline (" + str(len(real_errors)) + ")")
        for e in real_errors[:5]:
            print("    " + e)

        context.set_offline(False)
        browser.close()

    print("\n" + "=" * 60)
    print(str(passed[0]) + " passed, " + str(failed[0]) + " failed (" + str(passed[0] + failed[0]) + " total)")
    print("=" * 60)
    if failed[0] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
