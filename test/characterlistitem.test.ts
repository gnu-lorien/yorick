import * as _ from 'lodash-es'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import CharacterListItem from '../src/components/CharacterListItem.vue'
import { parseStart } from './parsehelpers'
import { Vampire } from '~/models/Vampire'
import { useCharacterStore } from '~/stores/characters'

describe('CharacterListItem.vue', () => {
  beforeAll(async () => {
    await parseStart()
    setActivePinia(createPinia())
  })

  async function getCharacter(): Promise<Vampire> {
    const v = await Vampire.create_test_character('characterlistitem')
    const characters = useCharacterStore()
    const vampire = await characters.getCharacter(v.value.id)
    await vampire.value.update_text('clan', 'Ventrue')
    return vampire
  }

  it('should render', async () => {
    const character = await getCharacter()
    const TestComponent = defineComponent({
      components: { CharacterListItem },
      props: { characterId: String },
      template: '<Suspense><template #fallback>Does this become my text?</template><CharacterListItem :character-id="characterId"/></Suspense>',
    })
    const wrapper = mount(TestComponent, { props: { characterId: character.value.id } })
    const waitForCharacterStoreToComplete = await getCharacter()
    await flushPromises()
    await nextTick()
    expect(wrapper.html()).toContain('Ventrue')
    // expect(wrapper.html()).toMatchSnapshot()
  })

  it('can update clan', async () => {
    const character = await getCharacter()
    const TestComponent = defineComponent({
      components: { CharacterListItem },
      props: { characterId: String },
      template: '<Suspense><template #fallback>Does this become my text?</template><CharacterListItem :character-id="characterId"/></Suspense>',
    })
    const wrapper = mount(TestComponent, { props: { characterId: character.value.id } })
    const waitForCharacterStoreToComplete = await getCharacter()
    await flushPromises()
    await nextTick()
    expect(wrapper.html()).toContain('Ventrue')

    await character.value.update_text('clan', 'Lasombra')
    await flushPromises()
    await nextTick()
    expect(wrapper.html()).toContain('Lasombra')

    // expect(wrapper.html()).toMatchSnapshot()
  })
})
