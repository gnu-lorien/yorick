import Parse from 'parse/dist/parse.js'

export class Description extends Parse.Object {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super('Description', attributes, options)
  }
}
