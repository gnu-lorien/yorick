import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'
import { useConfigTestDefault } from '~/composables/siteconfig'
import { registerYorickTypes } from '~/modules/parsetypes'

async function parseInit() {
  Parse.initialize('APPLICATION_ID')
  Parse.serverURL = useConfigTestDefault().serverURL
  registerYorickTypes()
}
export async function parseStart() {
  await parseInit()
  if (Parse.User.current() === null || !_.eq(Parse.User.current().get('username'), 'devuser'))
    return await Parse.User.logIn('devuser', 'thedumbness')

  return Parse.User.current()
}

export async function parseEnd() {
  if (Parse.User.current())
    Parse.User.logOut()
}
