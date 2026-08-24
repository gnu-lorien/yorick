# jQuery Mobile 1.4.5 enhanced markup — measured, not remembered

The Vue client keeps jQuery Mobile's **stylesheet** and drops its **JavaScript**.
That works because the stylesheet is class-driven: `ui-btn`, `ui-listview`,
`ui-grid-c` and friends style whatever markup carries them. jQuery Mobile's
script existed to *generate* that markup by enhancing plainer HTML at runtime
(`$el.enhanceWithin()`, 110 calls across 42 view files); the components in this
directory emit the enhanced result directly.

So the components are only correct if they emit what jQuery Mobile actually
emitted. Everything below was read back out of the **running legacy app** — the
raw markup was injected into a live page, `enhanceWithin()` was called on it,
and the resulting DOM was serialised. It is not reconstructed from documentation
or from memory, both of which got several of these wrong on the first attempt.

To re-measure after changing anything, run the legacy client and evaluate the
probe in `scripts/jqm-probe.js` against it.

## Page

```html
<div data-role="page" id="login" class="ui-page ui-page-theme-a ui-page-active">
  <div role="main" class="ui-content">…</div>
</div>
```

`ui-page-active` and the page `id` are the E2E suite's "which screen am I on"
oracle (`activePageId`, `waitForActivePage`), and `div[role="main"]` must be
non-empty for a navigation to be considered settled. `JqmPage` guarantees all
three.

## Text input — jQuery Mobile WRAPS, it does not class

```html
<div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
  <input type="text" id="login-username" placeholder="Username">
</div>
```

The control itself carries **no classes**. Putting them on the input instead
renders at the wrong size, because `ui-input-text` sets border and padding on a
block container. This was the first fidelity bug the measurement caught.

## Button

```html
<a class="ui-btn ui-shadow ui-corner-all">plain</a>
<a class="ui-btn-left ui-link ui-btn ui-icon-arrow-l ui-btn-icon-left ui-shadow ui-corner-all">with icon</a>
```

A `<button>` inside a form is enhanced the same way and needs
`class="ui-btn ui-shadow ui-corner-all"` written out. An unclassed `<button>`
renders as a browser default button — the second bug the measurement caught.

## Listview

```html
<ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
  <li role="heading" class="ui-li-divider ui-bar-inherit ui-first-child">Divider</li>
  <li class="ui-li-has-thumb">
    <a href="#x" class="ui-btn ui-btn-icon-right ui-icon-carat-r"><img src="…"><h2>Name</h2><p>sub</p></a>
  </li>
  <li class="ui-li-static ui-body-inherit">plain static</li>
  <li class="ui-last-child"><a href="#y" class="ui-btn ui-btn-icon-right ui-icon-carat-r">linked</a></li>
</ul>
```

Note the split: a **linked** row leaves the `<li>` bare and puts the classes on
an inner `<a class="ui-btn">`; a **static** row carries `ui-li-static
ui-body-inherit` on the `<li>` itself.

`ui-first-child` / `ui-last-child` are handled by `styles/jqm-structural.css`
via `:first-child` / `:last-child`, so components never emit them and a
reactive list needs no `.listview("refresh")`.

## Collapsible

```html
<div class="ui-collapsible ui-collapsible-inset ui-corner-all ui-collapsible-themed-content ui-collapsible-collapsed">
  <h3 class="ui-collapsible-heading ui-collapsible-heading-collapsed">
    <a href="#" class="ui-collapsible-heading-toggle ui-btn ui-icon-plus ui-btn-icon-left ui-btn-inherit">Head
      <span class="ui-collapsible-heading-status"> click to expand contents</span>
    </a>
  </h3>
  <div class="ui-collapsible-content ui-body-inherit ui-collapsible-content-collapsed" aria-hidden="true">…</div>
</div>
```

Open swaps `ui-icon-plus` → `ui-icon-minus` and drops the three `*-collapsed`
classes. `ui-collapsible-themed-content` is load-bearing: the listview edge
rules key off it.

## Select

```html
<div class="ui-select">
  <div id="p-sel-button" class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
    <span>One</span>
    <select id="p-sel"><option value="1">One</option></select>
  </div>
</div>
```

The real `<select>` stays, keeps its id, and sits inside the styled button; the
`<span>` shows the selected option's text.

## Checkbox

```html
<div class="ui-checkbox">
  <label for="p-cb" class="ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left ui-checkbox-off">Check</label>
  <input type="checkbox" id="p-cb">
</div>
```

There is **no** `ui-icon-checkbox-off` class — `ui-checkbox-off` carries the
icon itself in 1.4.5. The label precedes the input.

## Slider

```html
<div class="ui-slider">
  <input type="number" data-type="range" id="p-rng" min="0" max="10" value="5"
         class="ui-shadow-inset ui-body-inherit ui-corner-all ui-slider-input">
  <div role="application" class="ui-slider-track ui-shadow-inset ui-bar-inherit ui-corner-all">
    <a href="#" class="ui-slider-handle ui-btn ui-shadow" role="slider"
       aria-valuemin="0" aria-valuemax="10" aria-valuenow="5" aria-valuetext="5" title="5"
       style="left: 50%;"></a>
  </div>
</div>
```

Three things a reconstruction gets wrong: the input is **not** `ui-input-text`,
the handle has **no** `ui-corner-all`, and there is **no** `.ui-slider-bg` fill
element unless the highlight option was used — none of this app's seven sliders
uses it.

The original `<input type="range">` is re-typed to `number` **in place**, so
`input[name=historyChangePicker]` and the ids the E2E suite addresses all
survive. That is what lets `setJqmSlider` keep working.

## Table (reflow)

```html
<table data-role="table" class="ui-table ui-table-reflow">
  <thead><tr><th data-colstart="1">A</th></tr></thead>
  <tbody><tr><td><b class="ui-table-cell-label">A</b>1</td></tr></tbody>
</table>
```

The `<b class="ui-table-cell-label">` in every cell is what labels the columns
once the table stacks on a narrow screen. `JqmTd` emits it from the table's
`columns` prop. Four E2E helpers strip it back out before reading a cell, so
dropping it would break the phone layout silently while the tests stayed green.

## Controlgroup

```html
<div data-role="controlgroup" class="ui-controlgroup ui-controlgroup-vertical ui-corner-all">
  <div class="ui-controlgroup-controls">
    <a href="#" class="ui-btn ui-first-child">a</a>
    <a href="#" class="ui-btn ui-last-child">b</a>
  </div>
</div>
```

## Header and footer

```html
<div data-role="header" data-position="fixed" role="banner" class="ui-header ui-bar-a ui-header-fixed slidedown">
  <a id="header-back-button" class="ui-btn-left ui-link ui-btn ui-icon-arrow-l ui-btn-icon-left ui-shadow ui-corner-all">Back</a>
  <a id="header-logout-button" class="ui-btn-right ui-link ui-btn ui-icon-minus ui-btn-icon-right ui-shadow ui-corner-all">Log Out</a>
  <h1 class="ui-title" role="heading" aria-level="1">Default Title</h1>
</div>

<div data-role="footer" data-position="fixed" role="contentinfo" class="ui-footer ui-bar-a ui-footer-fixed slideup">
  <div data-role="navbar" class="ui-navbar" role="navigation">
    <ul class="ui-grid-b">
      <li class="ui-block-a"><a href="#" class="ui-btn">Top</a></li>
      …
    </ul>
  </div>
</div>
```

The grid class follows the cell count: `ui-grid-solo` (1), `ui-grid-a` (2),
`ui-grid-b` (3), `ui-grid-c` (4), `ui-grid-d` (5). The footer's three role
variants — player, storyteller, administrator — differ only in that count.

## Search filter

`data-filter="true"` on a listview made jQuery Mobile inject a search box and
hide non-matching rows. There are **twelve** of them across the app and they
have no application code behind them at all, which is why they are easy to lose
in a migration and why only one of the twelve is covered by a test.
`JqmListview`'s `filter` prop reproduces it; every list that had the attribute
must set it.
