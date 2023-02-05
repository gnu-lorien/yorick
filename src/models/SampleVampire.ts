import Parse from 'parse/dist/parse.min.js'

export class SampleVampire extends Parse.Object {
  constructor() {
    super('Vampire')
  }

  static async progress(text) {
    console.log(`Progress: ${text}`)
  }

  static async create(name) {
    const v = new this()
    const acl = new Parse.ACL()
    acl.setPublicReadAccess(false)
    acl.setPublicWriteAccess(false)
    acl.setWriteAccess(Parse.User.current(), true)
    acl.setReadAccess(Parse.User.current(), true)
    acl.setRoleReadAccess('Administrator', true)
    acl.setRoleWriteAccess('Administrator', true)
    v.setACL(acl)
    this.progress('Fetching patronage status')
    await v.save({
      name,
      owner: Parse.User.current(),
      change_count: 0,
    })
    return v
  }

  static async create_test_character(nameappend) {
    nameappend = nameappend || ''
    const name = `kct_${nameappend}_${Math.random().toString(36).slice(2)}`
    return await this.create(name)
  }
}
