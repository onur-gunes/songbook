#!/usr/bin/env python3
"""Shared test fixtures for Songbook browser suites.

Loads the original (test-only) fixture books under tests/fixtures/books/ and
injects them as ``window.__SONGBOOKS__`` via CDP's
``Page.addScriptToEvaluateOnNewDocument`` *before* a page navigates, so the
browser suites run against known content instead of the removed bundled books.

The injected list is authoritative (see SB.loadBundled in js/songbooks.js): an
array here replaces bundled loading entirely, which mirrors the empty-bundle
state the single-file build produces.

Usage::

    from fixture import inject_fixtures
    inject_fixtures(cdp)          # register before Page.navigate
    cdp.send('Page.navigate', {...})
"""
import json
import os

FIXTURE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'books')

# Book ids, in the order they should appear (bundled order). The first book is
# the default, so keep the richer content book there; test-book is the compact
# coverage fixture used by tests/empty.py.
FIXTURE_BOOK_IDS = ('krakow-ukulele', 'polska-gurom', 'popular', 'test-book')


def load_fixture(book_id):
    """Return the parsed fixture book JSON for ``book_id``."""
    path = os.path.join(FIXTURE_DIR, book_id + '.json')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_all_fixtures():
    """Return all fixture books as a list, in FIXTURE_BOOK_IDS order."""
    return [load_fixture(bid) for bid in FIXTURE_BOOK_IDS]


def inject_fixtures(cdp, books=None):
    """Register ``window.__SONGBOOKS__`` injection on every new document.

    Must be called before ``Page.navigate`` so the script is in place when the
    target document loads. Also applies to same-origin iframes (e.g. the
    e2e.html test frame), since addScriptToEvaluateOnNewDocument injects into
    each frame's document at creation.
    """
    if books is None:
        books = load_all_fixtures()
    source = 'window.__SONGBOOKS__ = %s;' % json.dumps(books)
    cdp.send('Page.addScriptToEvaluateOnNewDocument', {'source': source})
    return books
