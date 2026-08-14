/**
 * Image fixture generation and verification.
 *
 * Portrait verification has to survive what the server actually does to an
 * upload. `cloud/main.js` center-crops every portrait to a square and re-encodes
 * the 32/64/128/256 thumbnails as *lossy JPEG*, so a byte-for-byte comparison
 * against the uploaded PNG would always fail. Instead the fixtures are solid
 * colours far apart in RGB space, and verification compares the decoded dominant
 * colour within a tolerance. That still proves the bytes on screen came from the
 * file we uploaded — swapping red for blue fails loudly — while tolerating the
 * crop and the JPEG round trip.
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

/**
 * Fixture colours. Chosen to be unambiguous after JPEG compression and far
 * enough apart that no two can be confused by the tolerance below.
 */
const COLORS = {
  red:   { r: 220, g: 40,  b: 40 },
  blue:  { r: 40,  g: 80,  b: 220 },
  green: { r: 40,  g: 180, b: 90 }
};

/** Default per-channel tolerance, sized for JPEG artefacts on a flat colour. */
const DEFAULT_TOLERANCE = 28;

function toInt(color) {
  return Jimp.rgbaToInt(color.r, color.g, color.b, 255);
}

function ensureFixtureDir() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  }
}

/**
 * Write a solid-colour PNG fixture and return its absolute path.
 * Existing files are reused so repeated runs don't rewrite identical bytes.
 */
async function makeFixturePng(fileName, color, width, height) {
  ensureFixtureDir();
  const target = path.join(FIXTURE_DIR, fileName);
  if (fs.existsSync(target)) {
    return target;
  }
  const image = await new Promise((resolve, reject) => {
    new Jimp(width, height, toInt(color), (err, img) => (err ? reject(err) : resolve(img)));
  });
  await new Promise((resolve, reject) => {
    image.write(target, (err) => (err ? reject(err) : resolve()));
  });
  return target;
}

/** The standard fixture set the portrait tests use. */
const FIXTURES = {
  characterRed:   { file: 'portrait-red-200x200.png',   color: COLORS.red,   width: 200, height: 200 },
  characterBlue:  { file: 'portrait-blue-320x240.png',  color: COLORS.blue,  width: 320, height: 240 },
  troupeGreen:    { file: 'troupe-green-400x300.png',   color: COLORS.green, width: 400, height: 300 }
};

/** Create every standard fixture plus the non-image file used for negative tests. */
async function ensureFixtures() {
  const made = {};
  for (const key of Object.keys(FIXTURES)) {
    const f = FIXTURES[key];
    made[key] = {
      path: await makeFixturePng(f.file, f.color, f.width, f.height),
      color: f.color,
      width: f.width,
      height: f.height
    };
  }

  ensureFixtureDir();
  const notAnImage = path.join(FIXTURE_DIR, 'not-an-image.txt');
  if (!fs.existsSync(notAnImage)) {
    fs.writeFileSync(notAnImage, 'This is deliberately not an image.\n', 'utf8');
  }
  made.notAnImage = { path: notAnImage };

  return made;
}

/**
 * Average colour of an image buffer, ignoring fully transparent pixels.
 * A flat fixture makes the mean the dominant colour by construction, and the
 * mean is far more robust to JPEG ringing than sampling a single pixel.
 */
async function decodeImageBuffer(buffer) {
  const image = await Jimp.read(buffer);
  const { width, height, data } = image.bitmap;

  let r = 0, g = 0, b = 0, counted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    counted++;
  }

  if (counted === 0) {
    return { width, height, dominantColor: null, opaquePixels: 0 };
  }

  return {
    width,
    height,
    opaquePixels: counted,
    dominantColor: {
      r: Math.round(r / counted),
      g: Math.round(g / counted),
      b: Math.round(b / counted)
    }
  };
}

/** Read a fixture file off disk and decode it, for before/after comparisons. */
async function decodeFixture(fixturePath) {
  return decodeImageBuffer(fs.readFileSync(fixturePath));
}

/**
 * Resolve the `src` of the first element matching `selector`, fetch it through
 * the page's own session, and decode the result.
 *
 * Fetching in-page matters: portrait files are served by Parse and may depend on
 * the session, and it keeps the request on the same origin the app uses.
 */
async function fetchRenderedImage(page, selector, { timeout = 15000 } = {}) {
  await page.waitForSelector(selector, { state: 'attached', timeout });

  const src = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const raw = el.getAttribute('src') || el.getAttribute('data-src');
    if (!raw) return null;
    return new URL(raw, window.location.href).href;
  }, selector);

  if (!src) {
    return { ok: false, reason: 'no-src', selector, src: null };
  }
  if (/^data:/.test(src)) {
    const base64 = src.slice(src.indexOf(',') + 1);
    const decoded = await decodeImageBuffer(Buffer.from(base64, 'base64'));
    return Object.assign({ ok: true, status: 200, contentType: 'data-uri', src }, decoded);
  }

  const fetched = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    const buf = await res.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      base64: window.btoa(binary)
    };
  }, src);

  if (fetched.status !== 200) {
    return { ok: false, reason: 'http-' + fetched.status, status: fetched.status, src, contentType: fetched.contentType };
  }

  const decoded = await decodeImageBuffer(Buffer.from(fetched.base64, 'base64'));
  return Object.assign({
    ok: true,
    status: fetched.status,
    contentType: fetched.contentType,
    src
  }, decoded);
}

/** Per-channel distance between two colours. */
function colorDistance(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function formatColor(c) {
  return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : 'none';
}

/**
 * Assert a fetched image carries the expected fixture colour.
 * Throws with a readable diff rather than returning a boolean, so a failure
 * inside a test reads as an assertion failure.
 */
function assertImageColor(actual, expectedColor, { tolerance = DEFAULT_TOLERANCE, label = 'image' } = {}) {
  if (!actual || !actual.ok) {
    throw new Error(`${label}: image was not retrievable (${actual ? actual.reason : 'no result'}${actual && actual.src ? ' from ' + actual.src : ''})`);
  }
  if (!/^image\//.test(actual.contentType || '') && actual.contentType !== 'data-uri') {
    throw new Error(`${label}: expected an image content-type, got "${actual.contentType}" from ${actual.src}`);
  }
  if (!actual.dominantColor) {
    throw new Error(`${label}: image decoded to zero opaque pixels (${actual.src})`);
  }
  const distance = colorDistance(actual.dominantColor, expectedColor);
  if (distance > tolerance) {
    throw new Error(
      `${label}: dominant colour ${formatColor(actual.dominantColor)} does not match expected ` +
      `${formatColor(expectedColor)} (channel distance ${distance} > tolerance ${tolerance}); src=${actual.src}`
    );
  }
  return true;
}

module.exports = {
  FIXTURE_DIR,
  COLORS,
  FIXTURES,
  DEFAULT_TOLERANCE,
  makeFixturePng,
  ensureFixtures,
  decodeImageBuffer,
  decodeFixture,
  fetchRenderedImage,
  colorDistance,
  assertImageColor
};
