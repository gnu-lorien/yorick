import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Character } from '~/models/Character'
import { VampireCreation } from '~/models/VampireCreation'

interface CreationCache {
  [id: string]: VampireCreation
}

interface CharacterToCreationMap {
  [owner: string]: VampireCreation
}

export const useCreationStore = defineStore('creation', () => {
  const creations: CreationCache = reactive({})
  const characterToCreation: CharacterToCreationMap = reactive({})

  async function getCreationForOwner(owner: Character) {
    const ownerReferenceId = owner.toReferenceId()
    if (ownerReferenceId in characterToCreation)
      return characterToCreation[ownerReferenceId]

    const q = new Parse.Query(VampireCreation)
    q.equalTo('owner', owner)
    const vc = await q.first()
    if (_.isUndefined(vc))
      return
    characterToCreation[ownerReferenceId] = vc
    return await getCreationForOwner(owner)
  }

  async function createCreationForOwner(owner: Character) {
    if (_.isUndefined(owner.id))
      throw new Error('May only generate creation rules for a saved character')
    const creation = new VampireCreation(owner.creation_rules_defaults())
    creation.set('owner', owner)
    const newCreation = await creation.save()
    if (_.isUndefined(newCreation.id))
      throw new Error('Failed to save creation rules')
    creations[newCreation.id] = newCreation
    await owner.set_creation(newCreation)
    characterToCreation[owner.toReferenceId()] = newCreation
    return newCreation
  }

  async function getOrCreateCreationRules(owner: Character) {
    const vc = await getCreationForOwner(owner)
    if (_.isUndefined(vc))
      return await createCreationForOwner(owner)
    return vc
  }

  function clearCreationRules() {
    Object.keys(characterToCreation).forEach(key => delete characterToCreation[key])
    Object.keys(creations).forEach(key => delete characterToCreation[key])
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
    getCreationForOwner,
    getOrCreateCreationRules,
    clearCreationRules,
    setNewName,
    otherNames,
    savedName,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useCreationStore, import.meta.hot))
