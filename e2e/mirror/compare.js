'use strict';

/**
 * Screenshot every target at the same moment and diff them against the first.
 *
 * Target 0 is the reference by convention - it is the build you trust, so put
 * legacy first. Everything else is compared to it pairwise; comparing the
 * others to each other as well would triple the images for no extra signal,
 * because "React and Vue agree with each other but not with legacy" already
 * shows up as two diffs.
 */

const fs = require('fs');
const path = require('path');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

/** Pixels outside a smaller screenshot, so a size difference reads as a diff. */
const PAD_RGBA = [255, 0, 255, 255];

function padTo(png, width, height) {
  if (png.width === width && png.height === height) return png;

  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const to = (width * y + x) << 2;
      if (x < png.width && y < png.height) {
        const from = (png.width * y + x) << 2;
        out.data[to] = png.data[from];
        out.data[to + 1] = png.data[from + 1];
        out.data[to + 2] = png.data[from + 2];
        out.data[to + 3] = png.data[from + 3];
      } else {
        out.data[to] = PAD_RGBA[0];
        out.data[to + 1] = PAD_RGBA[1];
        out.data[to + 2] = PAD_RGBA[2];
        out.data[to + 3] = PAD_RGBA[3];
      }
    }
  }
  return out;
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'step';
}

/**
 * @param {object}   args
 * @param {object[]} args.pages     real Playwright pages, aligned with names
 * @param {string[]} args.names
 * @param {string}   args.label     human label for this step
 * @param {number}   args.index     1-based step number
 * @param {string}   args.outDir    run directory
 * @param {number}   args.settleMs  pause before shooting, for animations
 * @param {number}   args.threshold pixelmatch per-pixel sensitivity, 0..1
 * @param {number}   args.tolerance ratio of differing pixels treated as "same"
 * @param {boolean}  args.fullPage
 */
async function captureStep(args) {
  const { pages, names, label, index, outDir, settleMs, threshold, tolerance, fullPage } = args;

  const dirName = `step-${String(index).padStart(3, '0')}-${slug(label)}`;
  const stepDir = path.join(outDir, dirName);
  fs.mkdirSync(stepDir, { recursive: true });

  // jQuery Mobile page transitions and Marionette re-renders both land a beat
  // after the action resolves; shooting immediately catches them mid-animation
  // and every target diffs against every other for no real reason.
  if (settleMs > 0) {
    await Promise.all(pages.map((p) => p.waitForTimeout(settleMs).catch(() => {})));
  }

  const shots = await Promise.all(pages.map(async (page, i) => {
    const file = `${i}-${slug(names[i])}.png`;
    let buffer;
    try {
      buffer = await page.screenshot({ fullPage });
    } catch (err) {
      return { name: names[i], file: null, error: String(err && err.message || err) };
    }
    fs.writeFileSync(path.join(stepDir, file), buffer);
    const png = PNG.sync.read(buffer);
    return { name: names[i], file, width: png.width, height: png.height, png };
  }));

  const reference = shots[0];
  const diffs = [];

  for (let i = 1; i < shots.length; i++) {
    const shot = shots[i];
    if (!reference.png || !shot.png) {
      diffs.push({
        name: shot.name, refName: reference.name, file: null,
        mismatch: null, ratio: null, sizeMismatch: false,
        error: shot.error || reference.error
      });
      continue;
    }

    const width = Math.max(reference.width, shot.width);
    const height = Math.max(reference.height, shot.height);
    const sizeMismatch = reference.width !== shot.width || reference.height !== shot.height;

    const a = padTo(reference.png, width, height);
    const b = padTo(shot.png, width, height);
    const out = new PNG({ width, height });

    const mismatch = pixelmatch(a.data, b.data, out.data, width, height, {
      threshold,
      includeAA: false
    });

    const file = `diff-${slug(shot.name)}-vs-${slug(reference.name)}.png`;
    fs.writeFileSync(path.join(stepDir, file), PNG.sync.write(out));

    diffs.push({
      name: shot.name,
      refName: reference.name,
      file,
      mismatch,
      ratio: mismatch / (width * height),
      sizeMismatch
    });
  }

  const ratios = diffs.map((d) => d.ratio).filter((r) => typeof r === 'number');
  const maxRatio = ratios.length ? Math.max(...ratios) : 0;

  return {
    index,
    label,
    dir: dirName,
    urls: pages.map((p) => { try { return p.url(); } catch (err) { return null; } }),
    shots: shots.map(({ png, ...rest }) => rest),
    diffs,
    maxRatio,
    diverged: maxRatio > tolerance || diffs.some((d) => d.error || d.sizeMismatch)
  };
}

module.exports = { captureStep, slug };
