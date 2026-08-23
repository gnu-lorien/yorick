/**
 * jQuery Mobile's listview enhancement, as a Vue directive.
 *
 * This is the one piece of jQuery Mobile that could not be reproduced by
 * writing the right classes into a template, and getting it wrong is what made
 * a ported list look like a stack of blue underlined links instead of a stack
 * of buttons.
 *
 * ## Why a directive and not markup
 *
 * Everywhere else in `components/jqm`, the enhanced markup is known ahead of
 * time and a component emits it. A listview is different: what jQM writes onto
 * an item depends on the item's own CONTENTS -- how many anchors it has,
 * whether it holds an image, whether it is a divider, and whether it is the
 * first or last VISIBLE row. A template cannot know that about slot content,
 * and threading it through as props at 60-odd call sites would be both
 * laborious and easy to get subtly wrong.
 *
 * So this walks the rendered list and applies `refresh()`'s rules
 * (jquery.mobile-1.4.5.js:7602), which is exactly what jQM did. The difference
 * is that jQM had to be TOLD to redo it -- `.listview("refresh")` appears all
 * over the old views, and forgetting it is a documented source of "the list
 * rendered but looks wrong" bugs. Here `updated` fires on its own, so a list
 * that changes reactively is always right.
 *
 * The rules, faithfully:
 *
 *  - An item whose first child anchor is not already a `ui-btn` becomes one,
 *    plus `ui-btn-icon-right ui-icon-carat-r` unless `data-icon="false"`.
 *  - Two or more anchors make a split button: the item gets `ui-li-has-alt` and
 *    the LAST anchor becomes an icon-only button.
 *  - `data-role="list-divider"` becomes `ui-li-divider ui-bar-inherit`.
 *  - An item with no anchor at all becomes `ui-li-static ui-body-inherit`.
 *  - A count bubble marks its item `ui-li-has-count`.
 *  - An image at the head of an item marks it `ui-li-has-thumb`.
 *  - The first and last visible items get the corner-rounding classes.
 *
 * That last one is not cosmetic trivia: jQM's stylesheet has NO
 * `:first-child` selectors at all, so without `ui-first-child` /
 * `ui-last-child` an inset list has square corners and no theme can fix it.
 */
import type { ObjectDirective } from 'vue'

/** `$.mobile.listview.prototype.options.icon` / `.splitIcon`. */
const DEFAULT_ICON = 'carat-r'
const DEFAULT_SPLIT_ICON = 'carat-r'

function childrenByTag(parent: Element, tag: string): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) out.push(child as HTMLElement)
  }
  return out
}

/**
 * `_addThumbClasses`: the first image at the head of a container marks the
 * enclosing item.
 *
 * jQM walks `firstChild`/`nextSibling` rather than querying, so an image buried
 * deeper in the row does NOT count -- which is deliberate, because it is what
 * separates a thumbnail from an illustration inside the row's text.
 */
function addThumbClasses(container: HTMLElement, item: HTMLElement): void {
  for (const child of Array.from(container.children)) {
    if (child.tagName !== 'IMG') continue
    item.classList.add(child.classList.contains('ui-li-icon') ? 'ui-li-has-icon' : 'ui-li-has-thumb')
    return
  }
}

/** `v-show` sets an inline `display: none`, which is what hides filtered rows. */
function isVisible(item: HTMLElement): boolean {
  return item.style.display !== 'none' && !item.classList.contains('ui-screen-hidden')
}

export function enhanceListview(list: HTMLElement): void {
  const items = childrenByTag(list, 'LI')
  const countThemeClass = 'ui-body-' + (list.getAttribute('data-counttheme') || 'inherit')

  for (const item of items) {
    /*
     * jQM re-classifies an item only if it has not already settled it as a
     * divider or a static row, and only decorates an anchor that is not
     * already a button. Both guards are what make re-running this safe, and
     * this runs on every update.
     */
    const settled =
      item.classList.contains('ui-li-static') || item.classList.contains('ui-li-divider')

    if (!settled) {
      const anchors = childrenByTag(item, 'A') as HTMLAnchorElement[]
      const first = anchors[0]
      const isDivider = item.getAttribute('data-role') === 'list-divider'
      const itemTheme = item.getAttribute('data-theme')

      if (first && !first.classList.contains('ui-btn') && !isDivider) {
        const itemIcon = item.getAttribute('data-icon')
        const icon = itemIcon === 'false' ? null : itemIcon || DEFAULT_ICON

        // `ui-link` is 1.4's deprecated global anchor style; jQM drops it here.
        first.classList.remove('ui-link')

        const buttonClasses = ['ui-btn']
        if (itemTheme) buttonClasses.push('ui-btn-' + itemTheme)

        if (anchors.length > 1) {
          item.classList.add('ui-li-has-alt')
          const last = anchors[anchors.length - 1] as HTMLAnchorElement
          const splitTheme = last.getAttribute('data-theme') || itemTheme
          const splitIcon =
            last.getAttribute('data-icon') || item.getAttribute('data-icon') || DEFAULT_SPLIT_ICON

          /*
           * jQM also EMPTIED this anchor. Not reproduced: Vue owns that text
           * and would put it straight back on the next patch, and it is not
           * needed -- `ui-btn-icon-notext` hides the label in CSS, which is
           * what makes the button icon-only either way. The `title` is set for
           * the same reason jQM set it: the label is the only thing that says
           * what the icon does.
           */
          last.setAttribute('title', (last.textContent || '').trim())
          last.classList.add('ui-btn', 'ui-btn-icon-notext', 'ui-icon-' + splitIcon)
          if (splitTheme) last.classList.add('ui-btn-' + splitTheme)
        } else if (icon) {
          buttonClasses.push('ui-btn-icon-right', 'ui-icon-' + icon)
        }

        first.classList.add(...buttonClasses)
      } else if (isDivider) {
        item.classList.add('ui-li-divider', 'ui-bar-' + (itemTheme || 'inherit'))
        item.setAttribute('role', 'heading')
      } else if (anchors.length === 0) {
        item.classList.add('ui-li-static', 'ui-body-' + (itemTheme || 'inherit'))
      }
    }

    for (const bubble of Array.from(item.querySelectorAll('.ui-li-count'))) {
      item.classList.add('ui-li-has-count')
      if (!/\bui-body-/.test(bubble.className)) bubble.classList.add(countThemeClass)
    }

    addThumbClasses(item, item)
    for (const button of Array.from(item.querySelectorAll<HTMLElement>('.ui-btn'))) {
      addThumbClasses(button, item)
    }
  }

  // `_addFirstLastClasses`, over the VISIBLE rows -- a filtered list rounds the
  // first row still on screen, not the first row that exists.
  const visible = items.filter(isVisible)
  for (const item of items) {
    item.classList.remove('ui-first-child', 'ui-last-child')
  }
  visible[0]?.classList.add('ui-first-child')
  visible[visible.length - 1]?.classList.add('ui-last-child')
}

/**
 * `v-jqm-listview` on a `<ul>`/`<ol>`.
 *
 * `updated` is the replacement for every `.listview("refresh")` call in the old
 * views, and it cannot be forgotten.
 */
export const vJqmListview: ObjectDirective<HTMLElement> = {
  mounted: (el) => enhanceListview(el),
  updated: (el) => enhanceListview(el),
}
