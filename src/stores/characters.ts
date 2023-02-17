import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { Vampire } from '~/models/Vampire'
import { Werewolf } from '~/models/Werewolf'

export const useCharacterStore = defineStore('character', () => {
  const characters: Map<string, Vampire | Werewolf> = reactive(new Map())

  function getCharacterType(data, type?: Vampire | Werewolf) {
    if (_.isUndefined(type)) {
      const databaseType = data.get('type')
      if (databaseType === 'Werewolf')
        return Werewolf
      return Vampire
    }
    return type
  }
  async function getCharacter(id: string, type: Vampire | Werewolf, categories?: string | string[]) {
    if (!(id in characters)) {
      const q = new Parse.Query(type || 'Character')
      await type.append_to_character_fetch_query(q)
      const data = await q.get(id, { json: true })
      const c = type.fromJSONAsType(data, getCharacterType(data, type))
      characters[id] = c
    }

    const character = characters[id]
    await character.ensure_loaded(categories)
    return character
  }

  async function clearCharacters() {
    characters.clear()
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
    setNewName,
    otherNames,
    savedName,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
