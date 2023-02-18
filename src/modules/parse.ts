import Parse from 'parse/dist/parse.js'
import { type UserModule } from '~/types'
import { useConfigTestDefault } from '~/composables/siteconfig'

// Setup Pinia
// https://pinia.vuejs.org/
export const install: UserModule = ({ isClient, initialState, app }) => {
  Parse.initialize('APPLICATION_ID')
  Parse.serverURL = useConfigTestDefault().serverURL
}
