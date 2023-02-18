import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { chain, extend, isString, isUndefined, map, result } from 'lodash-es'
import { BNSMETV1_VampireCosts } from '~/helpers/BNSMETV1_VampireCosts'
import { Character } from '~/models/Character'
import { SimpleTrait } from '~/models/SimpleTrait'
import { useCharacterStore } from '~/stores/characters'
import { usePatronageStore } from '~/stores/patronage'
import { VampireCreation } from '~/models/VampireCreation'
import { useCreationStore } from '~/stores/creations'

const ALL_SIMPLETRAIT_CATEGORIES = [
  ['attributes', 'Attributes', 'Attributes'],
  ['focus_physicals', 'Physical Focus', 'Attributes'],
  ['focus_mentals', 'Mental Focus', 'Attributes'],
  ['focus_socials', 'Social Focus', 'Attributes'],
  ['health_levels', 'Health Levels', 'Expended'],
  ['willpower_sources', 'Willpower', 'Expended'],
  ['wta_gnosis_sources', 'Gnosis', 'Expended'],
  ['skills', 'Skills', 'Skills'],
  ['lore_specializations', 'Lore Specializations', 'Skills'],
  ['academics_specializations', 'Academics Specializations', 'Skills'],
  ['drive_specializations', 'Drive Specializations', 'Skills'],
  ['linguistics_specializations', 'Languages', 'Skills'],
  ['wta_gifts', 'Gifts', 'Gifts'],
  ['extra_affinity_links', 'Extra Affinities', 'Gifts'],
  ['wta_backgrounds', 'Backgrounds', 'Backgrounds'],
  ['wta_territory_specializations', 'Territory Specializations', 'Backgrounds'],
  ['contacts_specializations', 'Contacts Specializations', 'Backgrounds'],
  ['allies_specializations', 'Allies Specializations', 'Backgrounds'],
  ['influence_elite_specializations', 'Influence: Elite', 'Backgrounds'],
  ['influence_underworld_specializations', 'Influence: Underworld', 'Backgrounds'],
  ['wta_rites', 'Rites', 'Backgrounds'],
  ['wta_monikers', 'Monikers', 'Backgrounds'],
  ['wta_merits', 'Merits', 'Merits and Flaws'],
  ['wta_flaws', 'Flaws', 'Merits and Flaws'],
  ['wta_totem_bonus_traits', 'Totem Bonuses', 'Pack'],
]

const TEXT_ATTRIBUTES = ['archetype', 'archetype_2', 'wta_breed', 'wta_auspice', 'wta_tribe', 'wta_camp', 'wta_faction', 'antecedence']
const TEXT_ATTRIBUTES_PRETTY_NAMES = ['Archetype', 'Second Archetype', 'Breed', 'Auspice', 'Tribe', 'Camp', 'Faction', 'Primary, Secondary, or NPC']

const SUM_CREATION_CATEGORIES = ['wta_merits', 'wta_flaws']

export class Werewolf extends Character {
  constructor() {
    super('Vampire')
  }

  get_sum_creation_categories() {
    return SUM_CREATION_CATEGORIES
  }

  async update_creation_rules_for_changed_trait(category, modified_trait, freeValue) {
    const self = this
    if (!_.includes(['wta_merits', 'wta_flaws'], category)) {
      if (!freeValue)
        return
    }
    /* FIXME Move to the creation model */
    if (!_.includes(['wta_flaws', 'wta_merits', 'focus_mentals', 'focus_physicals', 'focus_socials', 'attributes', 'skills', 'wta_gifts', 'wta_backgrounds'], category))
      return

    const creations = useCreationStore()
    const creation = await creations.getCreationForOwner(this)
    const stepName = `${category}_${freeValue}_remaining`
    const listName = `${category}_${freeValue}_picks`
    creation.addUnique(listName, modified_trait)
    if (_.includes(['wta_merits', 'wta_flaws'], category)) {
      const sum = _.sumBy(creation.get(listName), 'attributes.value')
      creation.set(stepName, 7 - sum)
    }
    else {
      creation.increment(stepName, -1)
    }
    await creation.save()
  }

  creation_rules_defaults() {
    return {
      owner: self,
      completed: false,
      concept: false,
      archetype: false,
      clan: false,
      attributes: false,
      focuses: false,
      skills_4_remaining: 1,
      skills_3_remaining: 2,
      skills_2_remaining: 3,
      skills_1_remaining: 4,
      wta_backgrounds_3_remaining: 1,
      wta_backgrounds_2_remaining: 1,
      wta_backgrounds_1_remaining: 1,
      wta_gifts_1_remaining: 3,
      attributes_7_remaining: 1,
      attributes_5_remaining: 1,
      attributes_3_remaining: 1,
      focus_mentals_1_remaining: 1,
      focus_socials_1_remaining: 1,
      focus_physicals_1_remaining: 1,
      wta_merits_0_remaining: 7,
      wta_flaws_0_remaining: 7,
      phase_1_finished: false,
      initial_xp: 30,
      phase_2_finished: false,
    }
  }

  async set_creation(newCreation) {
    this.set('creation', newCreation)
    await this.add_experience_notation({
      reason: 'Character Creation XP',
      alteration_earned: 30,
      earned: 30,
    })
  }

  async ensure_creation_rules_exist() {
    const self = this
    if (self.has('creation')) {
      await Parse.Object.fetchAllIfNeeded([self.get('creation')])
      return
    }
    const creations = useCreationStore()
    await creations.getOrCreateCreationRules(this)
  }

  async fetch_all_creation_elements() {
    const self = this
    await self.ensure_creation_rules_exist()
    const creation = self.get('creation')
    const listCategories = ['wta_flaws', 'wta_merits', 'focus_mentals', 'focus_physicals', 'focus_socials', 'attributes', 'skills', 'wta_backgrounds', 'wta_gifts']
    let objectIds = []
    _.each(listCategories, (category) => {
      _.each(_.range(-1, 10), (i) => {
        const gn = `${category}_${i}_picks`
        objectIds = _.union(creation.get(gn), objectIds)
      })
    })
    objectIds = _.chain(objectIds).flatten().without(undefined).filter((id) => {
      return id.id
    }).value()
    await Parse.Object.fetchAllIfNeeded(objectIds)
  }

  static all_simpletrait_categories() {
    return ALL_SIMPLETRAIT_CATEGORIES
  }

  static all_text_attributes() {
    return TEXT_ATTRIBUTES
  }

  static all_text_attributes_pretty_names() {
    return TEXT_ATTRIBUTES_PRETTY_NAMES
  }

  _raw_rank() {
    const self = this
    let generation
    _.each(self.get('wta_backgrounds'), (b) => {
      if (b.get_base_name() == 'Rank')
        generation = b.get('value')
    })

    return generation
  }

  generation() {
    return this._raw_rank() || 1
  }

  has_rank() {
    return !_.isUndefined(this._raw_rank())
  }

  get_gnosis_total() {
    const self = this
    const wps = self.get('wta_gnosis_sources')
    const total = _.sumBy(wps, 'attributes.value')
    return total
  }

  async calculate_trait_cost(trait) {
    const self = this
    return await self.Costs.calculate_trait_cost(self, trait)
  }

  async calculate_trait_to_spend(trait) {
    const self = this
    const new_cost = await self.Costs.calculate_trait_cost(self, trait)
    const old_cost = trait.get('cost') || 0
    return new_cost - old_cost
  }

  async calculate_total_cost() {
    const self = this
    const current_categories = [
      'skills',
      'wta_backgrounds',
      'wta_gifts',
      'attributes',
      'wta_merits',
    ]
    const response = {}
    const objectIds = _.chain(current_categories).map((category) => {
      return self.get(category)
    }).flatten().without(undefined).value()
    const traits = await Parse.Object.fetchAllIfNeeded(objectIds)
    _.each(traits, (trait) => {
      response[`${trait.get('category')}-${trait.get('name')}`] = {
        trait,
        cost: self.calculate_trait_cost(trait),
      }
    })
    return response
  }

  max_trait_value(trait) {
    if (trait.get('category') == 'skills')
      return 10

    return 20
  }

  async initialize_costs() {
    const self = this
    if (isUndefined(self.VampireCosts)) {
      self.Costs = new BNSMETV1_VampireCosts()
      await self.Costs.initialize()
    }
  }

  get_affinities() {
    const self = this
    let affinities = [
      self.get('wta_tribe'),
      self.get('wta_auspice'),
      self.get('wta_breed'),
    ]
    affinities = _.without(affinities, undefined)
    let extra_affinities = _.map(self.get('extra_affinity_links'), 'attributes.name')
    extra_affinities = _.without(extra_affinities, undefined)
    return [].concat(affinities, extra_affinities)
  }

  static async append_to_character_fetch_query(q: Parse.Query) {
    q.include('portrait')
    q.include('owner')
    q.include('wta_backgrounds')
    q.include('extra_affinity_links')
  }

  static async progress(text) {
    console.log(`Progress: ${text}`)
  }

  static async create(name) {
    const v = new this()
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(false)
    acl.setPublicWriteAccess(false)
    acl.setWriteAccess(Parse.User.current(), true)
    acl.setReadAccess(Parse.User.current(), true)
    acl.setRoleReadAccess('Administrator', true)
    acl.setRoleWriteAccess('Administrator', true)
    v.setACL(acl)
    this.progress('Fetching patronage status')
    const patronages = usePatronageStore()
    const patronage = await patronages.getLatestPatronage(Parse.User.current())
    const changes = {
      name,
      type: 'Werewolf',
      owner: Parse.User.current(),
      change_count: 0,
    }
    if (patronage)
      extend(changes, { expiresOn: patronage.get('expiresOn') })

    this.progress('Saving base character')
    await v.save(changes)
    this.progress('Fetching character from server')
    const characters = useCharacterStore()
    const populated_character = await characters.getCharacter(v.id, Werewolf)
    this.progress('Adding Healthy')
    await populated_character.update_trait('Healthy', 3, 'health_levels', 3, true)
    this.progress('Adding Injured')
    await populated_character.update_trait('Injured', 3, 'health_levels', 3, true)
    this.progress('Adding Incapacitated')
    await populated_character.update_trait('Incapacitated', 3, 'health_levels', 3, true)
    this.progress('Adding Willpower')
    await populated_character.update_trait('Willpower', 6, 'willpower_sources', 6, true)
    this.progress('Adding Gnosis')
    await populated_character.update_trait('Gnosis', 10, 'wta_gnosis_sources', 10, true)
    this.progress('Done!')
    return populated_character
  }

  static async create_test_character(nameappend) {
    nameappend = nameappend || ''
    const name = `kctw_${nameappend}${Math.random().toString(36).slice(2)}`
    return await this.create(name)
  }

  async ensure_loaded(categories: string | string[] | undefined) {
    categories = categories || []
    if (isString(categories))
      categories = [categories]
    if (categories == 'all') {
      categories = result(this, 'all_simpletrait_categories', [])
      categories = map(categories, (e) => {
        return e[0]
      })
    }
    if (categories.length !== 0) {
      const objectIds = chain(categories).map((category) => {
        return this.get(category)
      }).flatten().without(undefined).filter((id) => {
        return id.id
      }).value()

      await Parse.Object.fetchAllIfNeeded(objectIds)
    }
    if (this.has('portrait') && !this.get('portrait').isDataAvailable())
      await this.get('portrait').fetch()
    if (this.has('owner') && !this.get('owner').isDataAvailable())
      await this.get('owner').fetch()
    if (this.has('wta_backgrounds') && !this.get('wta_backgrounds').isDataAvailable())
      await this.get('wta_backgrounds').fetch()
    if (this.has('extra_affinity_links') && !this.get('extra_affinity_links').isDataAvailable())
      await this.get('extra_affinity_links').fetch()
    await this.ensure_creation_rules_exist()
    await this.initialize_costs()
    await this.initialize_troupe_membership()
  }
}
