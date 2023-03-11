import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { chain, extend, isString, isUndefined, map, result } from 'lodash-es'
import type { Ref, ShallowRef } from 'vue'
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
  ['skills', 'Skills', 'Skills'],
  ['lore_specializations', 'Lore Specializations', 'Skills'],
  ['academics_specializations', 'Academics Specializations', 'Skills'],
  ['drive_specializations', 'Drive Specializations', 'Skills'],
  ['linguistics_specializations', 'Languages', 'Skills'],
  ['disciplines', 'Disciplines', 'Disciplines'],
  ['techniques', 'Techniques', 'Disciplines'],
  ['elder_disciplines', 'Elder Disciplines', 'Disciplines'],
  ['luminary_disciplines', 'Luminary Disciplines', 'Disciplines'],
  ['rituals', 'Rituals', 'Disciplines'],
  ['extra_in_clan_disciplines', 'Extra In Clan Disciplines', 'Disciplines'],
  ['paths', 'Path of Enlightenment/Humanity', 'Morality'],
  ['backgrounds', 'Backgrounds', 'Backgrounds'],
  ['haven_specializations', 'Haven Specializations', 'Backgrounds'],
  ['contacts_specializations', 'Contacts Specializations', 'Backgrounds'],
  ['allies_specializations', 'Allies Specializations', 'Backgrounds'],
  ['sabbat_rituals', 'Sabbat Ritae', 'Backgrounds'],
  ['vampiric_texts', 'Vampiric Texts', 'Backgrounds'],
  ['influence_elite_specializations', 'Influence: Elite', 'Backgrounds'],
  ['influence_underworld_specializations', 'Influence: Underworld', 'Backgrounds'],
  ['status_traits', 'Sect Status', 'Backgrounds'],
  ['merits', 'Merits', 'Merits and Flaws'],
  ['flaws', 'Flaws', 'Merits and Flaws'],
]

const TEXT_ATTRIBUTES = [
  {
    name: 'clan',
    category: 'clans',
    upper: 'Clan',
    pretty: 'Clan',
  },
  {
    name: 'archetype',
    category: 'archetypes',
    upper: 'Archetype',
    pretty: 'Archetype',
  },
  {
    name: 'sect',
    category: 'sects',
    pretty: 'Sect',
    upper: 'Sect',
  },
  {
    name: 'faction',
    category: 'factions',
    upper: character => 'Faction',
    pretty: character => 'Faction',
  },
  {
    name: 'title',
    category: 'titles',
    pretty: 'Title',
    upper: 'Title',
  },
  {
    name: 'antecedence',
    category: 'antecedences',
    upper: 'Antecedence',
    pretty: 'Primary, Secondary, or NPC',
  },
]

const SUM_CREATION_CATEGORIES = ['merits', 'flaws']

export class Vampire extends Character {
  constructor() {
    super('Vampire')
  }

  get_sum_creation_categories() {
    return SUM_CREATION_CATEGORIES
  }

  get_creation_categories() {
    return ['flaws', 'merits', 'focus_mentals', 'focus_physicals', 'focus_socials', 'attributes', 'skills', 'disciplines', 'backgrounds']
  }

  async update_creation_rules_for_changed_trait(category, modified_trait, freeValue) {
    const self = this
    if (!_.includes(['merits', 'flaws'], category)) {
      if (!freeValue)
        return
    }
    if (!_.includes(self.get_creation_categories(), category))
      return

    const creations = useCreationStore()
    const creation = await creations.getCreationForOwner(this)
    const stepName = `${category}_${freeValue}_remaining`
    const listName = `${category}_${freeValue}_picks`
    creation.addUnique(listName, modified_trait)
    if (_.includes(['merits', 'flaws'], category)) {
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
      backgrounds_3_remaining: 1,
      backgrounds_2_remaining: 1,
      backgrounds_1_remaining: 1,
      disciplines_2_remaining: 1,
      disciplines_1_remaining: 2,
      attributes_7_remaining: 1,
      attributes_5_remaining: 1,
      attributes_3_remaining: 1,
      focus_mentals_1_remaining: 1,
      focus_socials_1_remaining: 1,
      focus_physicals_1_remaining: 1,
      merits_0_remaining: 7,
      flaws_0_remaining: 7,
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
    const listCategories = ['flaws', 'merits', 'focus_mentals', 'focus_physicals', 'focus_socials', 'attributes', 'skills', 'backgrounds', 'disciplines']
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
    return _.map(TEXT_ATTRIBUTES, 'pretty')
  }

  all_simpletrait_categories() {
    return ALL_SIMPLETRAIT_CATEGORIES
  }

  simpletrait_details(target: string) {
    for (const values of ALL_SIMPLETRAIT_CATEGORIES) {
      if (values[0] === target) {
        return {
          name: values[0],
          pretty: values[1],
          prettyCategory: values[2],
        }
      }
    }
  }

  all_text_attributes() {
    const result = []
    for (const attr of TEXT_ATTRIBUTES) {
      const d = { ...attr }
      if (_.isFunction(d.pretty))
        d.pretty = d.pretty(this)
      if (_.isFunction(d.upper))
        d.upper = d.upper(this)
      result.push(d)
    }
    return result
  }

  all_text_attributes_pretty_names() {
    const justPretty = _.map(TEXT_ATTRIBUTES, 'pretty')
    const result = []
    for (const pretty of justPretty) {
      if (_.isFunction(pretty))
        result.push(pretty(this))
      else
        result.push(pretty)
    }
    return result
  }

  _raw_generation() {
    const self = this
    let generation
    _.each(self.get('backgrounds'), (b) => {
      if (b.get_base_name() == 'Generation')
        generation = b.get('value')
    })

    return generation
  }

  generation() {
    return this._raw_generation() || 1
  }

  has_generation() {
    return !_.isUndefined(this._raw_generation())
  }

  morality_merit() {
    const self = this
    let morality = 'Humanity'
    _.each(self.get('merits'), (m) => {
      if (_.startsWith(m.get('name'), 'Path of')) {
        const words = _.words(m.get('name'))
        morality = _.slice(words, 2)
        morality = morality.join(' ')
      }
    })
    return morality
  }

  morality() {
    const self = this
    if (!self.has('paths'))
      return new SimpleTrait()

    const p = self.get('paths')[0]
    if (!p)
      return new SimpleTrait({ name: 'Humanity', value: 1 })

    return p
  }

  async calculate_trait_cost(trait) {
    const self = this
    return await self.VampireCosts.calculate_trait_cost(self, trait)
  }

  async calculate_trait_to_spend(trait) {
    const self = this
    const new_cost = await self.VampireCosts.calculate_trait_cost(self, trait)
    const old_cost = trait.get('cost') || 0
    return new_cost - old_cost
  }

  async calculate_total_cost() {
    const self = this
    const current_categories = [
      'skills',
      'backgrounds',
      'disciplines',
      'attributes',
      'merits',
      'rituals',
      'techniques',
      'elder_disciplines',
      'luminary_disciplines',
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

  async initialize_vampire_costs() {
    const self = this
    if (isUndefined(self.VampireCosts))
      self.VampireCosts = new BNSMETV1_VampireCosts()
  }

  async get_in_clan_disciplines() {
    const self = this
    return await self.VampireCosts.get_in_clan_disciplines(self)
  }

  static async append_to_character_fetch_query(q: Parse.Query) {
    q.include('portrait')
    q.include('owner')
    q.include('backgrounds')
    q.include('extra_in_clan_disciplines')
  }

  static async progress(text) {
    console.log(`Progress: ${text}`)
  }

  static async create(name): Promise<ShallowRef<Vampire>> {
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
      owner: Parse.User.current(),
      change_count: 0,
    }
    if (patronage)
      extend(changes, { expiresOn: patronage.get('expiresOn') })

    this.progress('Saving base character')
    await v.save(changes)
    this.progress('Fetching character from server')
    const characters = useCharacterStore()
    const populated_character = await characters.getCharacter(v.id, Vampire)
    this.progress('Adding Humanity')
    await populated_character.value.update_trait('Humanity', 5, 'paths', 5, true)
    this.progress('Adding Healthy')
    await populated_character.value.update_trait('Healthy', 3, 'health_levels', 3, true)
    this.progress('Adding Injured')
    await populated_character.value.update_trait('Injured', 3, 'health_levels', 3, true)
    this.progress('Adding Incapacitated')
    await populated_character.value.update_trait('Incapacitated', 3, 'health_levels', 3, true)
    this.progress('Adding Willpower')
    await populated_character.value.update_trait('Willpower', 6, 'willpower_sources', 6, true)
    this.progress('Done!')
    return populated_character as ShallowRef<Vampire>
  }

  static async create_test_character(nameappend) {
    nameappend = nameappend || ''
    const name = `kct_${nameappend}${Math.random().toString(36).slice(2)}`
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
    if (this.has('backgrounds')) {
      for (const background of this.get('backgrounds')) {
        if (!background.isDataAvailable())
          await background.fetch()
      }
    }
    if (this.has('extra_in_clan_disciplines')) {
      for (const eicd of this.get('extra_in_clan_disciplines')) {
        if (!eicd.isDataAvailable())
          await eicd.fetch()
      }
    }
    await this.ensure_creation_rules_exist()
    await this.initialize_vampire_costs()
    await this.initialize_troupe_membership()
  }
}
