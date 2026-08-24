/**
 * Harvest jQuery Mobile 1.4.5's enhanced markup from the legacy app.
 *
 * Paste into the console of the running legacy app (any page, logged in or
 * not) and copy the result into jqm-enhanced-markup.md. It builds one of every
 * widget the app uses, hands it to jQM's own enhancer off-screen, and reports
 * what came back -- so the reference is measured from the library rather than
 * transcribed from its documentation.
 */
(() => {
  const $ = window.jQuery;
  const src = `
  <div id="harvest-root">
    <ul data-role="listview" data-inset="true" id="hv-lv">
      <li data-role="list-divider">Divider Text</li>
      <li><a href="#x">Linked item</a></li>
      <li>Static item</li>
      <li><a href="#x">Split main</a><a href="#y" data-icon="gear">Split action</a></li>
      <li data-icon="delete"><a href="#z">Icon item</a></li>
    </ul>
    <a href="#b" data-role="button" data-icon="plus" data-iconpos="left" id="hv-linkbtn">Link Button</a>
    <button id="hv-btn">Real Button</button>
    <input type="text" id="hv-text" placeholder="ph">
    <textarea id="hv-ta"></textarea>
    <select id="hv-sel"><option value="1">One</option><option value="2">Two</option></select>
    <label for="hv-cb">Check me</label><input type="checkbox" id="hv-cb">
    <label for="hv-radio">Radio</label><input type="radio" name="r" id="hv-radio">
    <div data-role="controlgroup" data-type="horizontal" id="hv-cg"><a href="#" data-role="button">A</a><a href="#" data-role="button">B</a></div>
    <input type="number" id="hv-num">
    <input type="file" id="hv-file">
  </div>`;
  const $root = $(src).css({ position: 'absolute', left: '-9999px' }).appendTo(document.body);
  $root.enhanceWithin();
  const up = (sel, cls) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    return (cls ? e.closest(cls) : null) ? e.closest(cls).outerHTML : e.outerHTML;
  };
  const out = {
    listview: up('#hv-lv'),
    linkButton: up('#hv-linkbtn'),
    button: up('#hv-btn', '.ui-btn'),
    text: up('#hv-text', '.ui-input-text'),
    textarea: up('#hv-ta'),
    select: up('#hv-sel', '.ui-select'),
    checkbox: up('#hv-cb', '.ui-checkbox'),
    radio: up('#hv-radio', '.ui-radio'),
    controlgroup: up('#hv-cg'),
    number: up('#hv-num', '.ui-input-text'),
    file: up('#hv-file', '.ui-input-text'),
    header: (document.querySelector('[data-role=header]') || {}).outerHTML,
    footer: (document.querySelector('[data-role=footer]') || {}).outerHTML,
    page: (document.querySelector('.ui-page-active') || {}).outerHTML,
    loader: (document.querySelector('.ui-loader') || {}).outerHTML
  };
  $root.remove();
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
