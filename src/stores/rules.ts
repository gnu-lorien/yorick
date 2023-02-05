import Parse from 'parse/dist/parse.min.js'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { find } from 'lodash-es'
import { ClanRule } from '~/helpers/BNSMETV1_ClanRule'
import { Character } from '~/models/Character'
import type { Vampire } from '~/models/Vampire'

interface CharacterCache {
  [id: string]: Vampire | Object
}
export const useRuleStore = defineStore('rule', () => {
  const clanRules: ClanRule[] = []

  async function getClanRules() {
    const q = new Parse.Query(ClanRule)
    const r = await q.find()
    while (clanRules.length !== 0)
      clanRules.pop()
    for (let i = 0; i < r.length; i++)
      clanRules.push(r[i])
  }

  async function getInClanDisciplines(character: Vampire) {
    if (clanRules.length === 0)
      await getClanRules()
    const clanName = character.get('clan')
    const rule = find(clanRules, (m) => {
      return m.get('clan') === clanName
    })

    if (!rule)
      return []

    return [rule.get('discipline_1'),
      rule.get('discipline_2'),
      rule.get('discipline_3')]
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
    getClanRules,
    getInClanDisciplines,
    setNewName,
    otherNames,
    savedName,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
