import Parse from 'parse/dist/parse.min.js'
import { type UserModule } from '~/types'
import { Vampire } from '~/models/Vampire'
import { SampleVampire } from '~/models/SampleVampire'

export function registerYorickTypes() {
  Parse.Object.registerSubclass('Vampire', Vampire)
}

// Setup Pinia
// https://pinia.vuejs.org/
export const install: UserModule = ({ isClient, initialState, app }) => {
  registerYorickTypes()
}
