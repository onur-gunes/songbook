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
        # Open the tab blank and navigate once. Opening it on URL and then
        # calling Page.navigate loaded the page twice: the first load could
        # already have set __done, so the poll below could observe a finished
        # run while the second navigation was replacing the document, and
        # read the title off the wrong one.
        target = new_tab(PORT, 'about:blank')
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

        # Read the results in the same evaluation that re-checks __done, so a
        # late navigation cannot swap the document between the two reads.
        res = cdp.eval(
            "(function () {"
            "  if (window.__done !== true) return null;"
            "  var l = document.getElementById('log');"
            "  return { title: document.title || '',"
            "           log: (l && l.textContent) || '' };"
            "})()")
        if not res:
            print('page was replaced before results could be read')
            return 2
        title = res.get('title') or ''
        log = res.get('log') or ''
        cdp.close()

        print('title:', title)
        if log.strip() and log.strip() != 'pending':
            print(log)
        return 0 if (title.startswith('DONE') or title.startswith('PASS')) else 1
    finally:
        proc.terminate()


if __name__ == '__main__':
    sys.exit(main())
