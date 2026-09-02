/**
 * Shared types for the venue adapter package.
 *
 * This is the superset of what both front ends need: the React Venue interface
 * and the Vue VenueStrategy interface converge here. Each front end's venue
 * implementation adapts this shared type to its own domain.
 *
 * ## What is data and what is code
 *
 * `categories`, `textAttributes`, `sumCreationCategories`, `freeCategories`,
 * `creationSeed`, `startingTraits`, and `totalCostCategories` are PERSISTED DATA
 * — column names, pool seeds, and pricing rules already written to live rows.
 * They are typed as plain `string` deliberately: narrowing them to a union would
 * invite a future edit that "cleans up" a name and silently orphans a column.
 */

/**
 * One row of the category list: `[column, pretty name, group]`.
 *
 * The first element is a live Parse column name; the other two drive the sheet's
 * headings and grouping.
 */
export interface TraitCategory {
  /** The attribute name on the character, e.g. "disciplines". */
  key: string
  /** The heading shown for it, e.g. "Disciplines". */
  prettyName: string
  /** The sheet section it belongs to, e.g. "Attributes". */
  group: string
}

/**
 * One text attribute: a free-text column on the sheet and its label.
 *
 * Two of them are functions of the character rather than strings -- Vampire's
 * "Faction" and Changeling's "Group". Both currently ignore their argument and
 * return a constant, so they are emitted as strings in the generated file.
 * If either ever starts depending on the character, the generator must stop.
 */
export interface TextAttribute {
  key: string
  label: string
}

/**
 * One of the traits every new character of a venue starts with.
 *
 * `free_value` is not decoration: it is what makes the trait cost nothing, and
 * `value` and `free_value` differ in exactly one place across the three venues
 * (Werewolf's Gnosis, 10 and 6).
 */
export interface StartingTrait {
  readonly name: string
  readonly value: number
  readonly category: string
  readonly free_value: number
}

/**
 * The attribute bag a new creation row is seeded with.
 *
 * Every venue's seed is a literal in its own module. It is EXACT: each
 * `<pool>_<rating>_remaining` is how many picks of that rating the wizard hands
 * out, and getting one wrong hands a player free traits or refuses ones they are
 * owed.
 */
export type CreationSeed = Readonly<Record<string, number | boolean>>

/**
 * All the static data for one venue, generated from the model files.
 *
 * This is the superset: React's `Venue.data` is a subset (categories +
 * textAttributes + sumCreationCategories). Vue reads all of them. If a new field
 * is needed later, it goes in the generated data without changing the interface.
 */
export interface VenueData {
  categories: TraitCategory[]
  textAttributes: TextAttribute[]
  sumCreationCategories: string[]
  freeCategories: string[]
  creationSeed: CreationSeed
  creationListCategories: string[]
  totalCostCategories: string[]
  getCharacterIncludes: string[]
  startingTraits: StartingTrait[]
  troupeMembershipThrottled: boolean
  typeAttribute: string | undefined
}

/**
 * A trait row as the venues use it.
 *
 * `get_base_name` is the name up to the first ": ". It is required because
 * every venue path that reads a trait's identity calls it unguarded.
 */
export interface VenueTrait {
  /** Read any attribute from the trait. */
  get(attribute: string): unknown
  get_base_name(): string
}

/**
 * What a venue needs from the character it is acting on.
 *
 * Stated structurally, not imported, because the character class is another
 * module. A real `Parse.Object` satisfies the storage half (`get`/`set`/`has`);
 * the venue-specific methods are named here.
 */
export interface VenueCharacter {
  /** Read an attribute from the character. */
  get(attribute: string): unknown

  /** Write an attribute to the character. */
  set(attribute: string, value: unknown): void

  /**
   * The loading-spinner text.
   *
   * Optional: not all front ends have a progress indicator.
   */
  progress?(text: string): void

  /** This venue's SUM_CREATION_CATEGORIES. */
  get_sum_creation_categories(): readonly string[]

  /** Grant experience. The shared adapter's ensureCreationRulesExist calls this. */
  add_experience_notation(options: {
    reason: string
    alteration_earned: number
    earned: number
  }): Promise<void>

  /** Persist a trait. Each front end provides its own implementation. */
  update_trait(
    nameOrTrait: string | VenueTrait,
    value: number,
    category: string,
    free_value?: number,
    wait?: boolean,
  ): Promise<void>

  /** Unpick a creation pick. Each front end provides its own implementation. */
  unpick_from_creation(
    category: string,
    picked_trait_id: string | undefined,
    pick_index: number,
  ): Promise<void>
}

/**
 * The shared cost engine interface.
 *
 * `calculateTraitCost` returns `undefined` when no rule exists for the category
 * (different from free, which returns 0). This distinction is load-bearing:
 * `Character.update_trait` turns `undefined` into a visible refusal.
 */
export interface CostEngine {
  /**
   * What a trait costs in experience, or `undefined` when no rule covers it.
   */
  calculateTraitCost(character: VenueCharacter, trait: VenueTrait): number | undefined

  /**
   * A cumulative cost table: entry i is the price of reaching level i+1.
   *
   * Always 20 entries long, covering every level a trait can reach.
   */
  costTable(costPerEntry: number): number[]

  /**
   * The total cost of holding a trait at `value`, or undefined if `value`
   * exceeds the table.
   */
  costOnTable(table: number[], value: number): number | undefined

  /**
   * A trait's cost net of its free value: what the player actually pays.
   *
   * Returns undefined if either lookup is off the table.
   */
  traitCostOnTable(table: number[], trait: VenueTrait): number | undefined
}

/**
 * What distinguishes a vampire from a werewolf from a changeling.
 *
 * The three share one Parse class and one table, so everything that differs
 * between them is here rather than in a subclass.
 */
export interface Venue {
  name: 'Vampire' | 'Werewolf' | 'ChangelingBetaSlice'

  /** The static tables: categories, text attributes, creation data. */
  data: VenueData

  /** The cost engine, once its rules have loaded. */
  costs: CostEngine

  /** Load whatever rules the cost engine needs. Safe to call more than once. */
  loadRules(): Promise<void>

  /**
   * The highest value this trait may take.
   *
   * Venue-specific: the vampire caps skills at 10 and everything else at 20.
   */
  maxTraitValue(trait: VenueTrait): number

  /**
   * The categories `calculate_total_cost` walks when totalling a sheet.
   *
   * Deliberately not "every category": the venue models each list a subset,
   * and the costs screen totals exactly that subset.
   */
  totalCostCategories: string[]

  /**
   * The categories whose creation pool is spent as a sum of trait values.
   *
   * Everywhere else a pick costs one slot; in these, a 3-point merit costs
   * three.
   */
  sumCreationCategories: string[]

  /**
   * Create the creation record, if this character has none.
   *
   * Ports `ensure_creation_rules_exist`. Each venue seeds a different set of
   * pool counters, and all three then grant the same 30 experience with the
   * reason "Character Creation XP".
   *
   * Note: this requires Parse and is handled by the front-end adapter,
   * not the factory.
   */
  ensureCreationRulesExist?(
    character: VenueCharacter,
    addExperienceNotation: (
      character: VenueCharacter,
      reason: string,
      alteration_earned: number,
    ) => Promise<void>,
  ): Promise<void>

  /**
   * Set a free-text attribute, when the venue does more than store it.
   *
   * Only the changeling defines one, for `ctdbs_kith`: choosing a Kith grants
   * its affinity Arts free and spends the Art creation pool, and repicking has
   * to reconcile both rather than accumulate.
   */
  applyText?(character: VenueCharacter, target: string, value: unknown): Promise<boolean>

  /** The same for clearing one. See `applyText`. */
  releaseText?(character: VenueCharacter, target: string): Promise<boolean>

  /**
   * Spend a creation pool slot on a trait that has just changed.
   *
   * Ports `update_creation_rules_for_changed_trait`. Two guards in every venue
   * matter: outside the sum categories, a change with no free value touches no
   * pool. A completed creation record is left alone.
   *
   * Note: this requires Parse and is handled by the front-end adapter,
   * not the factory.
   */
  updateCreationRulesForChangedTrait?(
    character: VenueCharacter,
    category: string,
    trait: VenueTrait,
    freeValue: number,
  ): Promise<void>
}

/**
 * Rules a venue loads from the server before its costs can be calculated.
 *
 * Vampire needs clan rules, werewolf needs tribe/auspice affinities, changeling
 * needs kith art affinities. All three are fetched once and shared.
 */
export interface VenueRulesLoader {
  load(): Promise<void>
  loaded: boolean
}
