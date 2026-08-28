"""Launch a temporary Flask server to run the db.js IndexedDB test suite.

Usage:
    python tests/run_db_tests.py

Opens http://127.0.0.1:5555/tests/test_db.html in your default browser.
The server shuts down when you close the browser tab (press Ctrl+C).
"""
import os
import sys
import webbrowser
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, send_from_directory

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE, "tests"), "test_db.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(BASE, "static"), filename)


@app.route("/tests/<path:filename>")
def test_files(filename):
    return send_from_directory(os.path.join(BASE, "tests"), filename)


if __name__ == "__main__":
    url = "http://127.0.0.1:5555"
    print(f"Starting test server at {url}")
    print("Open the URL above in your browser to run the db.js tests.")
    print("Press Ctrl+C to stop.\n")
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=5555, debug=False)
