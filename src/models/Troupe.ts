import Parse from 'parse/dist/parse.js'
import * as _ from 'lodash-es'

export class Troupe extends Parse.Object {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super('Troupe', attributes, options)
    const self = this
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(true)
    acl.setPublicWriteAccess(false)
    acl.setRoleReadAccess('Administrator', true)
    acl.setRoleWriteAccess('Administrator', true)
    self.setACL(acl)
    self.title_options = ['LST', 'AST', 'Narrator']
  }

  async get_staff() {
    const self = this
    const users = []
    const roles = await self.get_roles()
    const userqs = _.map(roles, (role, title) => {
      const u = role.getUsers()
      const q = u.query()
      return q.each((user) => {
        user.set('role', title)
        users.push(user)
      })
    })
    await Promise.all(userqs)
    return users
  }

  async get_roles() {
    const self = this
    const roles = {}
    const promises = _.map(self.title_options, (title) => {
      const q = new Parse.Query(Parse.Role)
      q.equalTo('name', `${title}_${self.id}`)
      return q.first().then((role) => {
        roles[title] = role
      })
    })
    await Promise.all(promises)
    return roles
  }

  async get_generic_roles() {
    const self = this
    const roles = {}
    const promises = _.map(self.title_options, (title) => {
      const q = new Parse.Query(Parse.Role)
      q.equalTo('name', title)
      return q.first().then((role) => {
        roles[title] = role
      })
    })
    await Promise.all(promises)
    return roles
  }

  async get_thumbnail(size) {
    const self = this
    if (self.get('portrait')) {
      let portrait = self.get('portrait')
      portrait = portrait.fetch()
      console.log(self.get_thumbnail_sync(size))
      return portrait.get(`thumb_${size}`).url()
    }
    else {
      return 'head_skull.png'
    }
  }

  get_thumbnail_sync(size) {
    const self = this
    return _.result(self, `attributes.portrait.attributes.thumb_${size}.url`, 'head_skull.png')
  }
}
