import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Ref } from 'vue'
import { Vampire } from '~/models/Vampire'
import { Werewolf } from '~/models/Werewolf'
import { Character } from '~/models/Character'

export const useCharacterStore = defineStore('character', () => {
  const characters: Map<string, Ref<Vampire | Werewolf>> = new Map()
  const userCharacterIds: Map<string, Array<string>> = reactive(new Map())

  function getCharacterType(data, type?: Vampire | Werewolf) {
    if (_.isUndefined(type)) {
      const databaseType = _.get(data, 'type', 'Vampire')
      if (databaseType === 'Werewolf')
        return Werewolf

      else if (databaseType === 'Vampire')
        return Vampire

      else
        throw new Error('Unknown character type provided by the database')
    }
    return type
  }
  async function getCharacter(id: string, type?: Vampire | Werewolf, categories?: string | string[]): Promise<Vampire | Werewolf> {
    if (characters.has(id)) {
      const character = characters.get(id)
      await character.value.ensure_loaded(categories)
      return character
    }
    if (!_.isUndefined(type)) {
      const q = new Parse.Query(type)
      await type.append_to_character_fetch_query(q)
      const data = await q.get(id, { json: true })
      const c = type.fromJSONAsType(data, getCharacterType(data, type))
      characters.set(id, ref(c))
      return getCharacter(id, type, categories)
    }
    const q = new Parse.Query('Vampire')
    const data = await q.get(id, { json: true })
    const realType = getCharacterType(data, type)
    const c = Character.fromJSONAsType(data, realType)
    characters.set(id, ref(c))
    return getCharacter(id, realType, categories)
  }

  async function clearCharacters() {
    characters.clear()
    userCharacterIds.clear()
  }

  async function getUserCharacters(user, type, limit = 100) {
    if (userCharacterIds.has(user.id)) {
      const result = []
      const ids = userCharacterIds.get(user.id) || []
      for (const id of ids)
        result.push(await getCharacter(id))
      return result
    }
    const q = new Parse.Query('Vampire')
    q.equalTo('owner', user)
    q.limit(limit)
    const found = await q.find()
    const ids = _.map(found, 'id')
    userCharacterIds.set(user.id, ids)
    return await getUserCharacters(user, type)
  }
  /**
   * Current name of the user.
   */
  const savedName = ref('')
  const previousNames = ref(new Set<string>())

  const usedNames = computed(() => Array.from(previousNames.value))
  const otherNames = computed(() => usedNames.value.filter(name => name !== savedName.value))

  /**
   * Changes the current name of the user and saves the one that was used
   * before.
   *
   * @param name - new name to set
   */
  function setNewName(name: string) {
    if (savedName.value)
      previousNames.value.add(savedName.value)

    savedName.value = name
  }

  return {
    getCharacter,
    clearCharacters,
    getUserCharacters,
    setNewName,
    otherNames,
    savedName,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
