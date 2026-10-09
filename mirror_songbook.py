import os, re, sys, time, urllib.request, urllib.parse, posixpath

BASE = 'https://ukulelekrakow.pl/'
DEST = '/Users/og/Projects/Ukulele-Songbook/'

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'}

def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                print('  !! fetch failed:', url, '->', e)
                return None
            time.sleep(1)

def local_url_path(p):
    if p.startswith('#') or not p or p.startswith('javascript:') or p.startswith('mailto:'):
        return None
    if '://' in p:
        return None
    p = p.replace('\\', '/')
    if p.startswith('//'):
        p = p.lstrip('/')
    p = p.lstrip('/') if p.startswith('/') else p
    if p.startswith('../'):
        norm = p.replace('../', '')
        # song pages live at root, so any relative path is root-relative
        p = norm
    if re.match(r'^(images|chords|fonts)/', p):
        return p
    if p.endswith('.html'):
        return None  # song pages handled separately
    return p if ('.' in os.path.basename(p)) else None

def is_media_href(href):
    h = href.lower()
    media = [
        'youtube.com', 'youtu.be', 'youtube-nocookie.com',
        'spotify.com', 'open.spotify',
        'deezer.com', 'soundcloud.com', 'vimeo.com', 'tidal.com',
        'bandcamp.com', 'music.apple.com', 'itunes.apple.com',
        'music.amazon.com', 'play.google.com/music', 'musica.amazon.com',
    ]
    return any(m in h for m in media)

def strip_gtag(html):
    html = re.sub(r'<!--[^>]*Google[^>]*tag[^>]*-->\s*', '', html, flags=re.I)
    html = re.sub(r'<script[^>]*src="https://www\.googletagmanager\.com/gtag/js[^>]*>\s*</script>\s*', '', html, flags=re.I)
    html = re.sub(r'<script>[\s\S]*?window\.dataLayer[\s\S]*?</script>\s*', '', html, flags=re.I)
    return html

def strip_media(html):
    # remove media <a> anchors (may wrap an <img>)
    anchors = list(re.finditer(r'<a\b[^>]*>', html))
    ranges = []
    for m in anchors:
        tag = m.group(0)
        hm = re.search(r'href\s*=\s*"([^"]*)"', tag)
        if not hm:
            hm = re.search(r"href\s*=\s*'([^']*)'", tag)
        if not hm:
            continue
        if is_media_href(hm.group(1)):
            end = html.find('</a>', m.end())
            close = m.end()
            if end != -1:
                el = html.find('</a>', close)
                ranges.append((m.start(), el + 4 if el != -1 else close))
    if ranges:
        out = []
        prev = 0
        for s, e in ranges:
            out.append(html[prev:s]); prev = e
        out.append(html[prev:])
        html = ''.join(out)
    # remove iframes
    html = re.sub(r'<iframe\b[^>]*>[\s\S]*?</iframe>', '', html)
    html = re.sub(r'<iframe\b[^>]*/>', '', html)
    return html

def strip_petal_anniversary(html):
    # piggyback for the list page + safety on song pages
    html = re.sub(r'\s*<div id="petal-container">\s*</div>\s*', '', html)
    html = re.sub(r'\s*<div class="[^"]*anniversary-header[^"]*">[\s\S]*?</div>\s*', '', html)
    html = re.sub(r'/\* --- Clean Anniversary Header Text --- \*/.*?</style>', '</style>', html, flags=re.S)
    html = re.sub(r'/\* --- Natural Petal Shower Animation --- \*/.*?</style>', '</style>', html, flags=re.S)
    html = re.sub(r'\n\s*// Petal Shower Animation.*?// Shared Filtering Logic', '\n    // Shared Filtering Logic', html, flags=re.S)
    html = html.replace('\n        setupPetalShower();', '')
    # CSS leftovers safety
    html = re.sub(r'\s*\.anniversary-title\s*\{[^}]*\}', '', html)
    html = re.sub(r'\s*\.anniversary-header\s*\{[^}]*\}', '', html)
    html = re.sub(r'\s*body\.dark-mode \.anniversary-title\s*\{[^}]*\}', '', html)
    html = re.sub(r'\s*#[^}]*petal[^}]*\{[^}]*\}', '', html)
    html = re.sub(r'\s*body\.dark-mode #[^}]*petal[^}]*\{[^}]*\}', '', html)
    html = re.sub(r'\s*@keyframes fall\s*\{[^}]*\}\s*', '', html)
    return html

def save(path, data):
    full = os.path.join(DEST, path)
    os.makedirs(os.path.dirname(full) or DEST, exist_ok=True)
    with open(full, 'wb') as f:
        f.write(data)

print('== step 1: fetch songs.html ==')
index = fetch(BASE + 'songs.html')
if index is None:
    sys.exit('could not fetch index')
idx_html = index.decode('utf-8', 'replace')

print('== step 2: parse song links ==')
links = list(dict.fromkeys(re.findall(r'href="([^"]+\.html)"', idx_html)))
print('  found', len(links), 'song pages')

print('== step 3: fetch + process song pages ==')
songs_saved = 0
for i, link in enumerate(links, 1):
    url = BASE + urllib.parse.quote(link, safe="'/(),.")
    data = fetch(url)
    if data is None:
        print('  SKIP (failed):', link)
        continue
    text = data.decode('utf-8', 'replace')
    text = strip_gtag(text)
    text = strip_media(text)
    text = strip_petal_anniversary(text)
    save(link, text.encode('utf-8'))
    songs_saved += 1
    if i % 25 == 0:
        print('  processed', i, '/', len(links))

print('== step 4: process index page ==')
idx_html = strip_gtag(idx_html)
idx_html = strip_media(idx_html)
idx_html = strip_petal_anniversary(idx_html)
save('songs.html', idx_html.encode('utf-8'))

print('== step 5: collect + fetch assets ==')
pages = []
for root, _, files in os.walk(DEST):
    for fn in files:
        if fn.endswith('.html'):
            with open(os.path.join(root, fn), encoding='utf-8', errors='replace') as f:
                pages.append(f.read())
assets = set()
for p in pages:
    for m in re.finditer(r'<img[^>]*\bsrc="([^"]+)"', p): assets.add(m.group(1))
    for m in re.finditer(r"<img[^>]*\bsrc='([^']+)'", p): assets.add(m.group(1))
    for m in re.finditer(r'<link[^>]*rel="icon"[^>]*\bhref="([^"]+)"', p): assets.add(m.group(1))
    for m in re.finditer(r'url\(\s*["\']?([^"\')]+)["\']?\s*\)', p): assets.add(m.group(1))
downloaded = skipped = 0
for a in sorted(assets):
    lp = local_url_path(a)
    if lp is None:
        continue
    url = BASE + urllib.parse.quote(lp, safe="'/(),.")
    data = fetch(url, tries=2)
    if data is None:
        skipped += 1
        continue
    save(lp, data)
    downloaded += 1
print('  assets downloaded:', downloaded, '| skipped/failed:', skipped)

print('== DONE ==')
print('songs saved:', songs_saved)
print('assets:', downloaded)