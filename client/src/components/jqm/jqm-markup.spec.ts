/**
 * The widget kit emits the markup jQuery Mobile emitted.
 *
 * These assertions are transcribed from `REFERENCE.md`, which was in turn read
 * back out of the *running legacy app* after `enhanceWithin()`. That matters:
 * the first version of several of these components was written from memory and
 * got them wrong in ways that looked plausible and rendered incorrectly --
 * classes on the input instead of on its wrapper, an icon class the theme does
 * not use, a fill element the default slider has no equivalent for.
 *
 * The point is not to test Vue. It is to make the class strings a contract, so
 * that a later edit to a component cannot quietly change how every screen in
 * the app looks. jQuery Mobile's stylesheet is the thing doing the rendering,
 * and it only styles what it recognises.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import JqmButton from './JqmButton.vue'
import JqmCheckbox from './JqmCheckbox.vue'
import JqmCollapsible from './JqmCollapsible.vue'
import JqmControlgroup from './JqmControlgroup.vue'
import JqmListDivider from './JqmListDivider.vue'
import JqmListItem from './JqmListItem.vue'
import JqmListview from './JqmListview.vue'
import JqmLoader from './JqmLoader.vue'
import JqmPage from './JqmPage.vue'
import JqmSelect from './JqmSelect.vue'
import JqmSlider from './JqmSlider.vue'
import JqmTable from './JqmTable.vue'
import JqmTd from './JqmTd.vue'
import JqmTextInput from './JqmTextInput.vue'

/** The classes on an element, as a set, so ordering is not asserted. */
function classesOf(html: string, selector: string, root: Element): string[] {
  const el = root.querySelector(selector)
  if (!el) throw new Error(`no element matched ${selector} in:\n${html}`)
  return el.className.split(/\s+/).filter(Boolean).sort()
}

describe('JqmPage', () => {
  it('carries the page id and .ui-page-active, which is how the E2E suite navigates', () => {
    const w = mount(JqmPage, { props: { id: 'character-log', title: 'Character Log' } })
    const page = w.element as HTMLElement
    expect(page.id).toBe('character-log')
    expect(page.classList.contains('ui-page')).toBe(true)
    expect(page.classList.contains('ui-page-active')).toBe(true)
    expect(page.classList.contains('ui-page-theme-a')).toBe(true)
    expect(page.getAttribute('data-role')).toBe('page')
    expect(page.getAttribute('data-title')).toBe('Character Log')
  })

  it('renders a non-empty div[role=main], which waitForActivePage requires', () => {
    const w = mount(JqmPage, { props: { id: 'x' }, slots: { default: '<p>content</p>' } })
    const main = w.element.querySelector('div[role="main"]')
    expect(main).not.toBeNull()
    expect(main!.classList.contains('ui-content')).toBe(true)
    expect(main!.textContent!.trim()).toBe('content')
  })

  it('leaves room for the fixed toolbars only while the chrome is showing', () => {
    const withChrome = mount(JqmPage, {
      props: { id: 'x' },
      global: { provide: { jqmChromeVisible: true } },
    })
    expect(withChrome.element.className).toContain('ui-page-header-fixed')
    expect(withChrome.element.className).toContain('ui-page-footer-fixed')

    const without = mount(JqmPage, { props: { id: 'x' } })
    expect(without.element.className).not.toContain('ui-page-header-fixed')
  })
})

describe('JqmButton', () => {
  it('emits the enhanced anchor classes', () => {
    const w = mount(JqmButton, { props: { href: '#x' } })
    expect(classesOf(w.html(), 'a', w.element.parentElement ?? w.element)).toEqual(
      ['ui-btn', 'ui-corner-all', 'ui-shadow'].sort(),
    )
  })

  it('places the icon classes as jQuery Mobile did', () => {
    const w = mount(JqmButton, { props: { href: '#x', icon: 'arrow-l', iconpos: 'left' } })
    const cls = w.element.className
    expect(cls).toContain('ui-btn-icon-left')
    expect(cls).toContain('ui-icon-arrow-l')
  })

  it('renders a <button> when there is no href, since forms rely on it', () => {
    const w = mount(JqmButton, { props: { type: 'submit' } })
    expect(w.element.tagName).toBe('BUTTON')
    expect(w.element.className).toContain('ui-btn')
  })
})

describe('JqmTextInput', () => {
  it('WRAPS the control rather than classing it', () => {
    // The bug this pins: putting `ui-input-text` on the input renders at the
    // wrong size, because the class styles a block container.
    const w = mount(JqmTextInput, { props: { modelValue: '', id: 'login-username' } })
    const wrapper = w.element as HTMLElement
    expect(wrapper.tagName).toBe('DIV')
    expect(classesOf(w.html(), 'div', wrapper.parentElement ?? wrapper)).toEqual(
      ['ui-corner-all', 'ui-body-inherit', 'ui-input-text', 'ui-shadow-inset'].sort(),
    )
    const input = wrapper.querySelector('input')!
    expect(input.id).toBe('login-username')
    expect(input.className).toBe('')
  })

  it('renders a textarea when multiline, still inside the wrapper', () => {
    const w = mount(JqmTextInput, { props: { modelValue: 'hi', multiline: true } })
    expect(w.element.querySelector('textarea')).not.toBeNull()
    expect((w.element as HTMLElement).className).toContain('ui-input-text')
  })
})

describe('JqmListview', () => {
  it('emits the inset list classes', () => {
    const w = mount(JqmListview, { props: { inset: true } })
    const ul = w.element.querySelector('ul') ?? (w.element as HTMLElement)
    expect(ul.className).toContain('ui-listview')
    expect(ul.className).toContain('ui-listview-inset')
    expect(ul.className).toContain('ui-corner-all')
    expect(ul.className).toContain('ui-shadow')
  })

  it('a linked row leaves the <li> bare and classes the inner anchor', () => {
    const w = mount(JqmListItem, { props: { href: '#y' } })
    const li = w.element as HTMLElement
    expect(li.tagName).toBe('LI')
    const a = li.querySelector('a')!
    expect(a.className).toContain('ui-btn')
    expect(a.className).toContain('ui-btn-icon-right')
    expect(a.className).toContain('ui-icon-carat-r')
  })

  it('a static row carries ui-li-static ui-body-inherit on the <li> itself', () => {
    const w = mount(JqmListItem, {})
    const li = w.element as HTMLElement
    expect(li.className).toContain('ui-li-static')
    expect(li.className).toContain('ui-body-inherit')
    expect(li.querySelector('a')).toBeNull()
  })

  it('a thumbnail row is marked ui-li-has-thumb', () => {
    const w = mount(JqmListItem, { props: { href: '#y', thumb: true } })
    expect((w.element as HTMLElement).className).toContain('ui-li-has-thumb')
  })

  it('a divider carries ui-li-divider ui-bar-inherit', () => {
    const w = mount(JqmListDivider, {})
    const li = w.element as HTMLElement
    expect(li.className).toContain('ui-li-divider')
    expect(li.className).toContain('ui-bar-inherit')
  })
})

describe('JqmCollapsible', () => {
  it('emits the collapsed markup, including the classes the theme depends on', () => {
    const w = mount(JqmCollapsible, { props: { heading: 'Head', collapsed: true } })
    const root = w.element as HTMLElement
    expect(root.className).toContain('ui-collapsible')
    expect(root.className).toContain('ui-collapsible-collapsed')
    // Load-bearing: the listview edge rules key off this one.
    expect(root.className).toContain('ui-collapsible-themed-content')

    const toggle = root.querySelector('.ui-collapsible-heading-toggle')!
    expect(toggle.className).toContain('ui-icon-plus')
    expect(toggle.className).toContain('ui-btn-inherit')
    expect(root.querySelector('.ui-collapsible-heading-status')).not.toBeNull()

    const content = root.querySelector('.ui-collapsible-content')!
    expect(content.className).toContain('ui-body-inherit')
    expect(content.className).toContain('ui-collapsible-content-collapsed')
  })

  it('swaps plus for minus when open', async () => {
    const w = mount(JqmCollapsible, { props: { heading: 'Head', collapsed: false } })
    const toggle = w.element.querySelector('.ui-collapsible-heading-toggle')!
    expect(toggle.className).toContain('ui-icon-minus')
    expect((w.element as HTMLElement).className).not.toContain('ui-collapsible-collapsed')
  })
})

describe('JqmCheckbox', () => {
  it('uses ui-checkbox-off, which carries the icon itself in 1.4.5', () => {
    const w = mount(JqmCheckbox, { props: { modelValue: false, id: 'p-cb' } })
    const label = w.element.querySelector('label')!
    expect(label.className).toContain('ui-checkbox-off')
    // There is no such class in this theme; asserting its absence is the point.
    expect(label.className).not.toContain('ui-icon-checkbox-off')
    expect(label.className).toContain('ui-btn-inherit')
    expect(w.element.querySelector('input')!.id).toBe('p-cb')
  })

  it('flips to ui-checkbox-on when checked', () => {
    const w = mount(JqmCheckbox, { props: { modelValue: true } })
    expect(w.element.querySelector('label')!.className).toContain('ui-checkbox-on')
  })
})

describe('JqmSlider', () => {
  it('keeps the id on a real number input, which is what setJqmSlider drives', () => {
    const w = mount(JqmSlider, { props: { modelValue: 5, id: 'slider', min: 0, max: 10 } })
    const input = w.element.querySelector('#slider') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('number')
    expect(input.getAttribute('data-type')).toBe('range')
    expect(input.className).toContain('ui-slider-input')
    // NOT ui-input-text: that is the text-field wrapper class, not this one.
    expect(input.className).not.toContain('ui-input-text')
  })

  it('emits the track and handle jQuery Mobile emits, and no fill element', () => {
    const w = mount(JqmSlider, { props: { modelValue: 5, min: 0, max: 10 } })
    const track = w.element.querySelector('.ui-slider-track')!
    expect(track.className).toContain('ui-bar-inherit')
    const handle = w.element.querySelector('.ui-slider-handle') as HTMLElement
    expect(handle.className).toContain('ui-btn')
    expect(handle.className).toContain('ui-shadow')
    expect(handle.className).not.toContain('ui-corner-all')
    expect(handle.style.left).toBe('50%')
    // The default slider has no highlight fill; adding one would draw a filled
    // track where the original draws an empty one.
    expect(w.element.querySelector('.ui-slider-bg')).toBeNull()
  })

  it('puts author attributes on the INPUT, not on the wrapper', () => {
    // jQuery Mobile re-typed the author's input in place, so `class` and `name`
    // stayed on the control. `input.value-slider` and
    // `input[name=historyChangePicker]` are both live E2E selectors.
    const w = mount(JqmSlider, {
      props: { modelValue: 1, id: 'value-slider', name: 'simpleTraitValue', min: 1, max: 10 },
      attrs: { class: 'value-slider' },
    })
    const input = w.element.querySelector('input') as HTMLInputElement
    expect(input.classList.contains('value-slider')).toBe(true)
    expect(input.getAttribute('name')).toBe('simpleTraitValue')
    expect((w.element as HTMLElement).classList.contains('value-slider')).toBe(false)
  })

  it('snaps to whole steps, because the approval views index arrays with the value', async () => {
    const w = mount(JqmSlider, { props: { modelValue: 0, min: 0, max: 10, step: 1 } })
    const input = w.element.querySelector('input') as HTMLInputElement
    input.value = '7'
    await w.find('input').trigger('input')
    const emitted = w.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1]![0]).toBe(7)
  })

  it('clamps to the declared range', async () => {
    const w = mount(JqmSlider, { props: { modelValue: 5, min: 0, max: 10 } })
    const input = w.element.querySelector('input') as HTMLInputElement
    input.value = '99'
    await w.find('input').trigger('input')
    const emitted = w.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1]![0]).toBe(10)
  })
})

describe('JqmSelect', () => {
  it('keeps the real select, with its id, inside the styled button', () => {
    const w = mount(JqmSelect, {
      props: { modelValue: '1', id: 'p-sel' },
      slots: { default: '<option value="1">One</option>' },
    })
    const root = w.element as HTMLElement
    expect(root.className).toContain('ui-select')
    const button = root.querySelector('.ui-btn')!
    expect(button.className).toContain('ui-icon-carat-d')
    expect(button.className).toContain('ui-btn-icon-right')
    const select = root.querySelector('select')!
    expect(select.id).toBe('p-sel')
    expect(button.contains(select)).toBe(true)
  })
})

describe('JqmTable', () => {
  it('emits the reflow classes', () => {
    const w = mount(JqmTable, {})
    expect((w.element as HTMLElement).className).toContain('ui-table')
    expect((w.element as HTMLElement).className).toContain('ui-table-reflow')
  })

  it('JqmTd carries the column label the E2E helpers strip back out', () => {
    const w = mount(JqmTd, {
      props: { index: 1 },
      slots: { default: 'value' },
      global: { provide: { jqmTableColumns: ['A', 'B'] } },
    })
    const label = w.element.querySelector('b.ui-table-cell-label')!
    expect(label.textContent).toBe('B')
    expect(w.element.textContent).toContain('value')
  })
})

describe('JqmControlgroup', () => {
  it('emits the wrapper and the inner controls div', () => {
    const w = mount(JqmControlgroup, { slots: { default: '<a class="ui-btn">a</a>' } })
    const root = w.element as HTMLElement
    expect(root.className).toContain('ui-controlgroup')
    expect(root.className).toContain('ui-controlgroup-vertical')
    expect(root.className).toContain('ui-corner-all')
    expect(root.querySelector('.ui-controlgroup-controls')).not.toBeNull()
  })
})

describe('JqmLoader', () => {
  it('is absent when idle, so waitForJqmLoader sees it as clear', () => {
    const w = mount(JqmLoader, { props: { active: false } })
    expect(w.element.querySelector?.('.ui-icon-loading') ?? null).toBeNull()
    expect(w.html()).not.toContain('ui-loader')
  })

  it('emits .ui-loader while working, which is what the helper polls for', () => {
    const w = mount(JqmLoader, { props: { active: true } })
    expect((w.element as HTMLElement).className).toContain('ui-loader')
    expect(w.element.querySelector('.ui-icon-loading')).not.toBeNull()
  })
})
