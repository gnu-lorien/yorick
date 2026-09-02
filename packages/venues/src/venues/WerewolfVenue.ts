/**
 * Werewolf venue factory.
 *
 * Builds a `Venue` object from the generated data and the cost engine.
 * The factory is Parse-free: it provides the static interface, the cost engine
 * wiring, and the rule-loading callback.
 *
 * Note: creation rule updates (ensure/update) require Parse and are handled by
 * the front-end adapter, not this factory.
 */
import type { Venue, VenueCharacter, VenueTrait } from '../types'
import { venueData } from '../data'
import { createCostEngine } from '../costs'
import {
  calculate_trait_cost as _werewolfCalculateTraitCost,
  FREE_CATEGORIES,
  MAX_TRAIT_LEVEL,
  type GiftDescription,
} from '../rules/WerewolfCosts'

export { FREE_CATEGORIES, MAX_TRAIT_LEVEL }

/**
 * Build the Werewolf venue object.
 *
 * @param rulesLoader - Fetches gift descriptions from the server.
 * @param characterView - Must provide: `rawRank(char)`: number | undefined
 */
export function createWerewolfVenue(
  rulesLoader: () => Promise<GiftDescription[]>,
  characterView: (character: VenueCharacter) => {
    rawRank(): number | undefined
  },
): Venue {
  let descriptions: GiftDescription[] = []
  let loadPromise: Promise<void> | null = null
  let loaded = false

  const data = venueData.Werewolf

  function costView(character: VenueCharacter) {
    const raw = characterView(character).rawRank()
    return {
      get: (attr: string) => character.get(attr),
      rank: () => (raw === undefined || raw === null ? 0 : raw),
    }
  }

  function calculateTraitCost(character: VenueCharacter, trait: VenueTrait): number | undefined {
    return (_werewolfCalculateTraitCost as (
      character: unknown,
      trait: unknown,
      descriptions: GiftDescription[],
    ) => number | undefined)(
      costView(character),
      trait,
      descriptions,
    )
  }

  const engine = createCostEngine(calculateTraitCost)

  return {
    name: 'Werewolf',
    data,
    costs: engine,

    async loadRules() {
      if (loaded) return
      if (!loadPromise) {
        loadPromise = rulesLoader().then((descriptions_) => {
          descriptions = descriptions_
          loaded = true
        }).catch(() => {
          loadPromise = null
          loaded = false
          throw new Error('Failed to load werewolf gift descriptions')
        })
      }
      return loadPromise
    },

    maxTraitValue(trait: VenueTrait): number {
      return trait.get('category') === 'skills' ? 10 : 20
    },

    totalCostCategories: data.totalCostCategories,
    sumCreationCategories: data.sumCreationCategories,
  }
}
