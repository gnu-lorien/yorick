import Parse from 'parse/dist/parse.js'

export class LongText extends Parse.Object {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super('LongText', attributes, options)
  }
}
