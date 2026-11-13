/* Songbook — ChordPro parser
 * A browser-side port of chordpro.py's authoring subset, so songs can be
 * pasted or uploaded in the app instead of only built ahead of time.
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order set
 * by index.html; it depends on SB.sectionRole (js/sections.js), the metre and
 * tempo constants in js/songbooks.js and the pattern ids in js/strum.js, and
 * must therefore load after all three. tests/chordpro_js.py guards that this
 * parser and chordpro.py cannot drift.
 *
 * This module parses; it does not validate. The result is passed through
 * SB.normalizeSongbook by the caller, which stays the single trust boundary.
 */
(function (SB) {
    'use strict';

    /* Mirrored from chordpro.py METADATA_DIRECTIVES. Directive names are
     * lowercased and spaces become underscores before lookup. */
    var METADATA_DIRECTIVES = {
        'id': 'id',
        'title': 'title', 't': 'title',
        'artist': 'artist', 'subtitle': 'artist', 'st': 'artist',
        'level': 'level',
        'duration': 'dur',
        'tempo': 'bpm', 'bpm': 'bpm',
        'time': 'time', 'meter': 'time',
        'strum': 'strum',
        'key': 'key',
        'sheetkey': 'sheetKey',
        'capo': 'capo',
        'new': 'new',
        'number': 'n',
        'chords': 'chords',
    };

    var LEVELS = ['Easy', 'Medium', 'Hard'];

    /* Python's str.splitlines() boundaries. String.split() only knows \n and
     * \r\n, and a line break it misses would leak into a lyric or a grid. */
    var LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
    var LINE_BREAK_END = /[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/;

    function splitLines(text) {
        if (!text) return [];
        var lines = text.split(LINE_BREAK);
        // splitlines() does not add an empty line after a trailing break.
        if (lines.length && lines[lines.length - 1] === '' && LINE_BREAK_END.test(text)) {
            lines.pop();
        }
        return lines;
    }

    /* Warning text is part of the parity contract: the Python builder prints
     * these strings, so the browser must produce the same wording, including
     * the repr() quoting of offending values. */
    function pyRepr(value) {
        var s = String(value);
        var quote = (s.indexOf("'") >= 0 && s.indexOf('"') < 0) ? '"' : "'";
        var out = quote;
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            if (ch === '\\') out += '\\\\';
            else if (ch === quote) out += '\\' + quote;
            else if (ch === '\n') out += '\\n';
            else if (ch === '\r') out += '\\r';
            else if (ch === '\t') out += '\\t';
            else {
                var code = s.charCodeAt(i);
                out += (code < 32 || code === 127) ? '\\x' + (code < 16 ? '0' : '') + code.toString(16) : ch;
            }
        }
        return out + quote;
    }

    function reprList(list) {
        return '[' + list.map(pyRepr).join(', ') + ']';
    }

    /* Mirrors chordpro.slugify: NFKD-decompose, drop everything non-ASCII
     * (the build's encode('ascii', 'ignore')), then hyphenate. */
    function slugify(text) {
        var s = String(text == null ? '' : text).normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
        s = s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
        return s.slice(0, 48) || 'song';
    }

    /* Return [key, value] for a {key: value} line, else null. */
    function directive(line) {
        var m = /^\s*\{([^{}]*)\}\s*$/.exec(line);
        if (!m) return null;
        var body = m[1];
        var key, value;
        var colon = body.indexOf(':');
        if (colon >= 0) {
            key = body.slice(0, colon);
            value = body.slice(colon + 1);
        } else {
            key = body;
            value = '';
        }
        key = key.trim().toLowerCase().replace(/ /g, '_');
        value = value.trim();
        if (value.length >= 2 && value.charAt(0) === value.charAt(value.length - 1)
            && (value.charAt(0) === '"' || value.charAt(0) === "'")) {
            value = value.slice(1, -1).trim();
        }
        return [key, value];
    }

    /* Tokenize one lyric line. Chords keep their brackets, text is verbatim,
     * and a backslash escapes a literal bracket or backslash. A blank line is
     * an empty list, never a single empty text token. */
    function parseLine(line) {
        if (!line || !line.trim()) return [];
        var tokens = [];
        var buf = [];
        var pos = 0;
        while (pos < line.length) {
            var ch = line.charAt(pos);
            if (ch === '\\' && pos + 1 < line.length
                && (line.charAt(pos + 1) === '[' || line.charAt(pos + 1) === ']'
                    || line.charAt(pos + 1) === '\\')) {
                buf.push(line.charAt(pos + 1));
                pos += 2;
            } else if (ch === '[') {
                var end = line.indexOf(']', pos + 1);
                if (end < 0) {
                    buf.push(line.slice(pos));
                    break;
                }
                var chord = line.slice(pos + 1, end).trim();
                if (!chord) {
                    buf.push(line.slice(pos, end + 1));
                    pos = end + 1;
                    continue;
                }
                if (buf.length) {
                    tokens.push(['x', buf.join('')]);
                    buf = [];
                }
                tokens.push(['c', '[' + chord + ']']);
                pos = end + 1;
            } else {
                buf.push(ch);
                pos += 1;
            }
        }
        if (buf.length) tokens.push(['x', buf.join('')]);
        return tokens;
    }

    function asBool(value) {
        var v = String(value).trim().toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
        if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off' || v === '') return false;
        return null;
    }

    /* Python float() for the values that can appear in a directive: strict,
     * so "92bpm" is invalid rather than parseFloat's 92. */
    function toFloat(value) {
        if (typeof value === 'number') return isFinite(value) ? value : null;
        var s = String(value == null ? '' : value).trim();
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
        return Number(s);
    }

    /* Python int() for a directive value; "2.5" is a ValueError, not 2. */
    function toInt(value) {
        var s = String(value == null ? '' : value).trim();
        return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
    }

    /* Python's round() is half-to-even, unlike Math.round's half-up. Tempo is
     * compared against the same bounds as the build, so the rounding mode is
     * observable ("92.5" is 92 there and 93 here otherwise). */
    function pyRound(n) {
        var floor = Math.floor(n);
        var diff = n - floor;
        if (diff > 0.5) return floor + 1;
        if (diff < 0.5) return floor;
        return (floor % 2 === 0) ? floor : floor + 1;
    }

    function parseBpm(value) {
        var number = toFloat(value);
        if (number === null) return null;
        number = pyRound(number);
        if (number < SB.BPM_MIN || number > SB.BPM_MAX) return null;
        return number;
    }

    function parseTime(value) {
        var text = String(value == null ? '' : value).trim().replace(/ /g, '');
        return SB.TIME_SIGNATURES.indexOf(text) >= 0 ? text : null;
    }

    function strumIds() {
        var ids = Object.create(null);
        SB.strumPatterns().forEach(function (p) { ids[p.id] = true; });
        return ids;
    }

    function parseStrum(value, ids) {
        var text = String(value == null ? '' : value).trim();
        return ids[text] ? text : null;
    }

    function deriveChords(sheet) {
        var chords = [];
        sheet.forEach(function (line) {
            line.forEach(function (seg) {
                if (seg[0] !== 'c') return;
                var name = seg[1];
                if (name.charAt(0) === '[' && name.charAt(name.length - 1) === ']') {
                    name = name.slice(1, -1).trim();
                }
                if (name && chords.indexOf(name) < 0) chords.push(name);
            });
        });
        return chords;
    }

    /* ---------------- bar/beat grid ---------------- */

    var BARLINE = /(\|:|:\||\|)/;

    /* Parse one bar's text into [{chord, beats}]. A lone chord fills the bar;
     * otherwise each chord gets one beat plus one per trailing dot. */
    function gridBarBeats(barText, beatsPerBar) {
        var entries = [];
        var tokens = barText.trim() ? barText.trim().split(/\s+/) : [];
        tokens.forEach(function (tok) {
            if (/^\.+$/.test(tok)) {
                if (!entries.length) throw new Error("'.' with no preceding chord");
                entries[entries.length - 1].beats += tok.length;
            } else {
                entries.push({ chord: tok, beats: 1 });
            }
        });
        if (!entries.length) throw new Error('empty bar');
        if (beatsPerBar !== null && entries.length === 1 && entries[0].beats === 1) {
            entries[0].beats = beatsPerBar;
        }
        return entries;
    }

    /* Split one bar-line-delimited line into (seps, barTexts). Text outside
     * the outermost bar lines, or an empty interior bar, is an error. */
    function gridLineBars(label, line) {
        var parts = line.split(BARLINE);
        var pre = parts[0].trim();
        if (pre) throw new Error('grid block ' + pyRepr(label) + ': text before first bar line: ' + pyRepr(pre));
        // split() interleaves [pre, sep, bar, sep, bar, ..., sep, post].
        var seps = [];
        var contents = [];
        for (var i = 1; i < parts.length; i += 2) seps.push(parts[i]);
        for (var j = 2; j < parts.length; j += 2) contents.push(parts[j]);
        if (!seps.length) throw new Error('grid block ' + pyRepr(label) + ': a line has no bar lines');
        var post = contents.length ? contents[contents.length - 1].trim() : '';
        if (post) throw new Error('grid block ' + pyRepr(label) + ': text after last bar line: ' + pyRepr(post));
        var barTexts = contents.slice(0, -1);
        if (!barTexts.length) throw new Error('grid block ' + pyRepr(label) + ': a line has no bars');
        return [seps, barTexts];
    }

    function parseGridBlock(label, bodyLines, timeSig) {
        var beatsPerBar = SB.beatsPerBar(timeSig);
        var lines = bodyLines.map(function (l) { return l.trim(); })
            .filter(function (l) { return !!l; });
        if (!lines.length) throw new Error('grid block ' + pyRepr(label) + ' has no bars');

        /* Each line opens and closes with a bar line, so an interior line's
         * opening bar line duplicates the previous line's closing one. Drop
         * the duplicate so the block is one continuous bar sequence. */
        var seps = [];
        var barTexts = [];
        lines.forEach(function (line, i) {
            var parsed = gridLineBars(label, line);
            var lineSeps = parsed[0];
            if (i > 0) {
                if (lineSeps[0] !== '|' || seps[seps.length - 1] !== '|') {
                    throw new Error('grid block ' + pyRepr(label)
                        + ': repeat mark on an interior line break');
                }
                lineSeps = lineSeps.slice(1);
            }
            seps = seps.concat(lineSeps);
            barTexts = barTexts.concat(parsed[1]);
        });

        /* Repeats are a balanced pair at the block's edges only: one `|:` at
         * the start and/or one `:|` at the end. A lone trailing `:|` repeats
         * from the block start, so it is balanced on its own. */
        var opens = [];
        var closes = [];
        seps.forEach(function (s, i) {
            if (s === '|:') opens.push(i);
            if (s === ':|') closes.push(i);
        });
        if (opens.some(function (i) { return i !== 0; }) || opens.length > 1) {
            throw new Error('grid block ' + pyRepr(label)
                + ': open-repeat must be a single mark at the start');
        }
        if (closes.some(function (i) { return i !== seps.length - 1; }) || closes.length > 1) {
            throw new Error('grid block ' + pyRepr(label)
                + ': close-repeat must be a single mark at the end');
        }

        return {
            label: label,
            role: SB.sectionRole(label),
            repeat: !!(opens.length || closes.length),
            bars: barTexts.map(function (bt) {
                return { beats: gridBarBeats(bt, beatsPerBar) };
            }),
        };
    }

    /* ---------------- song ---------------- */

    function has(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function get(obj, key, fallback) {
        return has(obj, key) ? obj[key] : fallback;
    }

    function parseSong(text, options) {
        options = options || {};
        if (typeof text !== 'string') throw new Error('ChordPro source must be a string');
        if (text.charAt(0) === '\ufeff') text = text.slice(1);

        var warnings = [];
        var allowTrustedNotes = !!options.allowTrustedNotes;
        var number = (typeof options.number === 'number' && isFinite(options.number)) ? options.number : 1;
        var meta = Object.create(null);
        var sheet = [];
        var inTab = false;
        /* Grid blocks are collected raw and parsed after `time` is known: a
         * lone bare chord's beat count depends on the metre. */
        var rawGrids = [];
        var gridLabel = null;
        var gridLines = null;

        splitLines(text).forEach(function (raw) {
            var d = directive(raw);
            if (d !== null) {
                var key = d[0], value = d[1];
                if (gridLines !== null && key !== 'end_of_grid' && key !== 'eog') {
                    // A grid is line-scoped like a tab; a directive inside it
                    // is almost certainly a missing {end_of_grid}.
                    warnings.push('directive {' + key + '} inside grid block '
                        + pyRepr(gridLabel) + ': did you forget {end_of_grid}?');
                }
                if (has(METADATA_DIRECTIVES, key)) {
                    meta[METADATA_DIRECTIVES[key]] = value;
                } else if (key === 'start_of_chorus' || key === 'soc') {
                    sheet.push([['i', '(Chorus)']]);
                } else if (key === 'end_of_chorus' || key === 'eoc') {
                    // no-op: the chorus marker is the start line
                } else if (key === 'start_of_tab' || key === 'sot') {
                    inTab = true;
                } else if (key === 'end_of_tab' || key === 'eot') {
                    inTab = false;
                } else if (key === 'start_of_grid' || key === 'sog') {
                    gridLabel = value;
                    gridLines = [];
                } else if (key === 'end_of_grid' || key === 'eog') {
                    if (gridLines !== null) rawGrids.push([gridLabel, gridLines]);
                    gridLabel = null;
                    gridLines = null;
                } else if (key === 'comment' || key === 'c') {
                    if (value) sheet.push([['i', value]]);
                } else if (key === 'trusted_note') {
                    // Rendered through innerHTML; never trust user input.
                    if (!allowTrustedNotes) {
                        warnings.push('trusted_note ignored: book does not allow trusted notes');
                    } else if (value) {
                        sheet.push([['y', value]]);
                    }
                }
                // Other directives are intentionally ignored: the authoring
                // subset is deliberately small.
                return;
            }

            if (gridLines !== null) {
                if (raw.replace(/^\s+/, '').charAt(0) !== '#') gridLines.push(raw);
                return;
            }

            if (raw.replace(/^\s+/, '').charAt(0) === '#') return;

            if (inTab) {
                if (raw.trim()) sheet.push([['p', raw.replace(/\s+$/, '')]]);
                else sheet.push([]);
                return;
            }

            sheet.push(parseLine(raw));
        });

        if (gridLines !== null) {
            // Unterminated block: parse what we have rather than drop it.
            warnings.push('grid block ' + pyRepr(gridLabel) + ' is missing {end_of_grid}');
            rawGrids.push([gridLabel, gridLines]);
        }

        while (sheet.length && !sheet[0].length) sheet.shift();
        while (sheet.length && !sheet[sheet.length - 1].length) sheet.pop();

        var title = String(get(meta, 'title', '')).trim();
        var artist = String(get(meta, 'artist', '')).trim();

        var level = String(get(meta, 'level', '')).trim();
        if (!level) {
            warnings.push('missing level, defaulting to Medium');
            level = 'Medium';
        } else {
            level = level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
            if (LEVELS.indexOf(level) < 0) {
                warnings.push('invalid level ' + pyRepr(get(meta, 'level', ''))
                    + ', defaulting to Medium');
                level = 'Medium';
            }
        }

        var durRaw = String(get(meta, 'dur', '')).trim();
        var dur;
        if (!durRaw) {
            warnings.push('missing duration, defaulting to 3');
            dur = 3.0;
        } else {
            var parsedDur = toFloat(durRaw);
            if (parsedDur === null) {
                warnings.push('invalid duration ' + pyRepr(durRaw) + ', defaulting to 3');
                dur = 3.0;
            } else {
                dur = parsedDur;
            }
        }

        var n = number;
        if (has(meta, 'n')) {
            var parsedN = toInt(meta.n);
            if (parsedN === null) warnings.push('invalid number ' + pyRepr(meta.n));
            else n = parsedN;
        }

        var isNew = false;
        if (has(meta, 'new')) {
            var parsedNew = asBool(meta.new);
            if (parsedNew === null) {
                warnings.push('invalid new value ' + pyRepr(meta.new) + ', defaulting to false');
            } else {
                isNew = parsedNew;
            }
        }

        var rawId = String(get(meta, 'id', '')).trim();
        var songId = slugify(title);
        if (rawId) {
            if (/^[a-z0-9-]+$/.test(rawId)) {
                songId = rawId;
            } else {
                warnings.push('invalid id ' + pyRepr(rawId) + ', slugifying');
                songId = slugify(rawId) || songId;
            }
        }

        var song = {
            id: songId,
            n: n,
            title: title,
            artist: artist,
            level: level,
            new: isNew,
            dur: dur,
        };

        var keySig = String(get(meta, 'key', '')).trim();
        var sheetKey = String(get(meta, 'sheetKey', '')).trim();
        if (keySig) {
            song.key = keySig;
            song.sheetKey = sheetKey || keySig;
        } else if (sheetKey) {
            song.sheetKey = sheetKey;
        }
        if (has(meta, 'capo')) {
            var capo = toInt(meta.capo);
            if (capo === null) {
                warnings.push('invalid capo ' + pyRepr(meta.capo) + ', defaulting to 0');
                song.capo = 0;
            } else {
                song.capo = capo;
            }
        } else if (keySig || sheetKey) {
            song.capo = 0;
        }

        /* An unparseable tempo/time/strum is kept verbatim and warned about,
         * mirroring the build: a typo must fail validation rather than be
         * silently guessed into a different tempo or pattern. */
        var bpmRaw = String(get(meta, 'bpm', '')).trim();
        if (bpmRaw) {
            var bpm = parseBpm(bpmRaw);
            if (bpm === null) {
                warnings.push('invalid tempo ' + pyRepr(bpmRaw) + ' (expected '
                    + SB.BPM_MIN + '-' + SB.BPM_MAX + ' bpm)');
                song.bpm = bpmRaw;
            } else {
                song.bpm = bpm;
            }
        }

        var timeRaw = String(get(meta, 'time', '')).trim();
        if (timeRaw) {
            var timeSig = parseTime(timeRaw);
            if (timeSig === null) {
                warnings.push('invalid time signature ' + pyRepr(timeRaw) + ' (expected '
                    + SB.TIME_SIGNATURES.join(', ') + ')');
                song.time = timeRaw;
            } else {
                song.time = timeSig;
            }
        }

        var strumRaw = String(get(meta, 'strum', '')).trim();
        if (strumRaw) {
            var ids = strumIds();
            var strumId = parseStrum(strumRaw, ids);
            if (strumId === null) {
                warnings.push('invalid strum ' + pyRepr(strumRaw) + ' (expected one of '
                    + Object.keys(ids).sort().join(', ') + ')');
                song.strum = strumRaw;
            } else {
                song.strum = strumId;
            }
        }

        song.chords = deriveChords(sheet);
        var chordsRaw = String(get(meta, 'chords', '')).trim();
        if (chordsRaw) {
            var overridden = chordsRaw.split(',').map(function (name) {
                return name.trim();
            }).filter(function (name) { return !!name; });
            if (overridden.length) {
                var missing = song.chords.filter(function (c) {
                    return overridden.indexOf(c) < 0;
                }).sort();
                var unused = overridden.filter(function (c) {
                    return song.chords.indexOf(c) < 0;
                }).sort();
                if (missing.length || unused.length) {
                    warnings.push('chords override differs from sheet (missing: '
                        + (missing.length ? reprList(missing) : 'none')
                        + ', unused: ' + (unused.length ? reprList(unused) : 'none') + ')');
                }
                song.chords = overridden;
            }
        }
        song.sheet = sheet;

        /* Grids last: a lone bare chord's beat count depends on the metre. A
         * malformed block is dropped with a warning rather than emitted half
         * valid; the build validates beat totals against `time` later. */
        if (rawGrids.length) {
            var validTime = parseTime(String(get(meta, 'time', '')).trim());
            var grid = [];
            rawGrids.forEach(function (entry) {
                try {
                    grid.push(parseGridBlock(entry[0], entry[1], validTime));
                } catch (err) {
                    warnings.push('dropped grid block: ' + err.message);
                }
            });
            if (grid.length) song.grid = grid;
        }

        return { song: song, warnings: warnings };
    }

    /* options:
     *   number           default song order, matching parse_song's `number`
     *   allowTrustedNotes keep {trusted_note} as the legacy innerHTML kind
     * Malformed content is warned about and dropped exactly as chordpro.py
     * does (a bad grid block must not abort the song); only a non-string
     * argument throws. */
    SB.parseChordPro = function (text, options) {
        return parseSong(text, options);
    };

})(window.SB = window.SB || {});
