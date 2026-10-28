"""Minimal Chrome DevTools Protocol driver for the Songbook test suite.

Requires: websocket-client (pip). Starts a headless Chrome on a remote
debugging port and lets tests navigate the page, evaluate JS, and surface
console errors / uncaught exceptions without relying on flaky virtual time.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import websocket

# Where Chrome lives, per platform. macOS keeps it in /Applications; Linux
# (and CI runners) put a binary on PATH under one of several names. Override
# with CHROME_PATH when Chrome is somewhere non-standard.
_MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
_CHROME_NAMES = (
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'chrome',
)


def chrome_binary():
    """Locate a headless-capable Chrome/Chromium for this machine."""
    env = os.environ.get('CHROME_PATH')
    if env:
        if os.path.exists(env) or shutil.which(env):
            return env
        raise RuntimeError('CHROME_PATH is set but not usable: %s' % env)

    if sys.platform == 'darwin' and os.path.exists(_MAC_CHROME):
        return _MAC_CHROME

    for name in _CHROME_NAMES:
        found = shutil.which(name)
        if found:
            return found

    if os.path.exists(_MAC_CHROME):
        return _MAC_CHROME

    raise RuntimeError(
        'No Chrome/Chromium found. Install Google Chrome, or set CHROME_PATH '
        'to the browser binary. Looked for: %s' % ', '.join(_CHROME_NAMES))


class ChromeStartupError(RuntimeError):
    """Chrome did not expose its devtools endpoint in time."""


# How long to wait for Chrome's devtools endpoint to start listening, and how
# many times to retry. Each retry gets a proportionally longer budget (30s,
# then 60s, then 90s), so a briefly contended runner recovers instead of
# failing the whole suite. Override with CHROME_STARTUP_TIMEOUT /
# CHROME_STARTUP_ATTEMPTS.
_STARTUP_TIMEOUT = float(os.environ.get('CHROME_STARTUP_TIMEOUT', '30'))
_STARTUP_ATTEMPTS = int(os.environ.get('CHROME_STARTUP_ATTEMPTS', '3'))


def _launch_once(port, user_data_dir, timeout):
    import tempfile
    user_data_dir = user_data_dir or tempfile.mkdtemp(prefix='songbook-cdp-')
    argv = [
        chrome_binary(),
        '--headless=new',
        '--remote-debugging-port=%d' % port,
        '--remote-allow-origins=*',
        '--user-data-dir=' + user_data_dir,
        '--no-first-run',
        '--no-default-browser-check',
    ]
    # CI containers run as root without a usable sandbox; these flags are
    # required there and harmless on a desktop.
    if os.environ.get('CHROME_NO_SANDBOX'):
        argv += ['--no-sandbox', '--disable-dev-shm-usage']
    argv.append('about:blank')
    # Keep Chrome's own output so a startup failure can report why, rather
    # than just "did not come up".
    proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE)
    deadline = time.time() + timeout
    while time.time() < deadline:
        # If Chrome died (bad flag, missing sandbox, OOM) there is nothing to
        # wait for — fail now with its actual error instead of at the deadline.
        if proc.poll() is not None:
            err = ''
            try:
                err = (proc.stderr.read() or b'').decode('utf-8', 'replace').strip()
            except Exception:
                pass
            raise ChromeStartupError(
                'Chrome exited during startup (code %s)%s'
                % (proc.returncode, ': ' + err[-500:] if err else ''))
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=1) as r:
                if r.status == 200:
                    return proc, user_data_dir
        except Exception:
            pass
        time.sleep(0.2)

    proc.kill()
    proc.wait()
    raise ChromeStartupError(
        'Chrome devtools did not come up within %gs' % timeout)


def launch_chrome(port=9333, user_data_dir=None):
    """Start headless Chrome, retrying a startup that loses a race with load.

    Chrome's cold start is the slowest, least predictable part of the suite:
    measured here it takes under a second on an idle machine but ~10s when
    the cores are busy and ~15s under heavier contention. A single fixed
    budget therefore either fails on a loaded runner or hides a real hang,
    so a timeout is retried (with a fresh profile and a longer budget) rather
    than failing the suite. A Chrome that exits immediately is a real fault —
    a bad flag or a missing sandbox — and is not retried.
    """
    last = None
    for attempt in range(_STARTUP_ATTEMPTS):
        timeout = _STARTUP_TIMEOUT * (attempt + 1)
        try:
            return _launch_once(port, user_data_dir, timeout)
        except ChromeStartupError as e:
            last = e
            if 'exited during startup' in str(e):
                raise
            if attempt + 1 < _STARTUP_ATTEMPTS:
                print('chrome startup attempt %d/%d timed out after %gs; retrying'
                      % (attempt + 1, _STARTUP_ATTEMPTS, timeout), file=sys.stderr)
                time.sleep(2)
    raise ChromeStartupError(
        '%s after %d attempts. This is usually a slow or contended machine '
        'rather than a test failure; raise CHROME_STARTUP_TIMEOUT or '
        'CHROME_STARTUP_ATTEMPTS if it persists.' % (last, _STARTUP_ATTEMPTS))


def new_tab(port, url='about:blank'):
    target = 'http://127.0.0.1:%d/json/new?%s' % (port, urllib.parse.quote(url, safe=''))
    req = urllib.request.Request(target, method='PUT')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=60, enable_multithread=False)
        self._id = 0
        self._pending = {}

    def _msg(self, method, params=None):
        self._id += 1
        payload = {'id': self._id, 'method': method, 'params': params or {}}
        self.ws.send(json.dumps(payload))
        return self._id

    def send(self, method, params=None):
        mid = self._msg(method, params)
        deadline = time.time() + 30
        while time.time() < deadline:
            raw = self.ws.recv()
            if not raw:
                continue
            data = json.loads(raw)
            if data.get('id') == mid:
                if 'error' in data:
                    raise RuntimeError('CDP %s failed: %s' % (method, data['error']))
                return data.get('result', {})
        raise RuntimeError('CDP %s timed out' % method)

    def wait(self, seconds=30):
        """Block until any event arrives (used to let the page run)."""
        self.ws.settimeout(seconds)
        try:
            raw = self.ws.recv()
            return json.loads(raw) if raw else None
        except websocket.WebSocketTimeoutException:
            return None

    def drain(self, kind, timeout=5):
        """Collect events of the given method until a timeout or a stop marker."""
        received_event = False
        results = []
        deadline = time.time() + timeout
        self.ws.settimeout(0.1)
        while time.time() < deadline:
            try:
                raw = self.ws.recv()
            except websocket.WebSocketTimeoutException:
                if received_event and kind is None:
                    break
                continue
            except websocket.WebSocketConnectionClosedException:
                break
            if not raw:
                continue
            data = json.loads(raw)
            if data.get('method') == 'Runtime.consoleAPICalled':
                results.append(data['params'])
                received_event = True
            elif data.get('method') == 'Runtime.exceptionThrown':
                results.append(data['params'])
                received_event = True
            elif data.get('method') == kind:
                results.append(data['params'])
                received_event = True
                if kind is not None:
                    break
        self.ws.settimeout(60)
        return results

    def eval(self, expr, await_promise=True):
        res = self.send('Runtime.evaluate', {
            'expression': expr,
            'returnByValue': True,
            'awaitPromise': bool(await_promise),
        })
        if 'exceptionDetails' in res:
            raise RuntimeError('JS exception: %s' % json.dumps(res['exceptionDetails'])[:500])
        return res.get('result', {}).get('value')

    def enable(self):
        self.send('Runtime.enable')
        self.send('Page.enable')

    def navigate(self, url):
        self.send('Page.navigate', {'url': url})
        self.wait_js("globalThis.__pageReady !== undefined", timeout=30)

    def wait_js(self, expr, timeout=30, interval=0.25):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                val = self.eval('(%s) ? true : false' % expr)
            except Exception:
                val = False
            if val:
                return True
            time.sleep(interval)
        raise RuntimeError('wait timed out: %s' % expr)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()