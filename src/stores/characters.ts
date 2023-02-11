import Parse from 'parse/dist/parse.min.js'
import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Vampire } from '~/models/Vampire'

interface CharacterCache {
  [id: string]: Vampire | Object
}
export const useCharacterStore = defineStore('character', () => {
  const characters: CharacterCache = reactive({})

  async function getCharacter(id: string, type: Vampire | any, categories?: string | string[]) {
    if (!(id in characters)) {
      const q = new Parse.Query(type)
      q.include('portrait')
      q.include('owner')
      q.include('backgrounds')
      q.include('extra_in_clan_disciplines')
      const c = await q.get(id)
      characters[id] = c
    }

    const character = characters[id]
    await character.ensure_loaded(categories)
    return character
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
    setNewName,
    otherNames,
    savedName,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
