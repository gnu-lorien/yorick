'use strict';

/**
 * Render a run into a single self-contained HTML page.
 *
 * The images stay as files next to it rather than being inlined - a fifty-step
 * run at three targets is well over a hundred PNGs, and base64 would make the
 * report slower to open than the screenshots are to look at.
 */

const fs = require('fs');
const path = require('path');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(ratio) {
  if (typeof ratio !== 'number') return 'n/a';
  if (ratio === 0) return '0%';
  if (ratio < 0.0001) return '<0.01%';
  return `${(ratio * 100).toFixed(2)}%`;
}

function renderStep(step, names) {
  const cells = step.shots.map((shot) => `
        <figure>
          <figcaption>${escapeHtml(shot.name)}${shot.name === names[0] ? ' <span class="ref">reference</span>' : ''}</figcaption>
          ${shot.file
            ? `<a href="${step.dir}/${shot.file}" target="_blank"><img src="${step.dir}/${shot.file}" alt="${escapeHtml(shot.name)}"></a>`
            : `<div class="missing">${escapeHtml(shot.error || 'no screenshot')}</div>`}
        </figure>`).join('');

  const diffCells = step.diffs.map((diff) => `
        <figure class="${diff.ratio > 0 || diff.error ? 'hot' : ''}">
          <figcaption>${escapeHtml(diff.name)} vs ${escapeHtml(diff.refName)} &mdash; <b>${pct(diff.ratio)}</b>${diff.sizeMismatch ? ' <span class="ref">size differs</span>' : ''}</figcaption>
          ${diff.file
            ? `<a href="${step.dir}/${diff.file}" target="_blank"><img src="${step.dir}/${diff.file}" alt="diff"></a>`
            : `<div class="missing">${escapeHtml(diff.error || 'no diff')}</div>`}
        </figure>`).join('');

  return `
    <section class="step ${step.diverged ? 'diverged' : 'same'}" data-diverged="${step.diverged}">
      <h2><span class="num">${String(step.index).padStart(3, '0')}</span> <code>${escapeHtml(step.label)}</code>
        <span class="badge ${step.diverged ? 'bad' : 'good'}">${step.diverged ? `diverged ${pct(step.maxRatio)}` : 'match'}</span>
      </h2>
      ${step.failure ? `<p class="failure">${escapeHtml(step.failure)}</p>` : ''}
      <div class="grid">${cells}</div>
      <div class="grid diffs">${diffCells}</div>
    </section>`;
}

function renderReport(run) {
  const { targets, steps, recording, startedAt, finishedAt, tolerance, threshold, error } = run;
  const names = targets.map((t) => t.name);
  const divergent = steps.filter((s) => s.diverged);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mirror run - ${escapeHtml(path.basename(recording))}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#16181d; --muted:#6b7280; --line:#e3e6ea; --card:#f7f8fa; --bad:#c0392b; --good:#1e7a46; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14161a; --fg:#e8eaed; --muted:#9aa2ad; --line:#2a2e35; --card:#1c1f25; --bad:#ff7a6b; --good:#5fd693; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { border-bottom:1px solid var(--line); padding-bottom:16px; margin-bottom:24px; }
  h1 { font-size:20px; margin:0 0 8px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; margin:0; color:var(--muted); }
  dt { font-weight:600; }
  dd { margin:0; }
  .summary { margin-top:12px; font-size:15px; }
  .step { border:1px solid var(--line); border-radius:8px; margin-bottom:20px; padding:16px; background:var(--card); }
  .step.diverged { border-color:var(--bad); }
  h2 { font-size:14px; margin:0 0 12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .num { color:var(--muted); font-variant-numeric:tabular-nums; }
  code { font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; word-break:break-all; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; font-weight:600; }
  .badge.bad { background:var(--bad); color:#fff; }
  .badge.good { background:var(--good); color:#fff; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
  .grid.diffs { margin-top:12px; }
  figure { margin:0; }
  figcaption { font-size:12px; color:var(--muted); margin-bottom:4px; }
  .ref { font-size:10px; text-transform:uppercase; letter-spacing:.04em; opacity:.7; }
  /* Screenshots are a full window tall; showing them at that height makes a
     fifty-step report unscrollable. Crop to the top and let a click open
     the real file. */
  img { width:100%; max-height:340px; object-fit:cover; object-position:top; border:1px solid var(--line); border-radius:4px; display:block; background:#fff; }
  figure.hot img { border-color:var(--bad); }
  .missing { padding:20px; border:1px dashed var(--line); border-radius:4px; color:var(--muted); font-size:12px; }
  .failure { color:var(--bad); font-size:13px; margin:0 0 12px; white-space:pre-wrap; }
  .controls { margin-bottom:16px; }
  button { font:inherit; padding:6px 12px; border-radius:6px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; }
  body.only-diverged .step.same { display:none; }
</style>
</head>
<body>
<header>
  <h1>Mirror run &mdash; <code>${escapeHtml(path.basename(recording))}</code></h1>
  <dl>
    <dt>Targets</dt><dd>${targets.map((t) => `${escapeHtml(t.name)} &rarr; ${escapeHtml(t.url)}`).join(' &middot; ')}</dd>
    <dt>Started</dt><dd>${escapeHtml(startedAt)}</dd>
    <dt>Finished</dt><dd>${escapeHtml(finishedAt || 'aborted')}</dd>
    <dt>Tolerance</dt><dd>${pct(tolerance)} of pixels &middot; per-pixel threshold ${threshold}</dd>
  </dl>
  <p class="summary">
    <b>${steps.length}</b> step${steps.length === 1 ? '' : 's'},
    <b class="${divergent.length ? 'bad' : 'good'}" style="color:${divergent.length ? 'var(--bad)' : 'var(--good)'}">${divergent.length}</b> diverged.
  </p>
  ${error ? `<p class="failure">${escapeHtml(error)}</p>` : ''}
</header>
<div class="controls">
  <button id="toggle">Show only divergent steps</button>
</div>
${steps.map((s) => renderStep(s, names)).join('\n')}
<script>
  const btn = document.getElementById('toggle');
  btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('only-diverged');
    btn.textContent = on ? 'Show all steps' : 'Show only divergent steps';
  });
</script>
</body>
</html>`;
}

function writeReport(run, outDir) {
  const html = renderReport(run);
  const file = path.join(outDir, 'report.html');
  fs.writeFileSync(file, html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
  return file;
}

module.exports = { writeReport, renderReport };
