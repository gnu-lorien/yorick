export class FauxTrait {
  constructor(attributes) {
    Object.keys(attributes).forEach(v => this[v] = attributes[v])
  }

  get(n) { return this[n] }
  get_specialization() {
    const name = this.get('name') || ''
    const s = name.split(': ')
    return s[1]
  }
}
