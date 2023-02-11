import Parse from 'parse/dist/parse.min.js'
import * as _ from 'lodash-es'

interface LookupCache {
  [id: string]: any
}
export class Collection {
  model = Parse.Object
  models = []
  query = new Parse.Query(Parse.Object)

  _byId: LookupCache = {}
  _byLocalId: LookupCache = {}

  get length() {
    return this.models.length
  }

  on(event, callback, context?) {
    // RAS TODO Implement event handling. Probably will be a watch on the reactive
  }

  #updateLookups() {
    this._byId = {}
    this._byLocalId = {}
    for (let i = 0; i < this.models.length; ++i) {
      const m = this.models[i]
      if (_.has(m, 'id'))
        this._byId[m.id] = m
      if (_.has(m, '_localId'))
        this._byLocalId[m._localId] = m
    }
  }

  add(models, options?) {
    options = options || {}
    if (_.isArray(models)) {
      for (let i = 0; i < models.length; ++i)
        this.models.push(models[i])
    }
    else {
      this.models.push(models)
    }
  }

  get(id) {
    if (_.has(this._byId, id))
      return this._byId[id]
    if (_.has(this._byLocalId, id))
      return this._byLocalId[id]
    if (_.has(this._byId, _.get(id, 'id')))
      return this._byId[id]
    if (_.has(this._byLocalId, _.get(id, '_localId')))
      return this._byLocalId[id]
    return null
  }

  sync(method, collection, options?) {

  }

  async fetch(options?) {
    options = options || {}
    if (_.get(options, 'reset', false)) {
      while (this.models.length !== 0)
        this.models.pop()
    }
    const remoteObjects = await this.query.find()
    this.add(remoteObjects)
  }
}
