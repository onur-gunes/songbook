#!/usr/bin/env python3
"""Regenerate tests/fidelity-all.html (and fidelity.html) from the legacy/ pages.

Each legacy page's #tab content is extracted line-by-line as the expected text;
the test then opens the song in the SPA and asserts every line appears in the
rendered sheet, plus transpose re-render/roundtrip checks.

Usage:  python3 tests/generate_fidelity.py
Then:   run headless Chrome over tests/fidelity-all.html (see README).
"""
import json, os, re, glob, html as h

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'legacy')


def tab_lines(fp):
    src = open(fp, encoding='utf-8').read()
    i = src.find('<div id="tab">')
    if i < 0:
        return None
    depth, pos = 0, None
    for m in re.finditer(r'<div\b|</div>', src[i:]):
        depth += -1 if m.group(0) == '</div>' else 1
        if depth == 0:
            pos = i + m.end()
            break
    if pos is None:
        return None
    seg = src[i:pos]
    seg = re.sub(r'<!--|-->|--!>', '', seg)   # keep comment inner text (SPA renders it), drop markers
    seg = re.sub(r'<br\s*/?>', '\n', seg)
    seg = re.sub(r'<[^>]+>', '', seg)
    seg = h.unescape(seg)
    return [re.sub(r'\s+', ' ', l).strip() for l in seg.split('\n') if l.strip()]


def main():
    data = json.load(open(os.path.join(ROOT, 'songbooks', 'krakow-ukulele.json'), encoding='utf-8'))
    arr = data['songs']

    id2file = {}
    for fp in glob.glob(os.path.join(SRC, '*.html')):
        src = open(fp, encoding='utf-8').read()
        if '<div id="tab">' not in src:
            continue
        m = re.search(r'<title>(.*?)\s+-\s+Krakow', src, re.S)
        if not m:
            continue
        title = h.unescape(m.group(1)).strip()
        for s in arr:
            if s['title'] == title and s['id'] not in id2file:
                id2file[s['id']] = fp

    cases = []
    for s in arr:
        fp = id2file.get(s['id'])
        if not fp:
            raise SystemExit('no legacy page for ' + s['id'])
        cases.append({'id': s['id'], 'title': s['title'], 'want': tab_lines(fp)})
    assert len(cases) == 198, len(cases)

    tpl = open(os.path.join(HERE, 'fidelity-template.html'), encoding='utf-8').read()
    out = tpl.replace('/*CASES*/', 'const CASES = ' + json.dumps(cases, ensure_ascii=False) + ';')
    open(os.path.join(HERE, 'fidelity-all.html'), 'w', encoding='utf-8').write(out)
    print('wrote tests/fidelity-all.html with', len(cases), 'cases')


if __name__ == '__main__':
    main()
