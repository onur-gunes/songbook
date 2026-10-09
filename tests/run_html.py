#!/usr/bin/env python3
"""Run a browser test page (which sets window.__done and a <title>) via CDP.

Usage:
    python3 -m http.server 8777 &
    python3 tests/run_html.py http://localhost:8777/tests/e2e.html
"""
import re
import sys
import time

from cdp import launch_chrome, new_tab, CDP

URL = sys.argv[1]
PORT = 9338


def main():
    proc, _ = launch_chrome(PORT)
    try:
        target = new_tab(PORT, URL)
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        cdp.send('Page.navigate', {'url': URL})
        deadline = time.time() + 300
        while time.time() < deadline:
            if cdp.eval('window.__done === true'):
                break
            time.sleep(0.4)
        else:
            print('TIMEOUT waiting for __done')
            return 2

        title = cdp.eval('document.title') or ''
        log = cdp.eval("(document.getElementById('log')||{}).textContent || ''") or ''
        cdp.close()

        print('title:', title)
        if log.strip() and log.strip() != 'pending':
            print(log)
        return 0 if (title.startswith('DONE') or title.startswith('PASS')) else 1
    finally:
        proc.terminate()


if __name__ == '__main__':
    sys.exit(main())
