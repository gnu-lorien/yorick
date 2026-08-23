/**
 * How a trait is written on a printed character sheet.
 *
 * A port of `helpers/VampirePrintHelper.js`. All eleven numbered styles are
 * reproduced exactly: they are the contract of the printed sheet AND of the CSV
 * exports, and a storyteller reads a stack of these side by side, so a changed
 * separator or a dropped specialization is a real defect rather than a cosmetic
 * one.
 *
 * The lodash 3 idioms in the original do not survive a move to lodash 4, and two
 * of them fail SILENTLY rather than throwing, so each is spelled out here:
 *
 *   - `_.pluck(coll, "attributes.name")` -- `pluck` was REMOVED in v4, and the
 *     path reaches through a Parse object's internals. Written as `get('name')`.
 *   - `_.select(coll, matcher)` -- renamed to `filter`; an object matcher
 *     becomes an explicit comparison.
 *   - `_.reject(coll, {fake: undefined})` -- v4's `isMatch` does not treat an
 *     `undefined` value the way v3 did. The intent is "drop entries with no
 *     `fake`", written as that.
 */
import Parse from '@/parse'

/** The character of a filled dot. Not a bullet: the sheet is printed. */
const DOT = 'O'

/** What a printed trait needs to answer. */
export interface PrintableTrait {
  get(attribute: string): unknown
  has_specialization(): boolean
  get_base_name(): string
  get_specialization(): string
  /** Set by the approval/history replay on a trait that was removed. */
  is_deleted?: boolean
}

/**
 * One change the approval or history replay wants shown as a diff.
 *
 * `fake` is the trait as it stood BEFORE the change; its absence means the
 * change added something rather than altering it.
 */
export interface TransformDescription {
  name?: string
  category?: string
  fake?: PrintableTrait
  /** A core text attribute's previous value; the `fake` of the `"core"` category. */
  old_text?: string
}

/**
 * The eleven styles, verbatim.
 *
 * `style` defaults to 2, which is what an omitted argument meant. Style 0 is
 * the bare name; 9 is the raw value; 10 is the specialization alone. Every
 * style that shows a specialization uses the BASE name, because the stored
 * `name` already contains `": <specialization>"` -- see `SimpleTraitMixin`.
 */
export function formatSkillString(skill: PrintableTrait, style: number = 2): string {
  const name = (skill.get('name') as string) ?? ''
  const value = skill.get('value') as number

  if (style === 0) return name

  if (style === 1) {
    return skill.has_specialization()
      ? `${skill.get_base_name()} x${value}: ${skill.get_specialization()}`
      : `${name} x${value}`
  }

  if (style === 2) {
    const dots = ` x${value} ${DOT.repeat(Math.max(0, value ?? 0))}`
    return skill.has_specialization()
      ? `${skill.get_base_name()}${dots}: ${skill.get_specialization()}`
      : `${name}${dots}`
  }

  if (style === 3) {
    const dots = ` ${DOT.repeat(Math.max(0, value ?? 0))}`
    return skill.has_specialization()
      ? `${skill.get_base_name()}${dots}: ${skill.get_specialization()}`
      : `${name}${dots}`
  }

  if (style === 4) {
    return skill.has_specialization()
      ? `${skill.get_base_name()} (${value}, ${skill.get_specialization()})`
      : `${name} (${value})`
  }

  if (style === 5) {
    return skill.has_specialization()
      ? `${skill.get_base_name()} (${skill.get_specialization()})`
      : name
  }

  if (style === 6) return `${name} (${value})`

  if (style === 7) {
    const words = skill.has_specialization()
      ? `${name} (${skill.get_specialization()})${DOT}`
      : `${name}${DOT}`
    return words.repeat(Math.max(0, value ?? 0))
  }

  if (style === 8) return DOT.repeat(Math.max(0, value ?? 0))

  if (style === 9) return String(value)

  if (style === 10) return skill.get_specialization()

  /*
   * The original returned `undefined` for an unknown style, and the template
   * printed it. An empty string is the same thing without the word "undefined"
   * appearing on a character sheet.
   */
  return ''
}

/** Markup for one side of a diffed trait. Red minus for gone, green plus for new. */
function removedMarkup(text: string): string {
  return `<span style='color: indianred'><i class='fa fa-minus'></i>${text}</span>`
}

function addedMarkup(text: string): string {
  return `<span style='color: darkseagreen'><i class='fa fa-plus'></i>${text}</span>`
}

/**
 * A trait as printed, with the approval diff applied when there is one.
 *
 * On an ordinary sheet this is just `formatSkillString`. On the approval and
 * history screens the character carries a `transform_description` -- a replay of
 * what changed -- and a trait mentioned in it is rendered as its old value or
 * values struck through, followed by its new one, unless the change was a
 * removal, in which case there is no new one to show.
 */
export function formatSkill(
  skill: PrintableTrait,
  style: number | undefined,
  transformDescription?: readonly TransformDescription[],
): string {
  const output = formatSkillString(skill, style)
  if (!transformDescription) return output

  const name = skill.get('name') as string
  const category = skill.get('category') as string
  const matches = transformDescription.filter(
    (change) => change.name === name && change.category === category,
  )
  if (matches.length === 0) return output

  const updates = matches
    .filter((change) => change.fake !== undefined)
    .reverse()
    .map((change) => removedMarkup(formatSkillString(change.fake as PrintableTrait, style)))

  if (!skill.is_deleted) updates.push(addedMarkup(output))

  return updates.join(' ')
}

/**
 * A core text attribute -- name, clan, sect, tribe -- with the diff applied.
 *
 * Core attributes are recorded in the change log under the pseudo-category
 * `"core"`, and their previous value is carried as `old_text` rather than as a
 * `fake` trait, which is why this cannot share `formatSkill`'s body.
 */
export function formatSimpleText(
  character: { get(attribute: string): unknown },
  attributeName: string,
  transformDescription?: readonly TransformDescription[],
): string {
  const current = (character.get(attributeName) as string) ?? ''
  if (!transformDescription) return current

  const matches = transformDescription.filter(
    (change) => change.name === attributeName && change.category === 'core',
  )
  if (matches.length === 0) return current

  const updates = matches
    .filter((change) => change.old_text !== undefined)
    .reverse()
    .map((change) => removedMarkup(String(change.old_text)))

  // Unlike `formatSkill`, this always appends the new value: a core attribute
  // cannot be "deleted", only changed to something else (possibly blank).
  updates.push(addedMarkup(current))
  return updates.join(' ')
}

/** One attribute's value, with the diff applied. */
export function formatAttributeValue(
  attribute: PrintableTrait,
  transformDescription?: readonly TransformDescription[],
): string {
  const current = String(attribute.get('value') ?? '')
  if (!transformDescription) return current

  const name = attribute.get('name') as string
  const matches = transformDescription.filter(
    (change) => change.name === name && change.category === 'attributes',
  )
  if (matches.length === 0) return current

  const updates = matches
    .filter((change) => change.fake !== undefined)
    .reverse()
    .map((change) => removedMarkup(String((change.fake as PrintableTrait).get('value') ?? '')))

  updates.push(addedMarkup(current))
  return updates.join(' ')
}

/**
 * The focus specializations under one attribute, space separated.
 *
 * `Physical` reads `focus_physicals`, and so on -- the category name is derived
 * from the attribute's, lowercased and pluralised.
 */
export function formatAttributeFocus(
  character: { get(attribute: string): unknown },
  attributeName: string,
  transformDescription?: readonly TransformDescription[],
): string {
  const focusCategory = 'focus_' + attributeName.toLowerCase() + 's'
  return formatSpecializations(character, focusCategory, transformDescription).join(' ')
}

/**
 * The names in a category, with the approval diff applied.
 *
 * Used for the sheet's comma-separated lists (specializations, texts) where a
 * value is not printed -- only whether the entry is there.
 */
export function formatSpecializations(
  character: { get(attribute: string): unknown },
  categoryName: string,
  transformDescription?: readonly TransformDescription[],
): string[] {
  const traits = (character.get(categoryName) as (Parse.Object & PrintableTrait)[] | undefined) ?? []

  if (!transformDescription || !transformDescription.some((c) => c.category === categoryName)) {
    return traits.map((trait) => (trait.get('name') as string) ?? '')
  }

  return traits.map((trait) => {
    const name = (trait.get('name') as string) ?? ''
    const matches = transformDescription.filter(
      (change) => change.category === categoryName && change.name === name,
    )
    if (matches.length === 0) return name

    const updates = matches
      .filter((change) => change.fake !== undefined)
      .reverse()
      .map(() => removedMarkup(name))

    if (!trait.is_deleted) updates.push(addedMarkup(name))
    return updates.join(' ')
  })
}
