import * as _ from 'lodash-es'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseStart } from './parsehelpers'
import { Vampire } from '~/models/Vampire'
import { useCharacterStore } from '~/stores/characters'

describe('A Vampire\'s costs', () => {
  let vampire

  beforeAll(async () => {
    await parseStart()
    setActivePinia(createPinia())
    const v = await Vampire.create_test_character('vampirecosts')
    const characters = useCharacterStore()
    vampire = await characters.getCharacter(v.id)
    await vampire.update_text('clan', 'Ventrue')
  })

  it('has base Ventrue in clan disciplines', async () => {
    const icds = await vampire.get_in_clan_disciplines()
    const i = 0
  })

  it('can repick a clan', async () => {
    expect(vampire.get('clan')).not.toBe('DifferentClan')
    await vampire.update_text('clan', 'DifferentClan')
    expect(vampire.get('clan')).toBe('DifferentClan')
  })

  it('can pick Physical as a primary attribute', async () => {
    const creation = vampire.get('creation')
    expect(creation.get('attributes_7_remaining')).toBe(1)
    expect(creation.get('attributes_7_picks')).toBe(undefined)
    const st = await vampire.update_trait('Physical', 7, 'attributes', 7, true)
    expect(vampire.get('creation').get('attributes_7_remaining')).toBe(0)
    expect(vampire.get('creation').get('attributes_7_picks').length).toBe(1)
    expect(vampire.get('creation').get('attributes_7_picks')[0].get('name')).toBe('Physical')
    expect(vampire.get('creation').get('attributes_7_picks')[0].get('value')).toBe(7)
    const physical = await vampire.get_trait('attributes', st.id || st.cid)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Physical')
    expect(physical.get('value')).toBe(7)
  })

  it('can unpick Physical as a primary attribute', async () => {
    expect(vampire.get('creation').get('attributes_7_remaining')).toBe(0)
    expect(vampire.get('creation').get('attributes_7_picks').length).toBe(1)
    const st = _.first(vampire.get('creation').get('attributes_7_picks'))
    const physical = await vampire.get_trait('attributes', st.id)
    expect(physical.get('name')).toBe('Physical')
    expect(physical.get('value')).toBe(7)
    await vampire.unpick_from_creation('attributes', st.id, 7, true)
    expect(vampire.get('creation').get('attributes_7_remaining')).toBe(1)
    expect(vampire.get('creation').get('attributes_7_picks').length).toBe(0)
    expect(vampire.get('attributes').length).toBe(0)
  })

  it('can pick a Physical focus', async () => {
    const creation = vampire.get('creation')
    expect(creation.get('focus_physicals_1_remaining')).toBe(1)
    expect(creation.get('focus_physicals_1_picks')).toBe(undefined)
    const st = await vampire.update_trait('Dexterity', 1, 'focus_physicals', 1, true)
    expect(vampire.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    expect(vampire.get('creation').get('focus_physicals_1_picks')[0].get('name')).toBe('Dexterity')
    expect(vampire.get('creation').get('focus_physicals_1_picks')[0].get('value')).toBe(1)
    const physical = await vampire.get_trait('focus_physicals', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Dexterity')
    expect(physical.get('value')).toBe(1)
    console.log(JSON.stringify(physical._saving))
  })

  it('can repick a Physical focus', async () => {
    expect(vampire.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    const st = _.first(vampire.get('creation').get('focus_physicals_1_picks'))
    let physical = await vampire.get_trait('focus_physicals', st)
    expect(physical.get('name')).toBe('Dexterity')
    expect(physical.get('value')).toBe(1)
    await vampire.unpick_from_creation('focus_physicals', physical, 1, true)
    expect(vampire.get('creation').get('focus_physicals_1_remaining')).toBe(1)
    expect(vampire.get('creation').get('focus_physicals_1_picks').length).toBe(0)
    expect(vampire.get('focus_physicals').length).toBe(0)
    physical = await vampire.update_trait('Stamina', 1, 'focus_physicals', 1, true)
    expect(vampire.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    expect(vampire.get('creation').get('focus_physicals_1_picks')[0].get('name')).toBe('Stamina')
    expect(vampire.get('creation').get('focus_physicals_1_picks')[0].get('value')).toBe(1)
    physical = await vampire.get_trait('focus_physicals', physical)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Stamina')
    expect(physical.get('value')).toBe(1)
  })

  it('can unpick a Physical focus', async () => {
    expect(vampire.get('creation').get('focus_physicals_1_remaining')).toBe(0)
    expect(vampire.get('creation').get('focus_physicals_1_picks').length).toBe(1)
    const st = _.first(vampire.get('creation').get('focus_physicals_1_picks'))
    const physical = await vampire.get_trait('focus_physicals', st)
    expect(physical.get('name')).toBe('Stamina')
    expect(physical.get('value')).toBe(1)
    await vampire.unpick_from_creation('focus_physicals', physical, 1, true)
    expect(vampire.get('creation').get('focus_physicals_1_remaining')).toBe(1)
    expect(vampire.get('creation').get('focus_physicals_1_picks').length).toBe(0)
    expect(vampire.get('focus_physicals').length).toBe(0)
  })

  it('can pick a merit', async () => {
    const creation = vampire.get('creation')
    expect(creation.get('merits_0_remaining')).toBe(7)
    expect(creation.get('merits_0_picks')).toBe(undefined)
    const st = await vampire.update_trait('Bloodline: Coyote', 2, 'merits', 0, true)
    expect(vampire.get('creation').get('merits_0_remaining')).toBe(5)
    expect(vampire.get('creation').get('merits_0_picks').length).toBe(1)
    expect(vampire.get('creation').get('merits_0_picks')[0].get('name')).toBe('Bloodline: Coyote')
    expect(vampire.get('creation').get('merits_0_picks')[0].get('value')).toBe(2)
    const physical = await vampire.get_trait('merits', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(2)
  })

  it('can change the value of a picked merit', async () => {
    const creation = vampire.get('creation')
    expect(creation.get('merits_0_remaining')).toBe(5)
    expect(creation.get('merits_0_picks').length).toBe(1)
    const st = await vampire.update_trait('Bloodline: Coyote', 3, 'merits', 0, true)
    expect(vampire.get('creation').get('merits_0_remaining')).toBe(4)
    expect(vampire.get('creation').get('merits_0_picks').length).toBe(1)
    expect(vampire.get('creation').get('merits_0_picks')[0].get('name')).toBe('Bloodline: Coyote')
    expect(vampire.get('creation').get('merits_0_picks')[0].get('value')).toBe(3)
    const physical = await vampire.get_trait('merits', st)
    expect(physical).not.toBe(undefined)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(3)
  })

  it('can unpick a merit with a changed value', async () => {
    expect(vampire.get('creation').get('merits_0_remaining')).toBe(4)
    expect(vampire.get('creation').get('merits_0_picks').length).toBe(1)
    const st = _.first(vampire.get('creation').get('merits_0_picks'))
    const physical = await vampire.get_trait('merits', st)
    expect(physical.get('name')).toBe('Bloodline: Coyote')
    expect(physical.get('value')).toBe(3)
    await vampire.unpick_from_creation('merits', physical, 0, true)
    expect(vampire.get('creation').get('merits_0_remaining')).toBe(7)
    expect(vampire.get('creation').get('merits_0_picks').length).toBe(0)
    expect(vampire.get('merits').length).toBe(0)
  })
})
