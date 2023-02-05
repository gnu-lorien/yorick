import Parse from 'parse'
import { type UserModule } from '~/types'
import { Vampire } from '~/models/Vampire'

export function registerYorickTypes() {
  Parse.Object.registerSubclass('Vampire', Vampire)
}

// Setup Pinia
// https://pinia.vuejs.org/
export const install: UserModule = ({ isClient, initialState, app }) => {
  registerYorickTypes()
}
