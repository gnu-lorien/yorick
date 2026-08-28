/**
 * Shared shapes for the character sheet's components.
 *
 * These live here rather than in `SheetRail.vue` because `<script setup>`
 * cannot contain ES module exports -- an `export interface` inside one is a
 * compile error, not just a lint complaint.
 */

export interface RailEntry {
  label: string
  /** How many traits sit behind this entry, or null when counting is meaningless. */
  count?: number | null
  /** A real destination. Mutually exclusive with `jump`. */
  href?: string
  /** A section on this page to expand and scroll to. Mutually exclusive with `href`. */
  jump?: string
}

export interface RailGroup {
  heading: string
  entries: RailEntry[]
}
