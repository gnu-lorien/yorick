import { Parse } from '../init';

/**
 * A single trait on a character: a name, a value, and the category it lives in.
 *
 * Ports models/SimpleTrait.js and models/SimpleTraitMixin.js.
 *
 * The specialization convention is the part worth knowing: a trait's name can
 * carry one, separated by ": " -- "Lore: Kindred", "Influence: Elite". Every
 * consumer that wants the trait *without* its specialization calls
 * `baseName`, and the cost engines compare in-clan and affinity lists against
 * both forms, because a rule granting "Lore" must also match "Lore: Kindred".
 */
export class SimpleTrait extends Parse.Object {
  constructor(attributes?: Record<string, unknown>) {
    super('SimpleTrait');
    if (attributes) this.set(attributes);
  }

  get name(): string {
    return (this.get('name') as string) ?? '';
  }

  get value(): number {
    return (this.get('value') as number) ?? 0;
  }

  get freeValue(): number {
    return (this.get('free_value') as number) ?? 0;
  }

  get category(): string {
    return (this.get('category') as string) ?? '';
  }

  get cost(): number {
    return (this.get('cost') as number) ?? 0;
  }

  /**
   * A stable key for this trait in a list.
   *
   * The legacy `linkId()` falls back to the Backbone `cid` for a trait that has
   * not been saved yet, so an unsaved row still has something to key on. Parse
   * objects keep a client id under `_localId` for the same purpose.
   */
  linkId(): string {
    return this.id ?? (this as unknown as { _localId?: string })._localId ?? '';
  }

  /** "Lore: Kindred" -> "Lore". The name with any specialization removed. */
  baseName(): string {
    return this.name.split(': ')[0] ?? '';
  }

  /** "Lore: Kindred" -> "Kindred", or undefined when there is no specialization. */
  specialization(): string | undefined {
    return this.name.split(': ')[1];
  }

  hasSpecialization(): boolean {
    return this.name.includes(': ');
  }

  /** Set or clear the specialization, keeping the base name. */
  setSpecialization(specialization: string | undefined | null): this {
    this.set('name', specialization ? `${this.baseName()}: ${specialization}` : this.baseName());
    return this;
  }

  /**
   * Reject a non-numeric value or free_value.
   *
   * The legacy mixin validates both, and the reason is visible in the message
   * it writes -- "must be a number. Trying to save as ...". A trait whose value
   * arrives as a string sums as string concatenation everywhere downstream, so
   * a creation pool of 7 becomes "07" and the remaining count goes wrong
   * without anything throwing.
   */
  override validate(attributes: Record<string, unknown>): Parse.Error | false {
    for (const name of ['value', 'free_value'] as const) {
      if (!(name in attributes)) continue;
      const candidate = attributes[name];
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        return new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          `${name} must be a number. Trying to save as ${String(candidate)}`,
        );
      }
    }
    return false;
  }
}

Parse.Object.registerSubclass('SimpleTrait', SimpleTrait);

/**
 * A trait that is not backed by a row.
 *
 * The legacy FauxSimpleTrait is a Backbone.Model carrying the same mixin, used
 * where the sheet needs a trait-shaped thing that must never be saved -- a
 * default Humanity of 1 for a vampire with no path, for instance. Here it is
 * the same class with a flag, because SimpleTrait is no longer entangled with
 * Backbone and there is nothing left for a second class to avoid.
 */
export function fauxTrait(attributes: Record<string, unknown>): SimpleTrait {
  const trait = new SimpleTrait(attributes);
  (trait as unknown as { __faux: boolean }).__faux = true;
  return trait;
}

/** True for a trait built by `fauxTrait` -- display only, never saved. */
export function isFauxTrait(trait: SimpleTrait): boolean {
  return (trait as unknown as { __faux?: boolean }).__faux === true;
}
