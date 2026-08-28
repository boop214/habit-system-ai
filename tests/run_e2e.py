"""E2E test: verify app works through IndexedDB (no Flask API)."""
import io, os, sys, threading, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from flask import Flask, send_from_directory

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, static_folder=None)

@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE, "static"), "index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(BASE, "static"), filename)

@app.route("/service-worker.js")
def service_worker():
    resp = send_from_directory(os.path.join(BASE, "static"), "service-worker.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp

def run_server():
    app.run(host="127.0.0.1", port=5561, debug=False, use_reloader=False)

if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    server = threading.Thread(target=run_server, daemon=True)
    server.start()
    time.sleep(2)

    from playwright.sync_api import sync_playwright

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

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto("http://127.0.0.1:5561", wait_until="networkidle")
        time.sleep(2)

        print("\n=== App Loading ===")
        check("Habit" in page.title(), "App title: " + page.title())

        print("\n=== JS Modules ===")
        for mod in ["periods", "habitDB", "stats", "obstacles", "semantics", "identity", "seed", "services", "api"]:
            check(page.evaluate("typeof " + mod + " !== 'undefined'"), mod + " loaded")

        print("\n=== Demo Data ===")
        r = page.evaluate("api.loadDemo()")
        check(r["created"] == 4, "Demo: " + str(r["created"]) + " habits")

        print("\n=== Habits CRUD ===")
        habits = page.evaluate("api.listHabits()")
        check(len(habits) == 4, "Listed " + str(len(habits)) + " habits")
        hid = habits[0]["id"]
        detail = page.evaluate("api.getHabit(" + str(hid) + ")")
        check("stats" in detail and "events" in detail and "charts" in detail, "getHabit detail")
        new_h = page.evaluate("api.createHabit({name:'Test',type:'boolean',frequency_type:'weekly',frequency_target:3,start_date:'2026-01-01'})")
        check(new_h["id"] > 0, "Created habit id=" + str(new_h["id"]))
        uid = new_h["id"]
        page.evaluate("api.updateHabit(" + str(uid) + ",{name:'Updated'})")
        ev = page.evaluate("api.createEvent(" + str(uid) + ",{occurred_at:'2026-08-28T10:00',value:1})")
        check(ev["id"] > 0, "Created event id=" + str(ev["id"]))
        page.evaluate("api.deleteHabit(" + str(uid) + ")")
        remaining = page.evaluate("api.listHabits()")
        check(len(remaining) == 4, "After delete: " + str(len(remaining)))

        print("\n=== Identities ===")
        ids = page.evaluate("api.listIdentities()")
        check(len(ids) >= 4, "Listed " + str(len(ids)) + " identities")
        idet = page.evaluate("api.getIdentity(" + str(ids[0]["id"]) + ")")
        check("votes" in idet, "getIdentity returns votes")

        print("\n=== Stats ===")
        gs = page.evaluate("api.globalStats()")
        check("total_habits" in gs and gs["total_habits"] >= 4, "globalStats ok")

        print("\n=== Settings ===")
        th = page.evaluate("api.getTheme()")
        check("theme" in th, "getTheme ok")
        page.evaluate("api.saveTheme({theme:'dark'})")
        th2 = page.evaluate("api.getTheme()")
        check(th2["theme"] == "dark", "Theme persisted")

        print("\n=== Notes ===")
        page.evaluate("api.saveNote('2026-08-28',{content:'Test note'})")
        n = page.evaluate("api.getNote('2026-08-28')")
        check(n["content"] == "Test note", "Note persisted")

        print("\n=== State ===")
        st = page.evaluate("api.state()")
        check(st["has_habits"] and st["has_demo"], "State ok")

        print("\n=== Console Errors ===")
        real = [e for e in console_errors if "favicon" not in e.lower()]
        check(len(real) == 0, "No JS errors (" + str(len(real)) + " found)")
        for e in real[:5]:
            print("    " + e)

        print("\n" + "=" * 60)
        print(str(passed[0]) + " passed, " + str(failed[0]) + " failed (" + str(passed[0] + failed[0]) + " total)")
        print("=" * 60)
        browser.close()

    if failed[0] > 0:
        sys.exit(1)
