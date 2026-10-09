"""Minimal Chrome DevTools Protocol driver for the Songbook test suite.

Requires: websocket-client (pip). Starts a headless Chrome on a remote
debugging port and lets tests navigate the page, evaluate JS, and surface
console errors / uncaught exceptions without relying on flaky virtual time.
"""
import json
import subprocess
import time
import urllib.parse
import urllib.request

import websocket


def launch_chrome(port=9333, user_data_dir=None):
    import tempfile
    user_data_dir = user_data_dir or tempfile.mkdtemp(prefix='ukb-cdp-')
    proc = subprocess.Popen([
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '--headless=new',
        '--remote-debugging-port=%d' % port,
        '--remote-allow-origins=*',
        '--user-data-dir=' + user_data_dir,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=1) as r:
                if r.status == 200:
                    return proc, user_data_dir
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError('Chrome devtools did not come up')


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