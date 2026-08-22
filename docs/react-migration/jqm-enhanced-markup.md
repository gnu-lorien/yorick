# jQuery Mobile enhanced markup reference

The React front end keeps `jquery.mobile-1.4.5.min.css` and reproduces the DOM
that jQuery Mobile's JavaScript *would have produced*, so the stylesheet styles
it unchanged and the app looks identical. Nothing here was guessed: every
sample below was harvested from the running legacy app by handing jQuery Mobile
1.4.5 the source markup and calling `.enhanceWithin()` on it.

Regenerate with `docs/react-migration/harvest-jqm-markup.js` (paste into the
legacy app's console).

## The rule

Enhancement is a pure function of the source markup: jQM adds classes, and for
a few widgets adds a wrapper element. It never changes the semantic element or
reorders content. So a React component that emits the "after" markup directly
is indistinguishable to the stylesheet.

## Page shell

Source `<div data-role="page">` becomes:

```html
<div id="characters-all" data-role="page" data-title="Characters"
     data-url="characters-all" tabindex="0"
     class="ui-page ui-page-theme-a ui-page-active"
     style="position: relative; padding-top: 45px; padding-bottom: 36px; min-height: 639px;">
  <div role="main" class="ui-content"> ... </div>
</div>
```

`padding-top`/`padding-bottom` are the fixed header/footer heights, and
`min-height` is the viewport height; jQM recomputes them on resize. `ui-page-active`
marks the visible page -- exactly one page carries it.

## Header, footer, navbar

```html
<div data-role="header" data-position="fixed" data-theme="a" role="banner"
     class="ui-header ui-bar-a ui-header-fixed slidedown">
  <a href="#" id="header-back-button" data-rel="back" role="button"
     class="ui-btn-left ui-link ui-btn ui-icon-arrow-l ui-btn-icon-left ui-shadow ui-corner-all">Back</a>
  <a href="#logout" id="header-logout-button" role="button"
     class="ui-btn-right ui-link ui-btn ui-icon-minus ui-btn-icon-right ui-shadow ui-corner-all">Log Out devuser</a>
  <h1 class="ui-title" role="heading" aria-level="1">Administration</h1>
</div>

<div data-role="footer" data-position="fixed" data-theme="a" role="contentinfo"
     class="ui-footer ui-bar-a ui-footer-fixed slideup">
  <div data-role="navbar" class="ui-navbar" role="navigation">
    <ul class="ui-grid-c">
      <li class="ui-block-a"><a class="ui-btn" href="#characters?all">Characters</a></li>
      <li class="ui-block-b"><a class="ui-btn" href="#profile">Profile</a></li>
      <li class="ui-block-c"><a class="ui-btn ui-btn-active" href="#administration">Administration</a></li>
      <li class="ui-block-d"><a class="ui-btn" href="#troupes">Troupes</a></li>
    </ul>
  </div>
</div>
```

The navbar grid class is `ui-grid-{a,b,c,d,e}` for 2..5 columns and each `li`
gets `ui-block-{a,b,c,...}` by index. The active tab's anchor gets `ui-btn-active`.

## Listview

```html
<ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
  <li data-role="list-divider" role="heading" class="ui-li-divider ui-bar-inherit ui-first-child">Divider Text</li>
  <li><a href="#x" class="ui-btn ui-btn-icon-right ui-icon-carat-r">Linked item</a></li>
  <li class="ui-li-static ui-body-inherit">Static item</li>
  <li class="ui-li-has-alt">
    <a href="#x" class="ui-btn">Split main</a>
    <a href="#y" class="ui-btn ui-btn-icon-notext ui-icon-gear" title="Split action"></a>
  </li>
  <li data-icon="delete" class="ui-last-child"><a href="#z" class="ui-btn ui-btn-icon-right ui-icon-delete">Icon item</a></li>
</ul>
```

Rules, in the order jQM applies them:

- `ui-listview` always; `ui-listview-inset ui-corner-all ui-shadow` when `data-inset="true"`.
- An `li` whose only child is one anchor: the anchor gets
  `ui-btn ui-btn-icon-right ui-icon-carat-r`. `data-icon` on the `li` replaces
  `carat-r`; `data-icon="false"` drops the icon classes entirely.
- An `li` with two anchors is a split button: `li.ui-li-has-alt`, first anchor
  `ui-btn`, second `ui-btn ui-btn-icon-notext ui-icon-<data-icon default gear>`
  with its text moved to `title`.
- An `li` with no anchor: `ui-li-static ui-body-inherit`.
- A divider: `ui-li-divider ui-bar-inherit` and `role="heading"`.
- First and last `li` get `ui-first-child` / `ui-last-child`. These drive the
  inset corner rounding, so they must be recomputed when the list is filtered.

## Form controls

```html
<!-- text, number, file: wrapper added around the input -->
<div class="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
  <input type="text" id="login-username" placeholder="Username">
</div>

<!-- search: wrapper plus a clear button -->
<div class="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
  <input id="characters-filter" data-type="search">
  <a href="#" tabindex="-1" aria-hidden="true" title="Clear text"
     class="ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all ui-input-clear-hidden">Clear text</a>
</div>

<!-- textarea: classes go on the element itself, no wrapper -->
<textarea class="ui-input-text ui-shadow-inset ui-body-inherit ui-corner-all ui-textinput-autogrow"></textarea>

<!-- select: two wrappers, and a span mirroring the selected option's label -->
<div class="ui-select">
  <div id="hv-sel-button" class="ui-btn ui-icon-carat-d ui-btn-icon-right ui-corner-all ui-shadow">
    <span>One</span>
    <select id="hv-sel"><option value="1">One</option><option value="2">Two</option></select>
  </div>
</div>

<!-- checkbox / radio: label becomes the visible control, input stays for state -->
<div class="ui-checkbox">
  <label for="hv-cb" class="ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left ui-checkbox-off">Check me</label>
  <input type="checkbox" id="hv-cb">
</div>
<div class="ui-radio">
  <label for="hv-radio" class="ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left ui-radio-off">Radio</label>
  <input type="radio" name="r" id="hv-radio">
</div>
```

`ui-checkbox-off` / `ui-checkbox-on` (and the radio pair) track checked state --
that is the whole of the widget's behaviour, and the `span` in a select mirrors
the selected option's text.

## Buttons

```html
<button class="ui-btn ui-shadow ui-corner-all">Real Button</button>
<a href="#b" role="button" class="ui-link ui-btn ui-icon-plus ui-btn-icon-left ui-shadow ui-corner-all">Link Button</a>
```

A plain anchor that is not a button still gets `ui-link`. Icon classes are
`ui-icon-<name>` paired with `ui-btn-icon-{left,right,top,bottom,notext}`.

## Controlgroup

```html
<div class="ui-controlgroup ui-controlgroup-horizontal ui-corner-all">
  <div class="ui-controlgroup-controls">
    <a class="ui-link ui-btn ui-shadow ui-corner-all ui-first-child" role="button">A</a>
    <a class="ui-link ui-btn ui-shadow ui-corner-all ui-last-child" role="button">B</a>
  </div>
</div>
```

## Loader

`$.mobile.loading("show"|"hide")` toggles a single document-level element:

```html
<div class="ui-loader ui-corner-all ui-body-a ui-loader-default" style="top: 1px;">
  <span class="ui-icon-loading"></span><h1>loading</h1>
</div>
```

The legacy app calls it 178 times. In React it is one global spinner driven by
a request counter.
