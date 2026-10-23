#!/usr/bin/env python3
"""Assemble the static site for GitHub Pages into _site/.

Only the runtime files are copied; development scripts, the legacy source
pages and tests are left out. Also emits the portable single-file build.

After the site is assembled the service worker's precache manifest (CORE)
and cache-busting version (VERSION) are regenerated from the actual _site/
contents, so adding a songbook or asset never requires hand-editing sw.js.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys

D = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(D, '_site')
SW = os.path.join(D, 'sw.js')

FILES = [
    'index.html',
    'app.js',
    'chords.js',
    'tuner.js',
    'style.css',
    'manifest.webmanifest',
    'sw.js',
    'LICENSE',
    'NOTICE.md',
]
DIRS = ['songbooks', 'images']

# Files in _site/ that are intentionally left out of the offline precache.
# Songbook.html is a large self-contained download, not part of the app shell.
CORE_EXCLUDE = {'sw.js', '.nojekyll', 'Songbook.html', '.DS_Store'}

VERSION_RE = re.compile(
    r'/\* @generated-version:start \*/.*?/\* @generated-version:end \*/',
    re.DOTALL)
CORE_RE = re.compile(
    r'/\* @generated-core:start \*/.*?/\* @generated-core:end \*/',
    re.DOTALL)


def collect_core():
    """Return the sorted list of _site/-relative paths to precache offline."""
    core = ['./']
    for root, _, files in os.walk(SITE):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), SITE).replace(os.sep, '/')
            if rel in CORE_EXCLUDE:
                continue
            core.append(rel)
    core[1:] = sorted(core[1:])
    return core


def compute_version(core):
    """Hash the precached assets' contents into a short cache-busting token."""
    h = hashlib.sha256()
    for rel in core:
        if rel == './':
            continue
        path = os.path.join(SITE, rel)
        h.update(rel.encode('utf-8'))
        with open(path, 'rb') as fh:
            for chunk in iter(lambda: fh.read(65536), b''):
                h.update(chunk)
    return h.hexdigest()[:12]


def render_core(core):
    lines = ['var CORE = [']
    for i, rel in enumerate(core):
        comma = ',' if i < len(core) - 1 else ''
        lines.append("    '%s'%s" % (rel, comma))
    lines.append('];')
    return '\n'.join(lines)


def apply_generated_blocks(core, version):
    """Render the marked blocks into the deployed _site/sw.js.

    The source sw.js is left untouched as the template (its markers carry a
    safe fallback so the unbuilt tree still runs); only the copied file that
    actually ships gets the generated manifest and version.
    """
    body = open(SW, 'r', encoding='utf-8').read()
    if not VERSION_RE.search(body) or not CORE_RE.search(body):
        raise SystemExit('sw.js is missing @generated-version/@generated-core markers')
    version_block = ('/* @generated-version:start */\n'
                     "var VERSION = '%s';\n"
                     '/* @generated-version:end */' % version)
    core_block = ('/* @generated-core:start */\n'
                  + render_core(core) + '\n'
                  '/* @generated-core:end */')
    body = VERSION_RE.sub(lambda m: version_block, body, count=1)
    body = CORE_RE.sub(lambda m: core_block, body, count=1)
    with open(os.path.join(SITE, 'sw.js'), 'w', encoding='utf-8') as fh:
        fh.write(body)
    return body


def main():
    if os.path.isdir(SITE):
        shutil.rmtree(SITE)
    os.makedirs(SITE)

    for name in FILES:
        src = os.path.join(D, name)
        if not os.path.exists(src):
            raise SystemExit('missing runtime file: ' + name)
        shutil.copy2(src, os.path.join(SITE, name))

    for name in DIRS:
        src = os.path.join(D, name)
        if not os.path.isdir(src):
            raise SystemExit('missing runtime dir: ' + name)
        dst = os.path.join(SITE, name)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns('.DS_Store'))

    # portable offline build, downloadable from the site
    subprocess.check_call([sys.executable, os.path.join(D, 'build_single.py')])
    shutil.copy2(os.path.join(D, 'Songbook.html'), os.path.join(SITE, 'Songbook.html'))

    # skip Jekyll (harmless, but keeps underscore paths safe if Pages ever runs it)
    open(os.path.join(SITE, '.nojekyll'), 'w').close()

    # regenerate the service worker's precache manifest + version from _site/
    core = collect_core()
    version = compute_version(core)
    apply_generated_blocks(core, version)
    print('service worker: VERSION=%s, %d precached paths' % (version, len(core)))

    total = 0
    for root, _, files in os.walk(SITE):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    print('site written to %s (%.1f KB)' % (SITE, total / 1024.0))
    for root, _, files in os.walk(SITE):
        rel = os.path.relpath(root, SITE)
        pref = '' if rel == '.' else rel + '/'
        for f in sorted(files):
            print('  ' + pref + f)


if __name__ == '__main__':
    main()
