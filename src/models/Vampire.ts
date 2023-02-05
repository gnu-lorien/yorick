import Parse from 'parse'

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

export class Vampire extends Parse.Object {
  constructor() {
    super('Vampire')
  }

  get_sum_creation_categories() {
    return SUM_CREATION_CATEGORIES
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
    progress('Fetching patronage status')
    return UserChannel.get_latest_patronage(Parse.User.current()).then((patronage) => {
      const changes = {
        name,
        owner: Parse.User.current(),
        change_count: 0,
      }
      if (patronage)
        _.extend(changes, { expiresOn: patronage.get('expiresOn') })

      progress('Saving base character')
      return v.save(changes)
    }).then(() => {
      progress('Fetching character from server')
      return Model.get_character(v.id)
    }).then((vampire) => {
      populated_character = vampire
      progress('Adding Humanity')
      return populated_character.update_trait('Humanity', 5, 'paths', 5, true)
    }).then(() => {
      progress('Adding Healthy')
      return populated_character.update_trait('Healthy', 3, 'health_levels', 3, true)
    }).then(() => {
      progress('Adding Injured')
      return populated_character.update_trait('Injured', 3, 'health_levels', 3, true)
    }).then(() => {
      progress('Adding Incapacitated')
      return populated_character.update_trait('Incapacitated', 3, 'health_levels', 3, true)
    }).then(() => {
      progress('Adding Willpower')
      return populated_character.update_trait('Willpower', 6, 'willpower_sources', 6, true)
    }).then(() => {
      progress('Done!')
      return Parse.Promise.as(populated_character)
    })
  }

  static async create_test_character(nameappend) {
    nameappend = nameappend || ''
    const name = `karmacharactertest${nameappend}${Math.random().toString(36).slice(2)}`
    return await this.create(name)
  }
}
