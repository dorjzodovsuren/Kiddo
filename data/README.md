# Channel data

One JSON file per channel. These files are the **only** place video content
lives — no video url, title or description is written into the HTML.

To add or change videos, edit the file for that channel. Nothing needs to be
rebuilt: the pages fetch these files fresh on every load (see *Caching* below),
so an upload shows up on the next page view.

## File shape

```jsonc
{
  "slug": "nutshell",                    // must match the filename
  "name": "Kurzgesagt – In a Nutshell",  // shown as the channel heading
  "page": "channel-nutshell.html",       // the channel's own page
  "intro": "…",                          // one line, shown on the channel page hero
  "about": "…",                          // longer paragraph, shown on the homepage
  "tagline": "…",
  "videos": [ … ]                        // newest first — see Ordering
}
```

Each entry in `videos`:

```jsonc
{
  "id": "modalVideo",                                      // unique within the file
  "youtube": "dFCbJmgeHmA",                                // the YouTube id
  "url": "https://www.youtube.com/embed/dFCbJmgeHmA",      // the embed url actually used
  "published": "2021-03-14",                               // upload date, or null — see Ordering
  "title": "ҮЛЭМЖ ЗАЛУУС",
  "heading": "Үлгэрийн цаг",
  "summary": "…",                                          // shown on the card
  "questions": ["…", "…"],                                 // prompts under the summary
  "voiceover": "https://example.com/audio/dub.mp3"         // optional direct audio url, see Voice-over below
}
```

All reader-facing text (`intro`, `about`, `title`, `summary`, `questions`)
should be Mongolian.

`published` may be `null`, or left out entirely — see *Ordering*.

## Quotes inside text — the easy way to break a file

A double quote inside a value **must** be written `\"`, because a bare `"`
ends the string and makes the file invalid JSON:

```jsonc
"summary": "… тодорхойлогдсон "утга учир"-гүй бол …"     // ✗ breaks the file
"summary": "… тодорхойлогдсон \"утга учир\"-гүй бол …"   // ✓
"summary": "… тодорхойлогдсон «утга учир»-гүй бол …"     // ✓ and easier to read
```

This has bitten this repo once already: one unescaped pair made the whole
channel unreadable. Guillemets `« »` avoid the problem entirely and are normal
in Mongolian typography, so prefer them over `"` in body text.

After editing, check the file parses before pushing:

```sh
python3 -m json.tool data/nutshell.json > /dev/null && echo OK
```

`npm test` also fails if any file in this folder is not valid JSON.

## Ordering and the sort control

The sort button next to the search box switches between newest-first and
oldest-first.

- If **every** video in a file has a real `published` date, the sort uses those
  dates.
- If **any** is `null`, the sort falls back to the order the videos appear in
  the `videos` array, which is taken to be **newest first**.

So the control works with the files as they are, and becomes exact as soon as
real dates are filled in. `published` is `null` everywhere today because the
upload dates were never recorded in this repo — fill them in as
`"YYYY-MM-DD"` when you know them.

The homepage shows the newest 3 videos per channel. Sorting reorders those
three for display; it does not swap in older ones.

## Voice-over

A video with a `voiceover` url gets a single "Эх дуу" / "Оруулсан дуу" toggle
on its card that mutes the YouTube player and plays that audio file in sync
with it, and back again. A video with no `voiceover` url has no toggle — there
is nothing to switch to.

This JSON file is the **only** source for that audio: there is no upload
button and nothing is entered or remembered per-visitor. To add or change a
video's voice-over, edit its `voiceover` url here, the same way you'd edit its
`title` or `summary`. It must be a direct link to a playable audio file (e.g.
`.mp3`), not a page that merely links to one — a GitHub "blob" page like
`github.com/.../blob/main/audio/x.mp3` won't play; use the corresponding
`raw.githubusercontent.com/.../main/audio/x.mp3` link instead.

## Caching

`js/video-data.js` requests these files with `cache: "no-store"` and a unique
`?t=` query string, so neither the browser nor a CDN (GitHub Pages included)
can serve a stale copy. That is what makes an upload appear immediately.

The pages must be served over http(s) — `fetch()` is blocked on `file://`, so
opening the HTML straight off disk shows a load error instead of the videos.
