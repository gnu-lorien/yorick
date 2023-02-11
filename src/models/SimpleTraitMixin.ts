import * as _ from 'lodash-es'

export class SimpleTraitMixin {
  linkId() {
    return this.id || this.cid
  }

  get_base_name() {
    const self = this
    const name = self.get('name') || ''
    const s = name.split(': ')
    return s[0]
  }

  get_specialization() {
    const self = this
    const name = self.get('name') || ''
    const s = name.split(': ')
    return s[1]
  }

  has_specialization() {
    const self = this
    const name = self.get('name') || ''
    return name.includes(': ')
  }

  set_specialization(specialization) {
    const self = this
    if (!specialization)
      self.set('name', self.get_base_name())
    else
      self.set('name', `${self.get_base_name()}: ${specialization}`)

    return self
  }

  validate(attr, options) {
    const self = this
    const failures = {}
    _.each(['value', 'free_value'], (name) => {
      if (_.has(attr, name)) {
        if (!_.isFinite(attr[name]))
          failures[name] = { message: `${name} must be a number. Trying to save as ${attr[name]}` }
      }
    })
    if (_.keys(failures).length != 0)
      return failures
  }

  _findUnsavedChildren(object, children, files) {
    console.log(`Before ${this.get('name')}: ${children.length}`)
    Parse.Object._findUnsavedChildren.apply(this, object, children, files)
    console.log(`After ${this.get('name')}: ${children.length}`)
  }
}
