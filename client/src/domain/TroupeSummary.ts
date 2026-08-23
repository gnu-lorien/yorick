/**
 * The roster read that the troupe summary, select-to-print and print screens
 * all share, and the filter the first two apply to it.
 *
 * `mobileRouter.js:get_troupe_summarize_characters` (`:1307`) was called by
 * three route handlers with three different destination collections, and
 * `CharactersSummarizeListView` and `CharactersSelectToPrintView` carried
 * byte-identical copies of the filter predicate. One copy each here.
 */
import Parse from '@/parse'
import { CharacterObject } from '@/parse/classes'
import type { Character } from '@/domain/Character'
import { troupeQuery } from '@/domain/Troupe'
import { venueFor } from '@/domain/venues'

/**
 * Every character in a troupe, with the trait columns the summary reads.
 *
 * Two queries, not one, and the split is the source's: werewolves by
 * `type == "Werewolf"` with Werewolf's trait columns included, everyone else by
 * `type != "Werewolf"` with Vampire's. A Changeling therefore arrives through
 * the second query carrying VAMPIRE's include list. It works because the
 * categories these screens can select on are shared, and it is why the category
 * dropdown offers Vampire and Werewolf groups only -- Changeling's own
 * categories were never added to it.
 *
 * Neither query includes `owner`. parse-server deletes an unreadable pointer
 * only when asked to EXPAND it, so the include makes a private owner's
 * character arrive with the key missing -- and a missing `owner` means ARCHIVED
 * to every reader of these rows. The caller hydrates the display names instead.
 *
 * `get_long_text("extended_print_text")` is fetched per character as it is
 * pushed, because the print sheet renders it and nothing else would load it.
 */
export async function fetchTroupeSummaryCharacters(troupeId: string): Promise<Character[]> {
  const troupe = await troupeQuery().include('portrait').get(troupeId)
  const found: Character[] = []

  const werewolves = new Parse.Query(CharacterObject)
  werewolves.equalTo('troupes', troupe)
  werewolves.include('portrait')
  werewolves.equalTo('type', 'Werewolf')
  for (const entry of venueFor('Werewolf').ALL_SIMPLETRAIT_CATEGORIES) {
    werewolves.include(entry[0])
  }
  await werewolves.each(async (character) => {
    found.push(character as Character)
    await (character as Character).get_long_text('extended_print_text')
  })

  const rest = new Parse.Query(CharacterObject)
  rest.equalTo('troupes', troupe)
  rest.include('portrait')
  rest.notEqualTo('type', 'Werewolf')
  for (const entry of venueFor('Vampire').ALL_SIMPLETRAIT_CATEGORIES) {
    rest.include(entry[0])
  }
  await rest.each(async (character) => {
    found.push(character as Character)
    await (character as Character).get_long_text('extended_print_text')
  })

  return found
}

/**
 * Every character in the database, for the administration summary.
 *
 * `get_administrator_summarize_characters` (`mobileRouter.js:1408`). ONE query
 * rather than the troupe version's two, carrying BOTH venues' trait columns,
 * and gated only on `exists("owner")` -- so an archived character is absent.
 * No long text is fetched: this screen never prints.
 *
 * The `owner` include is omitted for the same reason as everywhere else; the
 * caller hydrates.
 */
export async function fetchAllSummaryCharacters(): Promise<Character[]> {
  const query = new Parse.Query(CharacterObject)
  query.exists('owner')
  query.include('portrait')
  for (const entry of venueFor('Vampire').ALL_SIMPLETRAIT_CATEGORIES) query.include(entry[0])
  for (const entry of venueFor('Werewolf').ALL_SIMPLETRAIT_CATEGORIES) query.include(entry[0])

  const found: Character[] = []
  await query.each((character) => {
    found.push(character as Character)
  })
  return found
}

/** The filter form's state, as `filterOptions` held it. */
export interface SummaryFilter {
  category: string
  antecedence: string
  resulttype: string
  playable: boolean
}

/**
 * `newfilter` from `CharactersSummarizeListView.filterwith`, which
 * `CharactersSelectToPrintView.get_filter_function` duplicated verbatim.
 *
 * Every `_.startsWith` is preserved rather than tightened to equality: the
 * option values and the stored `antecedence` are both free text, and prefix
 * matching is what makes "PC of any type" exclude only NPCs.
 */
export function matchesSummaryFilter(character: Parse.Object, filter: SummaryFilter): boolean {
  // An absent antecedence counts as "Primary", which is what makes the default
  // PC filter include a character nobody has classified yet.
  const a = (character.get('antecedence') as string) ?? 'Primary'
  const wanted = filter.antecedence
  if (!wanted.startsWith('All')) {
    if (wanted.startsWith('NPC')) {
      if (!a.startsWith('NPC')) return false
    } else if (wanted.startsWith('PC')) {
      if (a.startsWith('NPC')) return false
    } else if (!a.startsWith(wanted)) {
      return false
    }
  }

  if (filter.resulttype.startsWith('onlycat')) {
    if (!character.has(filter.category)) return false
    if (traitsIn(character, filter.category).length === 0) return false
  } else if (filter.resulttype.startsWith('nocat')) {
    if (character.has(filter.category)) return false
  }

  if (filter.playable && !character.has('owner')) return false

  return true
}

/** One trait category off a character, always an array. */
export function traitsIn(character: Parse.Object, category: string): Parse.Object[] {
  const value = character.get(category)
  return Array.isArray(value) ? (value as Parse.Object[]) : []
}

/** The category select's two optgroups, in the source's order. */
export const SUMMARY_CATEGORY_GROUPS = [
  { label: 'Vampire', options: venueFor('Vampire').ALL_SIMPLETRAIT_CATEGORIES },
  { label: 'Werewolf', options: venueFor('Werewolf').ALL_SIMPLETRAIT_CATEGORIES },
]

/** The pretty name a category prints as its heading. */
export function summaryCategoryName(category: string): string {
  for (const group of SUMMARY_CATEGORY_GROUPS) {
    const found = group.options.find((entry) => entry[0] === category)
    if (found) return found[1]
  }
  return ''
}

export const ANTECEDENCE_OPTIONS = [
  { label: 'All', value: 'All' },
  { label: 'NPC', value: 'NPC' },
  { label: 'PC of any type', value: 'PC' },
  { label: 'Primary PC', value: 'Primary' },
  { label: 'Secondary PC', value: 'Secondary' },
]

export const RESULT_TYPE_OPTIONS = [
  { label: 'Only those with values in the category', value: 'onlycat' },
  { label: 'Only those with no values in the category', value: 'nocat' },
  { label: 'All', value: 'all' },
]
