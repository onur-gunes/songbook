#!/usr/bin/env python3
"""Assemble the static site for GitHub Pages into _site/.

Only the runtime files are copied; development scripts, the legacy source
pages and tests are left out. Also emits the portable single-file build.
"""
import os
import shutil
import subprocess
import sys

D = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(D, '_site')

FILES = [
    'index.html',
    'app.js',
    'chords.js',
    'style.css',
    'manifest.webmanifest',
    'sw.js',
]
DIRS = ['songbooks', 'images']


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
