import * as _ from 'lodash-es'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseStart } from './parsehelpers'
import { useCreationStore } from '~/stores/creations'
import { Vampire } from '~/models/Vampire'
import { useCharacterStore } from '~/stores/characters'

describe('A Vampire\'s initialized fields', () => {
  beforeAll(async () => {
    await parseStart()
    setActivePinia(createPinia())
  })

  async function getCharacter() {
    const v = await Vampire.create_test_character('vampireinit')
    const characters = useCharacterStore()
    const vampire = await characters.getCharacter(v.value.id)
    await vampire.value.update_text('clan', 'Ventrue')
    return vampire
  }

  it('backgrounds are initialized properly', async () => {
    let vampire = await getCharacter()
    await vampire.value.update_trait('MadeUpForTesting', 1, 'backgrounds', 1)
    let madeup = await vampire.value.get_trait_by_name('backgrounds', 'MadeUpForTesting')
    expect(madeup.get('name')).toBe('MadeUpForTesting')
    const characters = useCharacterStore()
    await characters.clearCharacters()
    vampire = await characters.getCharacter(vampire.value.id)
    madeup = await vampire.value.get_trait_by_name('backgrounds', 'MadeUpForTesting')
    expect(madeup.get('name')).toBe('MadeUpForTesting')
  })

  it('extra in clans are initialized properly', async () => {
    let vampire = await getCharacter()
    await vampire.value.update_trait('MadeUpForTesting', 1, 'extra_in_clan_disciplines', 1)
    let icds = await vampire.value.get_in_clan_disciplines()
    expect(icds).to.include('MadeUpForTesting')
    const characters = useCharacterStore()
    await characters.clearCharacters()
    vampire = await characters.getCharacter(vampire.value.id)
    icds = await vampire.value.get_in_clan_disciplines()
    expect(icds).to.include('MadeUpForTesting')
  })

  it('creation is properly available in the store', async () => {
    let vampire = await getCharacter()
    const initialCreationId = vampire.value.get('creation').id
    const characters = useCharacterStore()
    await characters.clearCharacters()
    const creations = useCreationStore()
    await creations.clearCreationRules()
    vampire = await characters.getCharacter(vampire.value.id)
    const nextCreationId = vampire.value.get('creation').id
    expect(nextCreationId).toEqual(initialCreationId)
    const creation = vampire.value.get('creation')
    expect(creation.get('attributes_7_remaining')).toBe(1)
    expect(creation.get('attributes_7_picks')).toBe(undefined)
    const st = await vampire.value.update_trait('Physical', 7, 'attributes', 7, true)
    expect(vampire.value.get('creation').get('attributes_7_remaining')).toBe(0)
    expect(vampire.value.get('creation').get('attributes_7_picks').length).toBe(1)
    expect(vampire.value.get('creation').get('attributes_7_picks')[0].get('name')).toBe('Physical')
    expect(vampire.value.get('creation').get('attributes_7_picks')[0].get('value')).toBe(7)
    const physical = await vampire.value.get_trait('attributes', st.id || st.cid)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Physical')
    expect(physical.get('value')).toBe(7)
  })
})
