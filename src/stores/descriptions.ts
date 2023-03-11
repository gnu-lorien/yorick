import * as _ from 'lodash-es'
import Parse from 'parse/dist/parse.js'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { find } from 'lodash-es'
import { ShallowRef } from 'vue'
import { ClanRule } from '~/helpers/BNSMETV1_ClanRule'
import { Character } from '~/models/Character'
import { Description } from '~/models/Description'
import type { Vampire } from '~/models/Vampire'
import { Werewolf } from '~/models/Werewolf'

export const useDescriptionStore = defineStore('description', () => {
  const cache: Map<string, Array<Object>> = reactive(new Map())

  async function getDescriptionsForCategory(category: string): Promise<Array<Object>> {
    if (cache.has(category))
      return cache.get(category)

    const q = new Parse.Query(Description)
    q.equalTo('category', category)
    const descriptions: Array<Object> = []
    await q.eachBatch((results: Array<Object>) => {
      descriptions.push(...results)
    })

    const sortedDescriptions = _.sortBy(descriptions, 'attributes.order', 'attributes.name')
    cache.set(category, sortedDescriptions)
    return getDescriptionsForCategory(category)
  }

  return {
    getDescriptionsForCategory,
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useDescriptionStore, import.meta.hot))
