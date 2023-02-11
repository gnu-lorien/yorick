export class Collection {
  model
  models = reactive([])
  constructor(model) {
    this.model = model
  }

  comparator(left, right) { return 0 }
}
