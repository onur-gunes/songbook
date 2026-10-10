#!/usr/bin/env python3
"""Migrate the 198 legacy song HTML pages into a single songs-data.js dataset.

Source: legacy/ folder (Riptide.html, etc. — archived original pages).
Output: songs-data.js  (const SONGS = [...]), plus a printed validation report.
"""
import json, os, re, unicodedata, html as htmlmod
from html.parser import HTMLParser

D = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(D, 'legacy')

SONGBOOK_ID = 'krakow-ukulele'
SONGBOOK_NAME = 'Krakow Ukulele Songbook'
SONGBOOK_DESC = 'Personal offline songbook - Krakow Ukulele & Sing Tuesdays.'
SONGBOOK_LOGO_LIGHT = 'images/ukulele-krakow-trans-light.png'
SONGBOOK_LOGO_DARK = 'images/ukulele-krakow-trans-dark.png'

# ---------- helpers ----------

def slugify(t):
    s = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s[:48] or 'song'

class TabParser(HTMLParser):
    """Extract <div id="tab"> content into a flat list of (kind, text) events."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_tab = False
        self.depth = 0
        self.events = []
        self.fmt_stack = []          # list of format markers in effect
        self.in_chord = False
        self.in_pre = None           # id of pre open events not needed; bool
        self.pre_buf = None

    # -- routing ------------------------------------------------
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if not self.in_tab:
            if tag == 'div' and d.get('id') == 'tab':
                self.in_tab = True
                self.depth = 1
            return
        if tag == 'div':
            self.depth += 1

        if self.in_pre is not None:
            if tag == 'br':
                self.pre_buf += '\n'
            return

        if tag == 'br':
            self.events.append(('br', ''))
        elif tag == 'hr':
            self.events.append(('br', ''))
        elif tag == 'pre':
            if self.events and self.events[-1][0] in ('br',):
                self.events.pop()  # pre already starts a fresh block
            self.in_pre = ''
            self.pre_buf = ''
        elif tag == 'span':
            cls = ' ' + (d.get('class') or '') + ' '
            if 'chord' in cls:
                self.in_chord = True
            elif 'text-muted' in cls:
                self.fmt_stack.append('m')
            elif 'mark' in cls or 'fw-bold' in cls:
                self.fmt_stack.append('b')
        elif tag in ('strong', 'b'):
            self.fmt_stack.append('b')
        elif tag == 'i':
            self.fmt_stack.append('i')
        elif tag in ('mark', 'small', 'em'):
            pass

    def handle_endtag(self, tag):
        if not self.in_tab:
            return
        if tag == 'div':
            self.depth -= 1
            if self.depth <= 0:
                self.in_tab = False
            return
        if self.in_pre is not None:
            if tag == 'pre':
                self.events.append(('pre', self.pre_buf))
                self.in_pre = None
                self.pre_buf = None
            return
        if tag == 'span':
            if self.in_chord:
                self.in_chord = False
                return
        if tag in ('strong', 'b', 'i', 'span'):
            if self.fmt_stack:
                self.fmt_stack.pop()

    def handle_data(self, data):
        if not self.in_tab:
            return
        if self.in_pre is not None:
            self.pre_buf += data
            return
        if self.in_chord:
            v = data.strip()
            self.events.append(('chord', v))
            return
        if not data:
            return
        # classify current text run by active format
        fmt = 'm' if 'm' in self.fmt_stack else ('b' if 'b' in self.fmt_stack else ('i' if 'i' in self.fmt_stack else 'x'))
        self.events.append((fmt, data))

    def handle_comment(self, data):
        if self.in_tab:
            self.events.append(('note', data))

# ---------- event stream -> lines ----------

def normalize_text(t):
    """Collapse whitespace runs to single spaces (mirrors HTML rendering)."""
    return re.sub(r'\s+', ' ', t)

def build_lines(events):
    """Event stream -> list of lines; each line is a list of [kind, value] segs.

    kind: c=chord, x=text, m=muted, b=bold, i=italic, y=html-comment, p=pre
    """
    TEXT_KINDS = ('x', 'm', 'b', 'i')
    lines = []
    cur = []

    def push_text(kind, val):
        val = normalize_text(val)
        if val == '':
            return
        if val == ' ':
            # whitespace-only node: HTML renders it as one space between content
            if not cur:
                return                     # leading indent -> invisible, drop
            if cur[-1][0] in TEXT_KINDS:
                if not cur[-1][1].endswith(' '):
                    cur[-1][1] += ' '
            else:
                cur.append(['x', ' '])
            return
        if cur and cur[-1][0] == kind:
            cur[-1][1] = cur[-1][1].rstrip() + ' ' + val.lstrip()
        else:
            cur.append([kind, val])

    def flush():
        nonlocal cur
        if cur and cur[-1] == ['x', ' ']:
            cur.pop()
        if cur and cur[-1][0] in TEXT_KINDS:
            cur[-1][1] = cur[-1][1].rstrip()   # only the line-final segment
        if cur and all(seg[0] in TEXT_KINDS and seg[1] == '' for seg in cur):
            cur = []
        lines.append(cur)
        cur = []

    for kind, val in events:
        if kind == 'br':
            flush()
        elif kind == 'pre':
            if cur:
                flush()
            for part in val.split('\n'):
                lines.append([['p', part]])
        elif kind in TEXT_KINDS:
            push_text(kind, val)
        elif kind == 'chord':
            cur.append(['c', val])
        elif kind == 'note':
            cur.append(['y', val])
    if cur:
        flush()
    # drop leading/trailing empty lines caused by boilerplate <br>
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return lines

# ---------- transpose-safe chord detection (for validation) ----------

# ---------- page parsing ----------

def parse_page(fn):
    html = open(os.path.join(SRC, fn), encoding='utf-8', errors='replace').read()

    m = re.search(r'<h3[^>]*>\s*(.*?)\s*</h3>', html, re.S)
    h3 = m.group(1) if m else ''
    mnum = re.match(r'#\s*(\d+)', h3)          # require the '#' prefix
    number = int(mnum.group(1)) if mnum else None
    title = h3[mnum.end():].strip() if mnum else h3.strip()
    title = re.sub(r'^[\s\-–—]+', '', title)   # drop the " - " separator

    m = re.search(r'<h5 class="song-artist[^"]*">\s*(.*?)\s*</h5>', html, re.S)
    artist = m.group(1).strip() if m else ''

    m = re.search(r'>\s*(Easy|Medium|Hard)\s*<', html)
    level = m.group(1) if m else None

    m = re.search(r'data-duration\s*=\s*"?\s*([\d.]+)', html)
    dur = float(m.group(1)) if m else None

    new = '🔥' in h3

    m = re.search(r'<div id="chordsContainer"[^>]*>(.*?)</div>', html, re.S)
    chords = []
    if m:
        for im in re.finditer(r'<img[^>]*\b(?:alt|title)="([^"]*)"', m.group(1)):
            k = im.group(1)
            if k and k not in chords:
                chords.append(k)

    p = TabParser()
    p.feed(html)
    sheet = build_lines(p.events)

    # fallback: if nothing parsed, keep original inner HTML for safety
    fallback = None
    if not sheet:
        tm = re.search(r'<div id="tab"[^>]*>([\s\S]*?)</div>\s*<hr', html)
        fallback = tm.group(1) if tm else None

    return {
        'n': number,
        'title': title,
        'artist': artist,
        'level': level,
        'new': new,
        'dur': dur,
        'chords': chords,
        'sheet': sheet,
        'fb': fallback,
    }

# ---------- main ----------

def main():
    songs = []
    errors = []
    seen_ids = set()
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.html') and f != 'songs.html')

    for fn in files:
        r = parse_page(fn)
        if r['n'] is None:
            errors.append('no number: ' + fn)
        if not r['title']:
            errors.append('no title: ' + fn)
        if not r['artist']:
            errors.append('no artist: ' + fn)
        if r['level'] not in ('Easy', 'Medium', 'Hard'):
            errors.append('bad level ' + str(r['level']) + ': ' + fn)
        if r['dur'] is None:
            errors.append('no duration: ' + fn)
        if not r['sheet'] and not r['fb']:
            errors.append('empty content: ' + fn)

        base_id = slugify(r['title'])
        sid = base_id
        i = 2
        while sid in seen_ids:
            sid = base_id + '-' + str(i)
            i += 1
        seen_ids.add(sid)

        song = {
            'id': sid,
            'n': r['n'],
            'title': r['title'],
            'artist': r['artist'],
            'level': r['level'],
            'new': r['new'],
            'dur': r['dur'],
            'chords': r['chords'],
            'sheet': r['sheet'],
        }
        if r['fb'] is not None:
            song['fb'] = r['fb']
        songs.append(song)

    songs.sort(key=lambda s: s['n'])
    songbook = {
        'id': SONGBOOK_ID,
        'name': SONGBOOK_NAME,
        'description': SONGBOOK_DESC,
        'instrument': 'ukulele',
        'logo': SONGBOOK_LOGO_LIGHT,
        'logoDark': SONGBOOK_LOGO_DARK,
        'songs': songs,
    }
    out = json.dumps(songbook, ensure_ascii=False, indent=1) + '\n'
    os.makedirs(os.path.join(D, 'songbooks'), exist_ok=True)
    with open(os.path.join(D, 'songbooks', 'krakow-ukulele.json'), 'w', encoding='utf-8') as f:
        f.write(out)

    # ---------- validation report ----------
    lines = []
    lines.append('=== validation report ===')
    lines.append('songs: %d' % len(songs))
    lines.append('errors: %s' % (errors or 'none'))
    lv = {}
    for s in songs:
        lv[s['level']] = lv.get(s['level'], 0) + 1
    lines.append('levels: %s' % lv)
    lines.append('new songs: %d' % sum(1 for s in songs if s['new']))
    nums = [s['n'] for s in songs]
    lines.append('numbers: %d..%d unique=%d' % (min(nums), max(nums), len(set(nums))))
    from collections import Counter
    idc = Counter(s['id'] for s in songs)
    lines.append('duplicate ids: %s' % [k for k, v in idc.items() if v > 1])
    missing_artist = [s['id'] for s in songs if not s['artist'].strip()]
    lines.append('missing artists: %s' % missing_artist)
    empty = [s['id'] for s in songs if not s['sheet'] and 'fb' not in s]
    lines.append('empty content: %s' % empty)

    # collect all chord keys referenced vs. files present
    refc = set()
    for s in songs:
        refc.update(s['chords'])
    chord_files = {f[:-4] for f in os.listdir(os.path.join(D, 'legacy', 'chords-gifs')) if f.endswith('.gif')}
    missing_imgs = sorted(refc - chord_files)
    unused_imgs = sorted(chord_files - refc)
    lines.append('referenced chords: %d | image files: %d' % (len(refc), len(chord_files)))
    lines.append('missing diagram images: %s' % missing_imgs)
    lines.append('unused diagram images: %s' % unused_imgs)

    # text-level sanity: leftover entities / broken unicode / empty lines
    ent = []
    for s in songs:
        for ln in s['sheet']:
            for seg in ln:
                if re.search(r'&(?:[a-zA-Z]+|#\d+);', seg[1]) or '\ufffd' in seg[1]:
                    ent.append((s['id'], seg[1][:40]))
    lines.append('leftover html entities / broken unicode: %s' % (ent[:10] or 'none'))

    # emoji check
    emo = {}
    for s in songs:
        for ch in s['title']:
            if ord(ch) > 0x2100:
                emo.setdefault(ch, 0)
                emo[ch] += 1
    lines.append('non-ascii title chars: %s' % emo)

    # transposable chord count (approx parseability)
    badt = []
    chordset = set()
    for s in songs:
        for ln in s['sheet']:
            for seg in ln:
                if seg[0] == 'c':
                    for tok in seg[1].split():
                        chordset.add(tok.strip('/'))
    lines.append('unique chord tokens: %d' % len(chordset))
    lines.append('sample chord tokens: %s' % sorted(chordset)[:40])

    report = '\n'.join(lines)
    print(report)
    with open(os.path.join(D, 'migration-report.txt'), 'w', encoding='utf-8') as f:
        f.write(report + '\n')

    print('\nsongbooks/krakow-ukulele.json bytes:',
          os.path.getsize(os.path.join(D, 'songbooks', 'krakow-ukulele.json')))

if __name__ == '__main__':
    main()