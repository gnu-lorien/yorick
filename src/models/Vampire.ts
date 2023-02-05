import Parse from 'parse/dist/parse.min.js'
import { chain, extend, isString, isUndefined, map, result } from 'lodash-es'
import { BNSMETV1_VampireCosts } from '~/helpers/BNSMETV1_VampireCosts'
import { Character } from '~/models/Character'
import { useCharacterStore } from '~/stores/characters'
import { usePatronageStore } from '~/stores/patronage'
import { VampireCreation } from '~/models/VampireCreation'

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

const TEXT_ATTRIBUTES = ['clan', 'archetype', 'sect', 'faction', 'title', 'antecedence']
const TEXT_ATTRIBUTES_PRETTY_NAMES = ['Clan', 'Archetype', 'Sect', function (character) { return 'Faction' }, 'Title', 'Primary, Secondary, or NPC']

const SUM_CREATION_CATEGORIES = ['merits', 'flaws']

export class Vampire extends Character {
  constructor() {
    super('Vampire')
  }

  static get_sum_creation_categories() {
    return SUM_CREATION_CATEGORIES
  }

  static all_simpletrait_categories() {
    return ALL_SIMPLETRAIT_CATEGORIES
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
    await this.ensure_creation_rules_exist()
    await this.initialize_vampire_costs()
    await this.initialize_troup_membership()
  }

  async ensure_creation_rules_exist() {
    const self = this
    if (self.has('creation')) {
      await Parse.Object.fetchAllIfNeeded([self.get('creation')])
      return
    }
    const creation = new VampireCreation({
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
    })
    const newCreation = await creation.save()
    self.set('creation', newCreation)
    await self.add_experience_notation({
      reason: 'Character Creation XP',
      alteration_earned: 30,
      earned: 30,
    })
  }

  async initialize_vampire_costs() {
    const self = this
    if (isUndefined(self.VampireCosts))
      self.VampireCosts = new BNSMETV1_VampireCosts()
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
    await populated_character.update_trait('Humanity', 5, 'paths', 5, true)
    this.progress('Adding Healthy')
    await populated_character.update_trait('Healthy', 3, 'health_levels', 3, true)
    this.progress('Adding Injured')
    await populated_character.update_trait('Injured', 3, 'health_levels', 3, true)
    this.progress('Adding Incapacitated')
    await populated_character.update_trait('Incapacitated', 3, 'health_levels', 3, true)
    this.progress('Adding Willpower')
    await populated_character.update_trait('Willpower', 6, 'willpower_sources', 6, true)
    this.progress('Done!')
    return populated_character
  }

  static async create_test_character(nameappend) {
    nameappend = nameappend || ''
    const name = `karmacharactertest${nameappend}${Math.random().toString(36).slice(2)}`
    return await this.create(name)
  }
}
