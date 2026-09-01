/**
 * @yorick/venues — Shared venue adapter package.
 *
 * Three venues (Vampire, Werewolf, Changeling) share one Parse class but have
 * different rules, costs, and creation pools. This package provides:
 *
 * 1. **Types** — `Venue`, `VenueData`, `CostEngine`, `VenueTrait`, `VenueCharacter`
 * 2. **Data** — generated static tables from the model files
 * 3. **Cost engine utilities** — `costTable`, `costOnTable`, `traitCostOnTable`,
 *    `maxTraitValue`, `calculateTraitToSpend`, `sumTraitValues`
 * 4. **Creation helpers** — `ensureCreationRulesExist`, `updateCreationRulesForChangedTrait`
 * 5. **Venue factories** — `createVampireVenue`, `createWerewolfVenue`,
 *    `createChangelingVenue`
 *
 * ## Architecture
 *
 * The factories are Parse-free. They accept:
 * - `rulesLoader`: a function that fetches reference data (clan rules, gift
 *   descriptions, Kith rules) from the server
 * - `characterView`: a function that adapts the front end's character model to
 *   what the cost engine needs
 *
 * This lets both React (web/) and Vue (client/) build their own `Venue` objects
 * with front-end-specific glue code, while sharing all the venue logic.
 *
 * ## Migration
 *
 * Each front end currently has fully working, independent venue code. The
 * migration is incremental:
 * 1. Shared package with interfaces, utilities, and data (this package)
 * 2. Front end adapters that wire the factories to their Parse glue
 * 3. Gradual replacement of per-front-end venue files with the shared factories
 */
export { type TraitCategory, type TextAttribute, type VenueData, type VenueTrait, type VenueCharacter, type Venue, type CostEngine, type VenueRulesLoader, type StartingTrait, type CreationSeed } from './types'

export { venueData } from './data'

export { costTable, costOnTable, traitCostOnTable, maxTraitValue, calculateTraitToSpend, sumTraitValues, createCostEngine, MAX_TRAIT_LEVEL as COST_MAX_TRAIT_LEVEL } from './costs'

export { ensureCreationRulesExist, updateCreationRulesForChangedTrait } from './creation'

export { createVampireVenue } from './venues/VampireVenue'
export { createWerewolfVenue } from './venues/WerewolfVenue'
export { createChangelingVenue, type ChangelingVenueHooks } from './venues/ChangelingVenue'

// Re-export cost engine modules for front ends that need the raw functions.
export * as VampireCosts from './rules/VampireCosts'
export * as WerewolfCosts from './rules/WerewolfCosts'
export * as ChangelingCosts from './rules/ChangelingCosts'
