/* Songbook — section roles
 * A canonical bilingual section-role model shared with chordpro.py's
 * SECTION_ROLES / SECTION_ALIASES. Every section label (English or Polish)
 * normalises to one stable role, so the build and the running app never
 * disagree on whether "Zwrotka 2" and "Verse 2" are the same section. This is
 * the foundation for per-section strum selectors and for language-independent
 * exported JSON.
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order set
 * by index.html; tests/sections.py guards that this copy cannot drift from
 * chordpro.py.
 */
(function (SB) {
    'use strict';

    /* Canonical roles, mirrored from chordpro.py SECTION_ROLES. */
    var SECTION_ROLES = [
        'intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'outro',
        'interlude', 'solo', 'tag', 'other',
    ];

    /* Normalised label -> canonical role. Keys are produced by normaliseSection;
     * multi-word keys match exactly first, then any single word in the label.
     * Mirrored from chordpro.py SECTION_ALIASES. */
    var SECTION_ALIASES = {
        // canonical roles (self-maps)
        intro: 'intro',
        verse: 'verse',
        'pre chorus': 'pre_chorus',
        chorus: 'chorus',
        bridge: 'bridge',
        outro: 'outro',
        interlude: 'interlude',
        solo: 'solo',
        tag: 'tag',
        other: 'other',
        // English variants
        introduction: 'intro',
        refrain: 'chorus',
        hook: 'chorus',
        coda: 'outro',
        instrumental: 'interlude',
        // Polish
        wstep: 'intro',
        zwrotka: 'verse',
        refren: 'chorus',
        most: 'bridge',
        zakonczenie: 'outro',
        przejscie: 'pre_chorus',
    };

    var _POLISH = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
        'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    };
    var _SECTION_PUNCT = /[()\[\]{},.;:/\\-]/g;

    function normaliseSection(text) {
        // Fold a section label to a canonical lookup key: lowercase, fold
        // Polish diacritics (ł does not decompose under NFKD, so it is done
        // explicitly), turn punctuation and parentheses into spaces, drop
        // trailing numbers ("Verse 2" -> "verse"), collapse whitespace.
        var s = String(text == null ? '' : text).trim().toLowerCase();
        s = s.replace(/[ąćęłńóśźż]/g, function (ch) { return _POLISH[ch]; });
        // NFKD folds remaining accents (e.g. ć -> c + combining acute); strip
        // the combining marks so nothing non-ASCII survives.
        s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        s = s.replace(_SECTION_PUNCT, ' ');
        s = s.replace(/\s+\d+\s*$/, '');      // trailing verse/chorus numbers
        return s.replace(/\s+/g, ' ').trim();
    }

    function sectionRole(label) {
        var key = normaliseSection(label);
        if (!key) return 'other';
        var role = SECTION_ALIASES[key];
        if (role) return role;
        var words = key.split(/\s+/);
        for (var i = 0; i < words.length; i++) {
            role = SECTION_ALIASES[words[i]];
            if (role) return role;
        }
        return 'other';
    }

    function isSectionRole(value) {
        return typeof value === 'string' && SECTION_ROLES.indexOf(value) >= 0;
    }

    SB.SECTION_ROLES = SECTION_ROLES;
    SB.sectionRole = sectionRole;
    SB.isSectionRole = isSectionRole;

})(window.SB = window.SB || {});
