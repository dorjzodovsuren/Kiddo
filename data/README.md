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
  "voiceover": "https://example.com/audio/dub.mp3"         // optional, see Voice-over below
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

Every video card has an "Эх дуу" / "Оруулсан дуу" toggle that mutes the
YouTube player and plays a separate voice-over audio file in sync with it,
and back again.

- `voiceover` in this file sets the default audio for that video (a direct
  link to an `.mp3`/`.wav` file). It's optional and may be omitted.
- A visitor can also open the toggle's settings (gear icon) on any card and
  paste their own audio URL, or pick a local file. A pasted URL is saved in
  the browser's `localStorage`, so it comes back on their next visit; a local
  file only plays for that visit, since there is nowhere for the site to
  upload it to.
- A visitor's saved link always takes priority over this file's `voiceover`
  default, for that video, in that browser.

## Caching

`js/video-data.js` requests these files with `cache: "no-store"` and a unique
`?t=` query string, so neither the browser nor a CDN (GitHub Pages included)
can serve a stale copy. That is what makes an upload appear immediately.

The pages must be served over http(s) — `fetch()` is blocked on `file://`, so
opening the HTML straight off disk shows a load error instead of the videos.
