import Parse from 'parse/dist/parse.js'
export class ClanRule extends Parse.Object {
  static databaseClassName = 'bnsmetv1_ClanRule'

  constructor(attributes?: Parse.Attributes, options?: any) {
    super(ClanRule.databaseClassName, attributes, options)
  }
}
