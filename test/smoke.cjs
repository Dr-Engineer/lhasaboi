// End-to-end smoke test for index.html.
// Drives the page in headless Chromium with a synthetic song, downloads the
// ringtones it makes, and checks them with ffprobe/ffmpeg.
//
//   node test/smoke.cjs
//
// Needs Playwright (with its Chromium) and ffmpeg/ffprobe on PATH.
// Set SCREENSHOT_DIR=/some/dir to also save screenshots.
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ringtone-test-'));
const SHOTS = process.env.SCREENSHOT_DIR;

let failures = 0;
function check(cond, msg) {
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failures++;
}

// 90 s stereo WAV: quiet 0–40 s, loud "chorus" 40–70 s, quiet 70–90 s.
function writeTestSong(file) {
  const sr = 44100, n = sr * 90, nc = 2, dataLen = n * nc * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * nc * 2, 28); b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const a = t >= 40 && t < 70 ? 0.6 : 0.05;
    const base = 0.6 * Math.sin(2 * Math.PI * 220 * t);
    const l = a * (base + 0.4 * Math.sin(2 * Math.PI * 277.2 * t));
    const r = a * (base + 0.4 * Math.sin(2 * Math.PI * 329.6 * t));
    b.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, b);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const f = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_name,sample_rate,channels,duration_ts', '-of', 'json', file]);
  const j = JSON.parse(r.stdout.toString());
  return { ...j.streams[0], duration: parseFloat(j.format.duration) };
}
function decodeErrors(file) {
  return spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']).stderr.toString().trim();
}
// max/mean volume in dB, optionally of a slice (seek seconds, length seconds)
function volume(file, ss, t) {
  const args = ['-hide_banner', '-nostats'];
  if (ss != null) args.push('-ss', String(ss));
  if (t != null) args.push('-t', String(t));
  args.push('-i', file, '-af', 'volumedetect', '-f', 'null', '-');
  const err = spawnSync('ffmpeg', args).stderr.toString();
  const num = (k) => { const m = err.match(new RegExp(k + ':\\s*(-?[\\d.]+|-inf) dB')); return m ? (m[1] === '-inf' ? -Infinity : parseFloat(m[1])) : NaN; };
  return { max: num('max_volume'), mean: num('mean_volume') };
}
const parseT = (s) => { const [m, sec] = s.split(':'); return +m * 60 + +sec; };

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    await page.goto(base);
    check(await page.isHidden('#step2'), 'editor is hidden before a song is chosen');

    const song = path.join(TMP, 'Test_Song (demo).wav');
    writeTestSong(song);
    await page.setInputFiles('#file', song);
    await page.waitForSelector('#step2:not([hidden])', { timeout: 30000 });
    // the page redraws on the next animation frame, so wait for it before reading
    const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const startVal = async () => { await settle(); return parseT(await page.inputValue('#start')); };
    const lenText = async () => { await settle(); return page.textContent('#lenOut'); };

    // defaults
    const auto = await startVal();
    check(auto >= 39.8 && auto <= 40.6, `auto-picks the loudest part (start ${auto}s, chorus is at 40s)`);
    check((await page.inputValue('#name')) === 'Test Song (demo)', 'name defaults to the file name');
    check((await page.textContent('#lenOut')) === '29.5 s', 'length defaults to 29.5 s');
    check((await page.textContent('#songDur')) === '1:30 long', 'shows the song length');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mobile-light.png'), fullPage: true });

    // nudges and typed times
    await page.click('[data-nudge="1"]');
    check(Math.abs((await startVal()) - (auto + 1)) < 0.01, '+1s moves the start by a second');
    await page.click('[data-nudge="-0.1"]');
    check(Math.abs((await startVal()) - (auto + 0.9)) < 0.01, '−0.1 moves the start back a tenth');
    await page.fill('#start', '1:00');
    await page.press('#start', 'Enter');
    check((await page.inputValue('#start')) === '1:00.0', 'typing 1:00 sets the start');
    await settle();
    check((await page.textContent('#rangeText')).startsWith('1:00.0 – 1:29.5'), 'range text follows the start');
    await page.fill('#start', '5:00');
    await page.press('#start', 'Enter');
    check((await page.inputValue('#start')) === '1:00.5', 'a start past the end is clamped so the clip fits');

    // waveform: drag and tap
    const box = await page.locator('#wave').boundingBox();
    const y = box.y + box.height / 2;
    const s0 = await startVal();
    const cx = box.x + ((s0 + 29.5 / 2) / 90) * box.width;
    await page.mouse.move(cx, y);
    await page.mouse.down();
    await page.mouse.move(cx - 100, y, { steps: 5 });
    await page.mouse.up();
    const expected = s0 - (100 / box.width) * 90;
    const s1 = await startVal();
    check(Math.abs(s1 - expected) < 0.6, `dragging moves the selection (${s0} → ${s1}, expected ≈${expected.toFixed(1)})`);
    await page.mouse.click(box.x + (5 / 90) * box.width, y);
    check((await startVal()) === 0, 'tapping near the start jumps the selection there');
    await page.click('#loud');
    check(Math.abs((await startVal()) - auto) < 0.01, '"Jump to loudest part" returns to the chorus');

    // length controls
    await page.click('#lenMinus');
    check((await lenText()) === '29.0 s', '− shortens by half a second');
    await page.click('#lenPlus');
    await page.click('#lenPlus');
    check((await lenText()) === '29.5 s', '+ never goes past 29.5 s');

    // preview
    await page.click('#play');
    check((await page.textContent('#play')).includes('Stop'), 'Play starts the preview');
    await page.waitForTimeout(300);
    await page.click('#play');
    check((await page.textContent('#play')).includes('Play'), 'Stop ends the preview');

    // make MP3
    await page.click('#make');
    await page.waitForSelector('#result:not([hidden])', { timeout: 60000 });
    const meta = await page.textContent('#resultMeta');
    check(/^29\.5 s · \d+ KB$/.test(meta), `result shows length and size (${meta})`);
    check(await page.isHidden('#stale'), 'fresh result is not marked as outdated');
    check(await page.isVisible('#stepsComputer'), 'computer users get the send-to-phone steps');
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
    check(dl.suggestedFilename() === 'Test Song (demo).mp3', `MP3 download name (${dl.suggestedFilename()})`);
    const mp3 = path.join(TMP, 'out.mp3');
    await dl.saveAs(mp3);
    const pm = probe(mp3);
    check(pm.codec_name === 'mp3' && pm.sample_rate === '44100' && pm.channels === 2, `MP3 is 44.1 kHz stereo (${pm.codec_name}, ${pm.sample_rate}, ${pm.channels}ch)`);
    check(pm.duration > 29.4 && pm.duration < 30, `MP3 is under 30 s (${pm.duration}s)`);
    check(decodeErrors(mp3) === '', 'MP3 decodes cleanly in ffmpeg');
    const vm = volume(mp3);
    check(vm.max <= -0.3 && vm.max >= -2.5, `MP3 is normalized to about −1 dB peak (${vm.max} dB)`);
    check(vm.mean > -15, `MP3 contains the loud chorus (mean ${vm.mean} dB)`);
    check(volume(mp3, 0, 0.03).max < -30, 'MP3 fades in');
    check(volume(mp3, pm.duration - 0.03).max < -30, 'MP3 fades out');

    // changing something marks the result as outdated
    await page.click('[data-nudge="0.1"]');
    await settle();
    check(await page.isVisible('#stale'), 'editing after making shows the "make it again" note');
    await page.click('[data-nudge="-0.1"]');

    // make WAV
    await page.click('.seg input[value=wav]');
    await page.click('#make');
    await page.waitForFunction(() => document.querySelector('#resultName').textContent.endsWith('.wav'), null, { timeout: 30000 });
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBtn')]);
    const wav = path.join(TMP, 'out.wav');
    await dl.saveAs(wav);
    const pw = probe(wav);
    check(pw.codec_name === 'pcm_s16le' && pw.sample_rate === '44100' && pw.channels === 2, `WAV is 16-bit 44.1 kHz stereo (${pw.codec_name})`);
    check(Math.abs(pw.duration - 29.5) < 0.001, `WAV is exactly 29.5 s (${pw.duration}s)`);
    check(decodeErrors(wav) === '', 'WAV decodes cleanly in ffmpeg');

    // round trip: the MP3 we made is itself a valid input
    await page.setInputFiles('#file', mp3);
    await page.waitForFunction(() => document.querySelector('#songName').textContent === 'out.mp3', null, { timeout: 30000 });
    check((await page.textContent('#songDur')) === '0:29 long', 'an MP3 input loads (round trip)');
    check(await page.isHidden('#result'), 'loading a new song clears the old result');

    // dark mode and desktop screenshots
    if (SHOTS) {
      await page.setInputFiles('#file', song);
      await page.waitForFunction(() => document.querySelector('#songName').textContent.endsWith('.wav'));
      await page.click('#make');
      await page.waitForSelector('#result:not([hidden])');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS, 'mobile-dark.png'), fullPage: true });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    }

    check(errors.length === 0, 'no errors in the browser console' + (errors.length ? ': ' + errors.join(' | ') : ''));

    // a file that isn't audio shows a friendly error
    const bad = path.join(TMP, 'notes.mp3');
    fs.writeFileSync(bad, 'this is not audio');
    await page.setInputFiles('#file', bad);
    await page.waitForSelector('#loadStatus.error', { timeout: 30000 });
    check((await page.textContent('#loadStatus')).includes('copy-protected'), 'a non-audio file explains what went wrong');
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
