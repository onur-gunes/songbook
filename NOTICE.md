# Notice — no third-party song data is bundled

The PolyForm Noncommercial license in [`LICENSE`](LICENSE) covers the **source
code** of this project (the app, chord engine, build scripts and tests).

This repository ships **no third-party song data**. It contains the engine and
one small original demo book. Lyrics, melodies, chord charts, arrangements,
tabs and transcriptions of songs you import remain the property of their
respective authors, arrangers and publishers; importing them does not relicense
them.

## Demo book

`songbooks/demo.json` (authored in `chordpro/demo/`) contains three short songs
written for this project. They are original, contain no third-party lyrics or
melodies, and are covered by the same license as the code.

## Imported songbooks

Songbooks you import are **your responsibility**. The app stores imported JSON
locally in your browser (IndexedDB) and does not upload or redistribute it.
Only import material you have the rights to use, and do not redistribute it
unless the rights holder allows it. Some songs may be in the public domain;
specific arrangements and transcriptions can still be protected.

## Authoring and migration tools

`build_songbook.py`, `chordpro.py` and `migrate.py` are tools, not content.
`migrate.py` and `mirror_songbook.py` can rebuild or fetch a book from sources
you provide or host yourself; running them does not make this project the
publisher of that content, and you are responsible for how you use the result.

## Third-party code — tuner

`tuner.js` includes a pitch-detection engine adapted from
[fgnass/tuner](https://github.com/fgnass/tuner), used under the MIT license.

> MIT License
>
> Copyright (c) 2026 Felix Gnass
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Takedown

If you hold rights to any content in an imported book and believe it has been
redistributed improperly, please open an issue and it will be addressed
promptly. Content that is not part of this repository cannot be removed here,
but we will help identify where it came from.
