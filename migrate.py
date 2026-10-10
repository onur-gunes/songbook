#!/usr/bin/env python3
"""Migrate the 198 legacy song HTML pages into a single songs-data.js dataset.

Source: legacy/ folder (Riptide.html, etc. — archived original pages).
Output: songs-data.js  (const SONGS = [...]), plus a printed validation report.
"""
import json, os, re, sys, unicodedata, html as htmlmod
from html.parser import HTMLParser


def warn(msg):
    print('WARN:', msg, file=sys.stderr)

D = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(D, 'legacy')

SONGBOOK_ID = 'krakow-ukulele'
SONGBOOK_NAME = 'Krakow Ukulele Songbook'
SONGBOOK_DESC = 'Personal offline songbook - Krakow Ukulele & Sing Tuesdays.'
SONGBOOK_LOGO_LIGHT = 'images/ukulele-krakow-trans-light.png'
SONGBOOK_LOGO_DARK = 'images/ukulele-krakow-trans-dark.png'

# ---------- beat counts ----------
#
# How many beats each chord is held, so a player can follow a song they don't
# know. Keyed by song id; the value can be:
#   * an int        -> that many beats for every chord in the song
#   * a dict        -> beats per chord name (e.g. {"G": 2, "C": 4}); use "*" as
#                      a default for any chord not listed
#   * a list        -> beats per chord occurrence, consumed in sheet order (for
#                      songs with an irregular harmonic rhythm)
# Beat counts are rendered as dots after the chord in the above-the-lyrics view
# only (see app.js), and are stripped from the inline view.
#
# Values below were checked against published chord charts (bar-based). Add more
# as songs are researched.

def _hold2(tok):
    """Shared rule for the many 4/4 songs where exactly '//' marks a two-bar
    hold; a single '/' (single strum) or '///' (staccato) is one bar, as is a
    plain token."""
    n = len(tok) - len(tok.rstrip('/'))
    return 8 if n == 2 else 4

BEATS = {
    # Verse/chorus: G and D split a bar (2 beats each); Am and C get a full bar.
    "knocking-on-heaven-s-door": {"G": 2, "D": 2, "Am": 4, "C": 4},
    # One chord per bar (4 beats).
    "stand-by-me": 4,
    # Every chord shares a bar, so two beats each.
    "let-it-be": 2,
    # One chord per bar (4 beats) - verified against bar-based charts.
    "riptide": 4,
    "blowing-in-the-wind": 4,
    "three-little-birds": 4,
    "i-m-yours": 4,
    "zombie": 4,
    "mad-world": 4,
    "lion-sleeps-tonight-the": 4,
    "all-apologies": 4,
    # Verse "C G F C C": C holds a bar, G+F share one (2+2). Chorus "F C G F C":
    # one chord per bar. Outro "G F C" x2 then a final C.
    "bad-moon-rising": [4, 2, 2, 4, 4] * 6 + [4, 4, 4, 4, 4]
        + [4, 2, 2, 4, 4] * 4 + [4, 4, 4, 4, 4]
        + [4, 2, 2, 4, 4] * 4 + [4, 4, 4, 4, 4] * 2
        + [4, 4, 4, 4, 4, 4] + [4],
    # 8-bar stanza: line 1 holds C for two bars (8); lines 2-3 are F/C; the
    # final "don't take my sunshine away" splits a C, a short G and a closing C.
    "you-are-my-sunshine": [4] + [8, 4, 4, 4, 4, 2, 2, 4] * 7 + [4, 4],
    # Classic one-chord-per-bar loops (4 beats); verified against the sheet's
    # own 4-chord-per-line phrasing.
    "fly-away": 4,
    "lovesong": 4,
    "little-talks": 4,
    "just-like-heaven": 4,
    "kids": 4,
    "brown-eyed-girl": 4,
    "bitter-sweet-symphony": 4,
    "otherside": 4,
    "pumped-up-kicks": 4,
    "the-scientist": 4,
    "mr-brightside": 4,
    "all-about-that-bass": 4,
    "maybe-tomorrow": 4,
    "bang-bang": 4,
    "what-s-up": 4,
    "stay-with-me": 4,
    "sunshine-reggae": 4,
    "sweet-dreams": 4,
    # Verse grooves loop one chord per bar (some lines repeat the final chord,
    # which the sheet already tokenizes as separate 4-beat holds).
    "wake-me-up": 4,
    "titanium": 4,
    "lost-on-you": 4,
    "maria": 4,
    # Songbook says so explicitly: "2 beats for C or F, 4 beats for G".
    "la-bamba": {"C": 2, "F": 2, "G": 4},
    # Sheet header: "4 beats per chord".
    "get-lucky": 4,
    # Verified with bar chart: one chord per bar throughout.
    "twist-and-shout": 4,
    "cold-heart": 4,
    # One chord per bar lending; opening C-holds are approximate.
    "i-want-to-break-free": 4,
    # 12-bar-blues feel: intro bar, then a 2-bar C on the opening line; the
    # rest of the verses are one chord per bar (some lines tokenize the same
    # chord twice to keep the count in step).
    "in-the-summertime": [4] + [8, 4, 4, 4, 4, 4] + [4] * 58 + [4],
    # F is a single short down-stroke (half bar), C/Am/G hold a full bar.
    "ho-hey": {"F": 2, "C": 4, "Am": 4, "G": 4},
    # Verified: intro/verse/chorus loop F G Em Am (and F G / F G in the verse)
    # one chord per bar.
    "never-gonna-give-you-up": 4,
    # Verse moves Am(4) Em(4) G(4); chorus Am G F one per bar.
    "rolling-in-the-deep": 4,
    # Verse/chorus one chord per bar (D D Am Am C Em etc.).
    "times-like-these": 4,
    # Verse "Em C Em Bm C" one chord per bar.
    "another-love": 4,
    "creep": 4,
    "everywhere": 4,
    # All one chord per bar.
    "500-miles-i-m-gonna-be": 4,
    "don-t-worry-be-happy": 4,
    "i-still-haven-t-found-what-i-m-looking-for": 4,
    "my-heart-will-go-on-titanic": 4,
    "shake-it-off": 4,
    "flowers": 4,
    "use-somebody": 4,
    "valerie": 4,
    "wicked-game": 4,
    "save-my-soul": 4,
    # One chord per bar.
    "budapest": 4,
    "lazy-song-the": 4,
    # One chord per bar (krakow layout).
    "i-heard-it-through-the-grapevine": 4,
    "how-you-remind-me": 4,
    "billie-jean": 4,
    "careless-whisper": 4,
    "19-2000": 4,
    "what-is-love-baby-don-t-hurt-me": 4,
    "you-will-never-know": 4,
    "roxanne": 4,
    "another-brick-in-the-wall": 4,
    # 3/4 waltz - one bar per chord is 3 beats.
    "happy-birthday": 3,
    # Ain't no sunshine: // marks 2-bar holds, / a single-strum bar.
    "ain-t-no-sunshine": [8,8,4,4,8,8,4,8,8,4,4,4,8,8,4,4,8,8,4,8,8,4,4,4,8,8,4,8,8,4,4,
                          8,8,4,8,8,4,4,4,8,8,4,8,8,4,8,8,4,8,8,4],
    # Bad romance: C//, F//, G// hold 2 bars in the verse; rest one per bar.
    "bad-romance": [4,4,4,4,4,4,4,4,4,4,8,8,4,8,8,4,8,8,4,8,8,4,8,8,4,8,8,4,8,8,4,8,8,
                    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,8,8,4,8,8,4,8,8,
                    4,8,8,4,8,8,4,8,8,4,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
                    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
                    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4],
    # Relax: Dm/Dsus2 held 2 bars in the chorus; everything else one per bar.
    "relax-take-it-easy": [4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,4,4,8,8,4,4,4,4,4,
                           4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,4,4,8,8,
                           4,4,4,8,8,4,4,4,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,4,4,
                           8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4],
    "beggin": 4,
    # Yellow: chorus Am/G hold 2 bars each; verses one per bar.
    "yellow": [4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,8,8,4,8,8,4,4,4,4,4,4,4,4,4,4,
               4,4,4,4,8,8,4,8,8,4,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4],
    # One love: reggae - held chords (//) last 2 bars, singles 1 bar.
    "one-love": [4,4,8,8,8,8,4,4,8,8,8,8,4,4,8,8,8,8,8,8,8,8,8,8,8,8,8,8,4,4,8,8,8,
                 8,8,8,8,4,4,8,4,4,8,8,8,8,4,4,8,8,8,4,8,8,8,8,8,8,8,8,8,8,4,4,8,8,
                 8,8,8,8,8,4,4,8,4,4,8,8,8,4,4,4,8,8,8,4,8,8,8,4],
    # People are strange: // marks 2-bar holds.
    "people-are-strange": [8,4,4,4, 8,8,8,8,8,8, 4,8,8,8,8,8,8, 4,4,8,8,4,8,8,8,
                           4,4,4, 8,8,8,8,8,8, 4,8,8,8,8,8,8, 4,4,8,8,4,8,8,8,
                           4,4,4, 8,8,8,8,8,8, 4,8,8,8,8,8,8, 4,4,8,8,4,8,8,8, 4,4],
    # F// and C// hold 2 bars in the chorus.
    "why-don-t-you-get-a-job": [4]*6 + [8,8,4] + [4]*4 + [8,8,4] + [4]*4 + [8,8,8] +
                               [4]*13 + [8,8,4] + [4]*4 + [8,8,4] + [4]*4 + [8,8,8] +
                               [4]*6 + [8,8,4] + [4]*4 + [8,8,4] + [4]*6,
    # Toxic: Am/ and E7/ are half-bar accents.
    "toxic": [4,4,4,2,4,4,4,4,2,4,4,4,4,2,4,4,4,4,2,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
              4,2,4,4,4,4,2,4,4,4,4,2,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,2,4,4,4,4,4,
              4,4,2,4,4,4,4,4,4,4,4,2],
    # Little lion man: Dm/ and Bb/ are half-bar pairs; choruses one per bar.
    "little-lion-man": [4,4,4,4,2,2,4,2,2,4,4,4,
                        4,4,4,4,2,2,4,2,2,4,2,2,
                        4,4,4,4,4,4,2,2,4,2,2,4,
                        4,4,4,4,4,4,4,4,4,4,4,4,
                        4,4,4,4,4,4,4,4,4,4,4,4,
                        4,4,4,4,4,4,4,4,4,4,4,4,
                        4,4,4,4,4,4,4,4,4,4,4,4,
                        4,4,4,4,4,4,4,4,4,2,2,4,
                        4,4,4,4,4,4,4,2,2],
    # Englishman: Dm// and G// hold 2 bars, Am bridges one bar.
    "englishman-in-new-york": [8,8,4]*35 + [4]*10,
    # Verse E E A A / E E A A / E B7 E A, chorus riff E D - one chord per bar.
    "i-can-t-get-no-satisfaction": 4,
    # One chord per bar; A/ and stop are single-strum bar and rest.
    "these-boots-are-made-for-walking": 4,
    # One chord per bar (sheet places a single bar per chord token).
    "blister-in-the-sun": 4,
    "cecilia": 4,
    "crazy": 4,
    "dancing-queen": 4,
    "dog-days-are-over": 4,
    "every-breath-you-take": 4,
    "eye-of-the-tiger": 4,
    "friday-i-m-in-love": 4,
    "happy": 4,
    "hey-there-delilah": 4,
    "house-of-gold": 4,
    "jolene": 4,
    "let-her-go": 4,
    "take-me-home-country-roads": 4,
    "take-on-me": 4,
    "wonderwall": 4,
    "i-will-survive": 4,
    # One chord per bar (single / = single-strum bar, also 4).
    "all-star-shrek": 4,
    "black": 4,
    "boys-don-t-cry": 4,
    "enjoy-the-silence": 4,
    "fly-me-to-the-moon": 4,
    "go-your-own-way": 4,
    "happy-together": 4,
    "hey-jude": 4,
    "hotel-california": 4,
    "house-of-the-rising-sun": 4,
    "i-was-made-for-lovin-you": 4,
    "i-ll-be-there-for-you-friends-theme": 4,
    "lemon-tree": 4,
    "light-my-fire": 4,
    "sailing": 4,
    "she-loves-you": 4,
    "snow-hey-oh": 4,
    "killing-me-softly": 4,
    "it-s-raining-men": 4,
    "postcards-from-italy": 4,
    "sweet-caroline": 4,
    "you-know-i-m-no-good": 4,
    "loneliest": 4,
    "lucy-in-the-sky-with-diamonds": 4,
    "space-oddity": 4,
    "mamma-mia": 4,
    "blinding-lights": 4,
    "don-t-let-me-be-misunderstood": 4,
    "home": 4,
    "somebody-told-me": 4,
    "sweater-weather": 4,
    "shiny-happy-people": 4,
    "hit-the-road-jack": 4,
    "karma-police": 4,
    "psycho-killer": 4,
    "summer-nights": 4,
    "i-m-a-believer-from-shrek": 4,
    "don-t-look-back-in-anger": 4,
    "don-t-stop-me-now": 4,
    "somewhere-over-the-rainbow": 4,
    "the-man-who-sold-the-world": 4,
    # '//' two-bar holds throughout; '///' staccato counts as one bar.
    "california-dreaming": _hold2,
    "fluorescent-adolescent": _hold2,
    "american-idiot": _hold2,
    "can-t-stop": _hold2,
    "here-comes-the-sun": _hold2,
    "hit-me-baby-one-more-time": _hold2,
    "the-judge": _hold2,
    "there-is-a-light-that-never-goes-out": _hold2,
    # 6/8 lilt: each chord lasts roughly a 3/4-sized bar (like happy-birthday).
    "can-t-help-falling-in-love-with-you": 3,
    # 2/4: one chord per (two-beat) bar.
    "ring-of-fire": 2,
    # Riff arpeggio (F / Gsus2): each token is about a half bar.
    "don-t-let-me-down": 2,
    "wish-you-were-here": 4,
    "where-is-my-mind": 4,
    # 4/4 songs where '//' = two-bar hold, plain and single '/' = one bar.
    "a-little-respect": _hold2,
    "after-hours": _hold2,
    "bohemian-rhapsody": _hold2,
    "can-t-get-you-out-of-my-head": _hold2,
    "can-t-take-my-eyes-off-you": _hold2,
    "chop-suey": _hold2,
    "colors-of-the-wind": _hold2,
    "crazy-little-thing-called-love": _hold2,
    "do-i-wanna-know": _hold2,
    "dream-a-little-dream-of-me": _hold2,
    "hallelujah": _hold2,
    "highway-to-hell": _hold2,
    "i-knew-you-were-trouble": _hold2,
    "i-wanna-be-like-you-the-monkey-song": _hold2,
    "i-want-it-that-way": _hold2,
    "i-m-still-standing": _hold2,
    "it-s-my-life": _hold2,
    "jammin": _hold2,
    "la-vie-en-rose": _hold2,
    "lake-of-fire": _hold2,
    "losing-my-religion": _hold2,
    "love-of-my-life": _hold2,
    "mr-sandman": _hold2,
    "my-girl": _hold2,
    "number-1-party-anthem": _hold2,
    "raindrops-keep-fallin-on-my-head": _hold2,
    "shallow": _hold2,
    "sounds-of-silence": _hold2,
    "sweet-child-of-mine": _hold2,
    "take-me-out": _hold2,
    "teenage-dirtbag": _hold2,
    "tender": _hold2,
    "thinking-out-loud": _hold2,
    "this-charming-man": _hold2,
    "toxicity": _hold2,
    "under-pressure": _hold2,
    # // marks 2-bar holds; D// etc. in the bridge.
    "accidentally-in-love": [4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,8,8,8,8,
                             8,8,8,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,
                             8,8,8,8,8,8,8,8,8,4,4,8,8,8,8,8,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,4,
                             4,4,4,4,4,4,4,8,8,8,8,8,8,8,8,8,8,8,8,4,4,4],
    "basket-case": [
        4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,
        8,8,8,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
        4,4,8,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
        4,4,4,4,8,8,4,4,4,8,8,4,4,4,8,8,4],
    "californication": [
        4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,8,4,4,4,4,4,4,4,4,8,8,8,8,4,4,4,4,4,
        4,4,4,4,4,4,4,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,4,8,8,8,8,4,4,4,4,4,4,
        4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,
        4,4,4,4,4,8,8,8,8,8,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,8,8,8,8,4,4,4,4,
        4,4,4,4,4,4,4,4,8,8,8,8,8,8,4,4,8,8,8,8,8,8,4],
    "have-you-ever-seen-the-rain": [
        4,4,4,4,4,4,4,4,4,8,8,4,4,4,8,8,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,4,4,
        8,8,4,4,4,4,4,4,8,8,4,4,4,8,8,4,4,4,4,4,4],
    "hey-ya": [
        4,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
        4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
        4,4,4,4,4,4,4,4,8],
    "imagine": [
        4,4,4,4,4,4,4,4,8,8,8,8,4,4,4,4,4,4,4,4,4,4,8,8,8,8,4,4,8,8,8,8,8,
        8,8,8,8,8,8,8,8,8,8,8,4,4,4,4,4,4,4,4,8,8,8,8,4,4,8,8,8,8,8,8,8,8,
        8,4,4,8,8,4,4],
    "the-final-countdown": [
        4,4,4,4,4,4,4,4,8,8,8,8,4,4,4,4,4,4,4,4,8,8,4,4,4,8,8,8,8,4,4,4,4,
        4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,4,4,4,8,8,8,8,4,4,4,4,4,4,4,4,4,
        4,4,4,8,8,8,8,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,8,8,8,8,
        4,4],
    "somebody-to-love": [
        4,8,8,4,4,4,8,8,4,4,4,8,8,4,4,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,4,8,
        8,4,4,4,8,8,4,4,4,8,8,4,4,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,4,8,8,4,
        4,4,8,8,4,4,4,8,8,4,4,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,4,8,8,4,4,4,
        8,8,4,4,4,8,8,4,4,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,4,4],
}


def _beat_resolver(spec):
    if callable(spec):
        return spec
    if isinstance(spec, dict):
        def resolve(tok):
            name = tok.rstrip('/')
            if name in spec:
                return spec[name]
            return spec.get(name.split('/')[0], spec.get('*'))
        return resolve
    if isinstance(spec, list):
        it = iter(spec)
        return lambda tok: next(it, None)
    return lambda tok: spec


def apply_beats(sheet, spec):
    """Annotate the chord tokens in a sheet with ':N' beat counts. Returns the
    number of chord tokens seen (so list specs can be checked for length)."""
    tokens = 0
    if not spec:
        return tokens
    resolve = _beat_resolver(spec)
    token_re = re.compile(r'^([A-G][A-Za-z0-9+#b]*(?:/[A-G][A-Za-z0-9+#b]*)?)(/+)?$')
    for line in sheet:
        for seg in line:
            if seg[0] != 'c':
                continue
            m = re.match(r'^\[([\s\S]*)\]$', seg[1])
            inner = m.group(1) if m else seg[1]
            out, changed = [], False
            for tok in inner.split():
                tokens += 1
                beats = resolve(tok)
                tm = token_re.match(tok)
                if tm and beats:
                    out.append('%s:%s%s' % (tm.group(1), beats, tm.group(2) or ''))
                    changed = True
                else:
                    out.append(tok)
            if changed:
                seg[1] = '[' + ' '.join(out) + ']'
    return tokens

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
        specs = BEATS.get(sid)
        seen = apply_beats(song['sheet'], specs)
        if isinstance(specs, list) and len(specs) != seen:
            warn('%s: beats list has %d entries but sheet has %d chords'
                 % (sid, len(specs), seen))
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