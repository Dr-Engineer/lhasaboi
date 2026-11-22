# lhasaboi
boy in lhasa

## Ringtone Maker

A small web page that turns any part of a song into an iPhone ringtone or alarm sound. It's free and needs no Mac.
Everything runs in the browser, so songs are never uploaded anywhere.

**Open it:** https://dr-engineer.github.io/lhasaboi/ (after the one-time setup below).
On the iPhone, tap **Share → Add to Home Screen** in Safari so it opens like an app.

### Making a ringtone

1. **Choose a song.** Any audio file you have works: MP3, M4A, WAV, AAC, FLAC… Songs saved inside Apple Music,
   Spotify or YouTube Music won't work, because they're copy-protected.
2. **Pick the part.** The page starts on the loudest 29.5 seconds, which is usually the chorus. Drag the
   highlight, tap the waveform, type a start time like `1:05`, or nudge it, then press **Play** to check.
3. **Make ringtone.** It's saved as an MP3 with a short fade in and out.
4. **On the iPhone (iOS 26 or later):** tap **Share… → Use as Ringtone**. If that isn't in the list, use
   **Save to Files**, then in the Files app touch and hold the file → **Share → Use as Ringtone**.

The new tone then shows up in **Settings → Sounds & Haptics → Ringtone**. It also appears as an alarm sound in
**Clock → Alarms → (alarm) → Sound**. It stays on the phone even if you delete the file.

**From a Windows PC:** open the same page in Edge or Chrome, make the ringtone, and send the small file to your
phone (email or message it to yourself, or use iCloud Drive / OneDrive / Google Drive). On the iPhone, open it
and tap **Share → Use as Ringtone**.

**iOS 18 or older:** there's no "Use as Ringtone" option, so import the file into GarageBand and use
**Share → Ringtone** there. The page's help section has the steps.

### One-time setup: turn on GitHub Pages

The repository is public, so GitHub Pages hosts the page for free:

1. Merge this branch into `main`.
2. On GitHub, go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, select
   `main` and `/ (root)`, and save.
3. After a minute the page is live at the address above.

You can also skip hosting and just double-click `index.html` on the PC. It works from the file as well.

> Don't commit song files to this repository: it's public, so anything in it is published.

### Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole app (HTML, CSS and JavaScript in one file) |
| `vendor/lame.min.js` | MP3 encoder: [lamejs](https://github.com/zhuker/lamejs) 1.2.1, a JavaScript port of [LAME](https://lame.sourceforge.io/), unmodified, LGPL-3.0 (see `vendor/LAME-LICENSE.txt`) |
| `manifest.webmanifest`, `icons/` | Home Screen name and icon |
| `test/smoke.cjs` | End-to-end test: drives the page in headless Chromium and checks the files it makes with ffmpeg |

Run the test with `node test/smoke.cjs`. It needs Playwright with Chromium, and ffmpeg/ffprobe on the PATH.
