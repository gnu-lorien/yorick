/**
 * The character sheet's own components.
 *
 * Separate from `components/jqm/`, which reproduces jQuery Mobile's markup so
 * the 1.4.5 stylesheet keeps working. These do the opposite: they are the one
 * screen that has been redesigned away from that look, and everything they
 * render is styled by `styles/sheet-theme.css` under a `.sheet-redesign` root.
 *
 * Design record: `~/.gstack/projects/gnu-lorien-yorick/designs/character-sheet-20260827/`.
 */
export { default as SheetMasthead } from './SheetMasthead.vue'
export { default as SheetRail } from './SheetRail.vue'
export { default as SheetRow } from './SheetRow.vue'
export { default as SheetSection } from './SheetSection.vue'
export { default as SheetToolbar } from './SheetToolbar.vue'
export type { RailEntry, RailGroup } from './types'
