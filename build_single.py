#!/usr/bin/env python3
"""Bundle the multi-file app into one self-contained Songbook.html.

Inlines style.css, chords.js, app.js, all bundled songbooks (as
window.__SONGBOOKS__) and all images (images/* as base64 data URIs). Chord
diagrams are drawn on the fly by chords.js, so no chord images are bundled.
The result reads no external files and works from file:// on desktop and
Android. The source multi-file app is untouched.
"""
import base64
import json
import os
import re
import sys

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, 'Songbook.html')

MIME = {
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
}


def read(rel):
    with open(os.path.join(D, rel), encoding='utf-8') as f:
        return f.read()


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    mime = MIME.get(ext)
    if mime is None:
        raise SystemExit('unsupported image type: ' + path)
    with open(path, 'rb') as f:
        return 'data:' + mime + ';base64,' + base64.b64encode(f.read()).decode()


def load_songbooks():
    manifest = json.loads(read('songbooks/index.json'))
    out = []
    for entry in manifest.get('songbooks', []):
        sb = json.loads(read(os.path.join('songbooks', entry['file'])))
        out.append(sb)
    return out


html = read('index.html')
css = read('style.css')
songbooks = load_songbooks()

# index.html's <script src=...> tags are the single source of truth for
# which app modules exist and what order they load in, so adding a module
# never means editing this script.
SCRIPT_TAG = re.compile(r'<script src="([^"]+)"></script>')
script_srcs = SCRIPT_TAG.findall(html)
if not script_srcs:
    raise SystemExit('no <script src="..."> tags found in index.html')
missing = [s for s in script_srcs if not os.path.exists(os.path.join(D, s))]
if missing:
    raise SystemExit('index.html references missing script(s): ' + ', '.join(missing))
scripts = [(s, read(s)) for s in script_srcs]

# songbook logos live inside the JSON; inline them as data URIs so the bundle stays self-contained
def inline_logo(val):
    if isinstance(val, str) and val.startswith('images/'):
        p = os.path.join(D, val)
        if not os.path.exists(p):
            raise SystemExit('missing image: ' + val)
        return data_uri(p)
    return val

for sb in songbooks:
    for key in ('logo', 'logoDark'):
        if key in sb:
            sb[key] = inline_logo(sb[key])

# 1) inline CSS
if '<link rel="stylesheet" href="style.css">' not in html:
    raise SystemExit('style.css <link> tag not found')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')

# 2) drop the web-app manifest (file:// has no server to fetch it from)
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '')

# 3) inline all image-path attribute values (src/href/data-light/data-dark)
def inline_img(m):
    attr, val = m.group(1), m.group(2)
    if val.startswith('images/'):
        p = os.path.join(D, val)
        if not os.path.exists(p):
            raise SystemExit('missing image: ' + val)
        return attr + '="' + data_uri(p) + '"'
    return m.group(0)

html = re.sub(r'(src|href|data-light|data-dark)="([^"]+)"', inline_img, html)

# 4) inline the scripts in index.html's order; bundled songbooks become
#    window.__SONGBOOKS__, injected before the first app module so it is
#    set by the time the app's entry point runs.
songbooks_js = json.dumps(songbooks, ensure_ascii=False).replace('<', '\\u003c')
first_app_module = next((s for s, _ in scripts if s.startswith('js/')), None)
for src, code in scripts:
    tag = '<script src="%s"></script>' % src
    block = '<script>\n' + code + '\n</script>'
    if src == first_app_module:
        block = ('<script>window.__SONGBOOKS__ = ' + songbooks_js + ';</script>\n'
                 + block)
    html = html.replace(tag, block)

# 5) self-containment sanity checks
bad = []
# every script index.html loaded must now be inlined, not referenced
patterns = [r'src="chords/', r'src="images/', r'href="images/', r'data-light="images/', r'data-dark="images/',
            r'href="style\.css', r'href="manifest\.webmanifest', r'href="sw\.js',
            r'https?://(?!www\.w3\.org|github\.com/fgnass/tuner)']
patterns += [r'src="%s"' % re.escape(s) for s, _ in scripts]
for pat in patterns:
    if re.search(pat, html):
        bad.append(pat)
if bad:
    raise SystemExit('bundle still references external resources: ' + ', '.join(bad))
for chunk, name in [(songbooks_js, 'songbooks')] + [(c, s) for s, c in scripts]:
    if '</script' in chunk.lower():
        raise SystemExit('inline content %s contains a closing script tag sequence' % name)
if 'images/' in songbooks_js:
    raise SystemExit('songbooks JSON still references an image path')
if '</style' in css.lower():
    raise SystemExit('inline style.css contains a closing style tag sequence')

banner = '<!-- Single-file build of Songbook; generated by build_single.py -->'
if html.lstrip().lower().startswith('<!doctype html>'):
    out = re.sub(r'^(\s*<!doctype html>)', r'\1\n' + banner, html, count=1, flags=re.IGNORECASE)
else:
    out = '<!doctype html>\n' + banner + '\n' + html

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(out)

n_songs = sum(len(sb.get('songs', [])) for sb in songbooks)
print('wrote ' + OUT)
print('size: %.1f KB (%d songbooks, %d songs, chord diagrams generated on the fly)'
      % (len(out) / 1024.0, len(songbooks), n_songs))
