/**
 * Shared creation helpers.
 *
 * Ports `ensure_creation_rules_exist` and `update_creation_rules_for_changed_trait`
 * from the three venues. The mechanics are byte-identical; the differences are
 * data (category names, pool seeds), which live in each venue's data object.
 *
 * ## The XP callback
 *
 * `ensureCreationRulesExist` grants +30 "Character Creation XP" by calling the
 * callback. This is a semantic part of the creation flow, so the shared adapter
 * takes the callback as a parameter rather than importing it. Each front end
 * passes its own XP-granting function.
 *
 * ## Parse dependency
 *
 * `updateCreationRulesForChangedTrait` mutates the creation record via
 * Parse.Object methods (`addUnique`, `set`, `increment`). The caller must
 * pass a creation record that is a Parse.Object (or a compatible duck type).
 * The factory bridges the Parse-free zone by calling this function from the
 * front end layer where Parse is available.
 */
import type { VenueCharacter, VenueData } from './types'
import Parse from 'parse'

/**
 * Create the character's creation record if it has none.
 *
 * Two behaviours worth naming before someone "tidies" them:
 *
 * - The "already has creation" branch swallows a failed fetch: it logs and
 *   returns, so the promise fulfills rather than rejecting.
 * - The new-creation branch points the character at it WITHOUT saving the
 *   character, and then books the +30 "Character Creation XP" notation.
 *   The character is saved by whatever writes next.
 *
 * A character with no creation record and no completed flag is not an error:
 * it's a character that never entered the wizard.
 */
export async function ensureCreationRulesExist(
  character: VenueCharacter,
  seed: Record<string, number | boolean>,
  addExperienceNotation: (
    character: VenueCharacter,
    reason: string,
    alteration_earned: number,
  ) => Promise<void>,
): Promise<void> {
  if (hasCreation(character)) {
    return
  }
  const creation = createCreationRecord(character, seed)
  setCreation(character, creation)
  await addExperienceNotation(character, 'Character Creation XP', 30)
}

function hasCreation(character: VenueCharacter): boolean {
  return Boolean(getCreation(character))
}

function getCreation(character: VenueCharacter): unknown {
  return (character as { get: (attr: string) => unknown }).get('creation')
}

function createCreationRecord(
  character: VenueCharacter,
  seed: Record<string, number | boolean>,
): Record<string, unknown> {
  return { ...seed, owner: character }
}

function setCreation(character: VenueCharacter, creation: Record<string, unknown>): void {
  ;(character as { set: (attr: string, val: unknown) => void }).set('creation', creation)
}

/**
 * Book a changed trait against the creation pools.
 *
 * Four things carry their own reasons, preserved from the source:
 *
 * 1. The `freeValue` short-circuit tests `!freeValue`, so a free value of 0
 *    short-circuits for every category EXCEPT merits and flaws.
 * 2. The allowlist is the second gate: a category not on it is booked nowhere.
 * 3. Completed creation returns early. These counters are creation-time
 *    bookkeeping that nothing reads once the wizard is finished.
 * 4. Merits and flaws are `7 - sum(values)`; every other pool is a count of
 *    picks and decrements by one.
 */
export async function updateCreationRulesForChangedTrait(
  character: VenueCharacter,
  data: VenueData,
  category: string,
  trait: { get: (attr: string) => unknown },
  freeValue: number,
): Promise<void> {
  const sumCategories = data.sumCreationCategories
  const trackedCategories = data.creationListCategories

  // Outside the sum categories, a change with no free value touches no pool.
  if (!sumCategories.includes(category)) {
    if (!freeValue) {
      return
    }
  }

  // A category not on the allowlist is booked nowhere.
  if (!trackedCategories.includes(category)) {
    return
  }

  // Fetch the creation record (with error swallowing, matching the source).
  let creation: Parse.Object | undefined
  try {
    const creations = await Parse.Object.fetchAllIfNeeded(
      [(character as { get: (attr: string) => unknown }).get('creation')].filter(Boolean),
    )
    creation = creations[0] as Parse.Object | undefined
  } catch {
    return
  }

  if (!creation || creation.get('completed')) {
    return
  }

  const stepName = `${category}_${freeValue}_remaining`
  const listName = `${category}_${freeValue}_picks`

  // addUnique — adds to the Parse Array field without duplicating.
  creation.addUnique(listName, trait as Parse.Object)

  if (sumCategories.includes(category)) {
    // Points spent, not picks taken. Sum the values of the picks.
    const picks = creation.get(listName) as Parse.Object[] | undefined
    let sum = 0
    for (const pick of picks ?? []) {
      const v = pick.get('value')
      sum += Number(v) || 0
    }
    creation.set(stepName, 7 - sum)
  } else {
    // Count of picks — decrement by one.
    creation.increment(stepName, -1)
  }
}
