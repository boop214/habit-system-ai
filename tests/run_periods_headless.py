"""Run periods.js tests headlessly via Playwright.

Usage: python tests/run_periods_headless.py
"""
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, send_from_directory

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE, "tests"), "test_periods.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(BASE, "static"), filename)


def run_server():
    app.run(host="127.0.0.1", port=5558, debug=False, use_reloader=False)


if __name__ == "__main__":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    server = threading.Thread(target=run_server, daemon=True)
    server.start()
    time.sleep(2)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://127.0.0.1:5558", wait_until="networkidle")

        # Wait for tests to finish
        page.wait_for_function(
            "document.getElementById('summary').textContent.length > 0",
            timeout=15000,
        )

        # Get results
        summary = page.inner_text("#summary")
        log = page.inner_text("#log")

        print(log)
        print()
        print("=" * 60)
        print(summary)
        print("=" * 60)

        # Check for failures
        if "failed" in summary.lower() and "0 failed" not in summary.lower():
            sys.exit(1)

        browser.close()
