import Parse from 'parse/dist/parse.js'
export class Approval extends Parse.Object {
  constructor(
    attributes?: Parse.Attributes,
    options?: any,
  ) {
    super('VampireApproval', attributes, options)
  }
}
