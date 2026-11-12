/* Songbook — export
 * effective-song serialisation and JSON downloads
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- file names ---------------- */

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    /* Local time, YYYYMMDD-HHMMSS. The filename is for the user's own archive,
     * so "when I downloaded it" is the useful timestamp, and local time matches
     * the clock on the device that saved it. */
    SB.exportTimestamp = function (date) {
        date = date || new Date();
        return String(date.getFullYear()) + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
            '-' + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
    };

    /* Keep a file name safe on every platform without changing its meaning:
     * song and songbook ids are already lower-case and dashed in practice, but
     * an imported title or id may contain spaces, slashes or punctuation. */
    function fileSlug(value) {
        var slug = String(value == null ? '' : value).toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return slug || 'export';
    }

    SB.exportFilename = function (base, date) {
        return fileSlug(base) + '-' + SB.exportTimestamp(date) + '.json';
    };

    /* ---------------- effective song ---------------- */

    /* The plan belongs to a songbook + song pair, so it is read through the
     * active book when the caller does not already have one in hand. Tests and
     * the songbook exporter pass the plan explicitly. */
    function planFor(song) {
        if (SB.state && SB.state.active && song && SB.loadPlan) {
            return SB.loadPlan(SB.state.active.id, song.id);
        }
        return SB.emptyPlan ? SB.emptyPlan() : null;
    }

    /* The songbook fields (section strums, custom patterns) are the baseline;
     * the local plan is the overlay. planWithSong() is the same merge the
     * runtime uses, so export and playback can never disagree about which
     * pattern a section inherits. */
    function mergedPlan(song, plan) {
        if (plan === undefined) plan = planFor(song);
        plan = SB.normalizePlan ? SB.normalizePlan(plan) : plan;
        return SB.strumPlanFor ? SB.strumPlanFor(song, plan) : plan;
    }

    function songWithTime(song, time) {
        var copy = {};
        Object.keys(song).forEach(function (key) { copy[key] = song[key]; });
        if (time) copy.time = time;
        else delete copy.time;
        return copy;
    }

    function copySheet(sheet) {
        return (sheet || []).map(function (line) {
            return (line || []).map(function (seg) {
                return [seg[0], seg[1]];
            });
        });
    }

    /* An id is only exported when it actually resolves for the effective
     * metre. The runtime already treats a wrong-metre or unknown id as "no
     * choice"; writing it would make the build reject a song the app happily
     * played, so the export drops it instead. */
    function resolves(id, time, plan) {
        if (!id || !time) return null;
        if (SB.strumPatternFor) {
            return SB.strumPatternFor(id, time, plan) ? id : null;
        }
        return id;
    }

    function defaultStrum(song, plan, time) {
        var candidates = [plan && plan.songStrum, song.strum];
        for (var i = 0; i < candidates.length; i++) {
            if (resolves(candidates[i], time, plan)) return candidates[i];
        }
        return null;
    }

    function sectionStrumsFor(plan, time) {
        var out = {};
        var raw = (plan && plan.sectionStrums) || {};
        Object.keys(raw).forEach(function (role) {
            if (!SB.isSectionRole || !SB.isSectionRole(role)) return;
            if (resolves(raw[role], time, plan)) out[role] = raw[role];
        });
        return out;
    }

    /* Custom patterns are per song and must not shadow a built-in. The list
     * from strumPatternsForSong() is already filtered to the effective metre
     * and the slot-count invariant, which is exactly what the build checks. */
    function customPatternsFor(song, plan) {
        var builtIn = {};
        if (SB.strumPatterns) {
            SB.strumPatterns().forEach(function (p) { builtIn[p.id] = true; });
        }
        var list = SB.strumPatternsForSong
            ? SB.strumPatternsForSong(song, plan)
            : ((plan && plan.customPatterns) || []);
        return list.filter(function (p) {
            return p && typeof p.id === 'string' && !builtIn[p.id];
        }).map(function (p) {
            return { id: p.id, name: p.name, time: p.time, subdiv: p.subdiv, slots: p.slots };
        });
    }

    function hasBarOverride(plan, blockIdx, barIdx, bar) {
        if (bar && Array.isArray(bar.strums) && bar.strums.length) return true;
        var key = SB.planBarKey(blockIdx, barIdx);
        if (plan && plan.barStrums && plan.barStrums[key]) return true;
        var prefix = key + ':';
        var beats = (plan && plan.beatStrums) || {};
        for (var beatKey in beats) {
            if (Object.prototype.hasOwnProperty.call(beats, beatKey) &&
                beatKey.indexOf(prefix) === 0) return true;
        }
        return false;
    }

    /* A bar carries `strums` only when it actually has something to flatten:
     * a bar override, a beat override, or strums authored in the grid. Bars
     * that simply inherit their section/song pattern stay compact and resolve
     * from `sectionStrums`/`strum` after import. Every entry is one felt beat,
     * as the Step 7 schema requires. */
    function barStrums(song, plan, blockIdx, barIdx, bar, totalBeats) {
        if (!totalBeats || !SB.resolveStrumAt) return null;
        if (!hasBarOverride(plan, blockIdx, barIdx, bar)) return null;
        var out = [];
        var width = null;
        for (var beat = 0; beat < totalBeats; beat++) {
            var at = {
                block: blockIdx,
                bar: barIdx,
                beat: beat,
                strums: bar ? bar.strums : null
            };
            var resolved = SB.resolveStrumAt(song, at, plan);
            var slots = resolved && resolved.slots;
            if (typeof slots !== 'string' || !/^[DU-]+$/.test(slots)) return null;
            if (width === null) width = slots.length;
            else if (slots.length !== width) return null;
            out.push(slots);
        }
        return out.length ? out : null;
    }

    function effectiveGrid(song, plan, time) {
        if (!time) return [];
        var gridSong = songWithTime(song, time);
        var hasGrid = (plan && plan.grid && plan.grid.length) ||
            (SB.songHasGrid ? SB.songHasGrid(gridSong)
                : !!(song.grid && song.grid.length));
        if (!hasGrid || !SB.gridBlocksFor) return [];

        var blocks = SB.gridBlocksFor(gridSong, plan);
        var out = [];
        blocks.forEach(function (block, blockIdx) {
            var bars = [];
            (block.bars || []).forEach(function (bar, barIdx) {
                var beats = [];
                var total = 0;
                (bar.beats || []).forEach(function (seg) {
                    var chord = (typeof seg.chord === 'string') ? seg.chord : String(seg.chord == null ? '' : seg.chord);
                    var count = (typeof seg.beats === 'number' && isFinite(seg.beats) && seg.beats >= 1)
                        ? Math.floor(seg.beats) : 1;
                    beats.push({ chord: chord, beats: count });
                    total += count;
                });
                if (!beats.length) return;
                var outBar = { beats: beats };
                var strums = barStrums(gridSong, plan, blockIdx, barIdx, bar, total);
                if (strums) outBar.strums = strums;
                bars.push(outBar);
            });
            if (!bars.length) return;
            out.push({
                label: String(block.label == null ? '' : block.label),
                role: (SB.isSectionRole && SB.isSectionRole(block.role))
                    ? block.role
                    : (SB.sectionRole ? SB.sectionRole(block.label || '') : 'other'),
                repeat: !!block.repeat,
                bars: bars
            });
        });
        return out;
    }

    /* Merge the local plan into a songbook-shaped song object. The result is
     * exactly what SB.normalizeSongbook() and build_songbook.py accept: the
     * effective grid (auto-generated when the song had none), the effective
     * sheet, the merged strum fields, and a canonical role on every block. */
    SB.effectiveSong = function (song, plan) {
        if (!song) return null;
        var merged = mergedPlan(song, plan);
        var time = (merged && merged.time) || song.time || null;

        var out = {
            id: song.id,
            n: song.n,
            title: song.title,
            artist: song.artist,
            level: song.level,
            new: !!song.new,
            key: song.key,
            sheetKey: song.sheetKey,
            capo: song.capo,
            dur: song.dur,
            bpm: song.bpm,
            time: time,
            chords: (song.chords || []).slice(),
            sheet: copySheet(song.sheet)
        };
        /* Authoring source travels with the effective song so an exported
         * book stays editable after re-import. It is not rendered content. */
        if (song.chordpro) out.chordpro = song.chordpro;

        var strum = defaultStrum(song, merged, time);
        if (strum) out.strum = strum;
        var sections = sectionStrumsFor(merged, time);
        if (Object.keys(sections).length) out.sectionStrums = sections;
        var patterns = customPatternsFor(song, merged);
        if (patterns.length) out.strumPatterns = patterns;
        var grid = effectiveGrid(song, merged, time);
        if (grid.length) out.grid = grid;
        return out;
    };

    /* The whole book with every song's plan applied. `imported` is storage
     * bookkeeping, not songbook content, so it is left out as before. */
    SB.effectiveSongbook = function (sb) {
        if (!sb) return null;
        var out = {};
        Object.keys(sb).forEach(function (key) {
            if (key === 'imported') return;
            if (key === 'songs') {
                out.songs = (sb.songs || []).map(function (song) {
                    var plan = (SB.loadPlan && sb.id) ? SB.loadPlan(sb.id, song.id) : undefined;
                    return SB.effectiveSong(song, plan);
                });
            } else {
                out[key] = sb[key];
            }
        });
        if (!Object.prototype.hasOwnProperty.call(out, 'songs')) out.songs = [];
        return out;
    };

    /* ---------------- JSON text and downloads ---------------- */

    /* Raw book JSON, unchanged. Kept for the list-view Export button and for
     * callers that want a byte-for-byte backup of the stored book. */
    SB.songbookJSON = function (sb) {
        var out = {};
        Object.keys(sb).forEach(function (key) {
            if (key !== 'imported') out[key] = sb[key];
        });
        return JSON.stringify(out, null, 2);
    };

    SB.effectiveSongJSON = function (song, plan) {
        return JSON.stringify(SB.effectiveSong(song, plan), null, 2);
    };

    SB.effectiveSongbookJSON = function (sb) {
        return JSON.stringify(SB.effectiveSongbook(sb), null, 2);
    };

    function downloadJSON(text, filename) {
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    SB.exportSongbook = function (sb) {
        if (!sb) return null;
        var filename = SB.exportFilename(sb.id || sb.name);
        downloadJSON(SB.songbookJSON(sb), filename);
        return filename;
    };

    SB.downloadSong = function (song, plan) {
        if (!song) return null;
        var filename = SB.exportFilename(song.id || song.title);
        downloadJSON(SB.effectiveSongJSON(song, plan), filename);
        return filename;
    };

    SB.downloadSongbook = function (sb) {
        if (!sb) return null;
        var filename = SB.exportFilename(sb.id || sb.name);
        downloadJSON(SB.effectiveSongbookJSON(sb), filename);
        return filename;
    };

    /* ---------------- export UI ---------------- */

    function status(message) {
        var el = SB.$('exportStatus');
        if (el) el.textContent = message;
    }

    function currentPlan() {
        if (!SB.state.currentSong) return undefined;
        return planFor(SB.state.currentSong);
    }

    function hideJson() {
        var panel = SB.$('songJsonPanel');
        var btn = SB.$('showSongJsonBtn');
        if (panel) panel.hidden = true;
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = 'Show song JSON';
        }
        status('Song JSON hidden.');
    }

    function showJson() {
        var song = SB.state.currentSong;
        if (!song) { status('Open a song to export it.'); return; }
        var panel = SB.$('songJsonPanel');
        var btn = SB.$('showSongJsonBtn');
        var output = SB.$('songJsonOutput');
        if (!panel || !btn || !output) return;
        output.textContent = SB.effectiveSongJSON(song, currentPlan());
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Hide song JSON';
        status('Effective song JSON shown. Use Copy to put it on the clipboard.');
        try { output.focus({ preventScroll: true }); } catch (e) { output.focus(); }
    }

    function fallbackCopy(output) {
        var range = document.createRange();
        range.selectNodeContents(output);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        selection.removeAllRanges();
        return ok;
    }

    function copyJson() {
        var output = SB.$('songJsonOutput');
        if (!output || !output.textContent) {
            showJson();
            output = SB.$('songJsonOutput');
        }
        var text = output ? output.textContent : '';
        if (!text) { status('Nothing to copy yet.'); return; }

        function copied() { status('Copied song JSON to the clipboard.'); }
        function failed() {
            if (fallbackCopy(output)) copied();
            else status('Copy failed — select the JSON and copy it manually.');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(copied).catch(failed);
        } else {
            failed();
        }
    }

    SB.bindExportControls = function () {
        var show = SB.$('showSongJsonBtn');
        var copy = SB.$('copySongJsonBtn');
        var songBtn = SB.$('downloadSongBtn');
        var bookBtn = SB.$('downloadSongbookBtn');
        if (!show || !copy || !songBtn || !bookBtn) return;

        show.addEventListener('click', function () {
            var panel = SB.$('songJsonPanel');
            if (panel && !panel.hidden) hideJson();
            else showJson();
        });
        copy.addEventListener('click', copyJson);
        songBtn.addEventListener('click', function () {
            var filename = SB.downloadSong(SB.state.currentSong, currentPlan());
            if (filename) status('Downloaded ' + filename + '.');
            else status('Open a song to export it.');
        });
        bookBtn.addEventListener('click', function () {
            var filename = SB.downloadSongbook(SB.state.active);
            if (filename) status('Downloaded ' + filename + '.');
            else status('Open a songbook to export it.');
        });
    };

    /* Called on song navigation so a panel showing the previous song's JSON
     * can never be mistaken for the current one. */
    SB.resetExportUi = function () {
        var panel = SB.$('songJsonPanel');
        var btn = SB.$('showSongJsonBtn');
        var output = SB.$('songJsonOutput');
        if (panel) panel.hidden = true;
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = 'Show song JSON';
        }
        if (output) output.textContent = '';
        status('');
    };

})(window.SB = window.SB || {});
