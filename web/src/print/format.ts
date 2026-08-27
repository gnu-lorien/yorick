import type { Character } from '@/parse/models/Character';
import type { SimpleTrait } from '@/parse/models/SimpleTrait';
import { isDeleted, type TransformEntry } from '@/parse/character/approvals';

/**
 * How the printable sheet renders a trait, and how it marks what changed.
 *
 * Ports helpers/VampirePrintHelper.js.
 *
 * Two jobs, tangled together in the original. The first is *formatting*: eleven
 * numbered styles for turning a trait into a string, from a bare name to a row
 * of dots. The second is *diffing*: when the sheet is showing a range of
 * changes -- the approval screen does this -- each changed value is rendered as
 * the old ones struck through in red followed by the new one in green.
 *
 * They are separated here. `formatTrait` is pure text; `diffed` wraps any
 * formatter with the red/green treatment when a transform description is in
 * play. That is the same behaviour, but it means the eleven styles can be read
 * without the diffing, which is most of what made the original hard going.
 */

/** A sheet being shown plainly, or one showing a range of changes. */
export interface PrintContext {
  /** The character whose values are shown. */
  character: Character;
  /**
   * The changes being highlighted, when the sheet is showing a range.
   *
   * Absent on an ordinary printout, which is why every formatter here has a
   * "no description" path that simply returns the value.
   */
  transformDescription?: TransformEntry[];
}

/**
 * The trait format styles, by their number in the original.
 *
 * The numbers are not arbitrary -- the print templates pass them literally
 * (`format_skill(skill, 3)`), so they are part of the contract with those
 * templates and are kept rather than replaced with names.
 */
export type SkillStyle = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** The character used for a single point of a trait. */
const DOT = 'O';

/** Format one trait as text, with no diff markers. */
export function formatTrait(trait: SimpleTrait, style: SkillStyle = 2): string {
  const name = trait.name;
  const base = trait.baseName();
  const specialization = trait.specialization();
  const value = trait.value;
  const specialized = trait.hasSpecialization();

  switch (style) {
    case 0:
      return name;
    case 1:
      return specialized ? `${base} x${value}: ${specialization}` : `${name} x${value}`;
    case 2: {
      const suffix = ` x${value} ${DOT.repeat(Math.max(0, value))}`;
      return specialized ? `${base}${suffix}: ${specialization}` : `${name}${suffix}`;
    }
    case 3: {
      const suffix = ` ${DOT.repeat(Math.max(0, value))}`;
      return specialized ? `${base}${suffix}: ${specialization}` : `${name}${suffix}`;
    }
    case 4:
      return specialized ? `${base} (${value}, ${specialization})` : `${name} (${value})`;
    case 5:
      return specialized ? `${base} (${specialization})` : name;
    case 6:
      return `${name} (${value})`;
    case 7: {
      // Style 7 repeats the whole label once per point -- "Brawl O Brawl O
      // Brawl O" for a 3. It is used where the sheet has a row of boxes to fill
      // rather than a number to read.
      const word = specialized ? `${name} (${specialization})${DOT}` : `${name}${DOT}`;
      return word.repeat(Math.max(0, value));
    }
    case 8:
      return DOT.repeat(Math.max(0, value));
    case 9:
      return String(value);
    case 10:
      return specialization ?? '';
    default:
      return name;
  }
}

/** A run of text on the sheet, and whether it is an addition or a removal. */
export interface DiffPart {
  kind: 'plain' | 'removed' | 'added';
  text: string;
}

/**
 * Split a value into the parts the sheet paints.
 *
 * The legacy helpers build an HTML string here -- `"<span style='color:
 * indianred'><i class='fa fa-minus'></i>..."` -- and hand it to a template that
 * interpolates it raw. That is fine in an underscore template and wrong in
 * React, where it would mean dangerouslySetInnerHTML on every trait. Returning
 * the parts and letting the component render them produces the same DOM without
 * building markup out of strings.
 *
 * The old values are listed newest-first (the original reverses them), and the
 * current value is appended as the addition -- unless the trait was deleted in
 * this range, in which case there is no addition, only removals.
 */
export function diffParts(
  context: PrintContext,
  matcher: { name?: string; category: string },
  current: string,
  formatOld: (entry: TransformEntry) => string | undefined,
  deleted = false,
): DiffPart[] {
  const description = context.transformDescription;
  if (!description) return [{ kind: 'plain', text: current }];

  const matches = description.filter(
    (entry) =>
      entry.category === matcher.category &&
      (matcher.name === undefined || entry.name === matcher.name),
  );
  if (!matches.length) return [{ kind: 'plain', text: current }];

  const parts: DiffPart[] = [];
  for (const entry of [...matches].reverse()) {
    const text = formatOld(entry);
    if (text === undefined) continue;
    parts.push({ kind: 'removed', text });
  }
  if (!deleted) parts.push({ kind: 'added', text: current });
  return parts;
}

/** A free-text field on the sheet -- name, clan, sect. */
export function simpleTextParts(context: PrintContext, attribute: string): DiffPart[] {
  const current = String(context.character.get(attribute) ?? '');
  return diffParts(
    context,
    { name: attribute, category: 'core' },
    current,
    (entry) => (entry.old_text === undefined ? undefined : String(entry.old_text)),
  );
}

/** An attribute's numeric value. */
export function attributeValueParts(context: PrintContext, attribute: SimpleTrait): DiffPart[] {
  return diffParts(
    context,
    { name: attribute.name, category: 'attributes' },
    String(attribute.value),
    (entry) => (entry.fake ? String(entry.fake.value) : undefined),
  );
}

/** One trait, formatted in a style, with any changes marked. */
export function traitParts(
  context: PrintContext,
  trait: SimpleTrait,
  style: SkillStyle = 2,
): DiffPart[] {
  return diffParts(
    context,
    { name: trait.name, category: trait.category },
    formatTrait(trait, style),
    (entry) => (entry.fake ? formatTrait(entry.fake, style) : undefined),
    isDeleted(trait),
  );
}

/**
 * The names of every trait in a category, each with its own change marks.
 *
 * Used for the focus rows and the specialization lists, where the sheet prints
 * a run of names rather than a table. Note the legacy version marks a *removed*
 * trait by rendering the surviving trait's own name in red, not the removed
 * one's -- `.map(function (fake) { return "..." + skill.get("name") + "..." })`
 * uses `skill`, the outer variable, and ignores the `fake` it was handed.
 * Reproduced: changing it would alter what the approval screen shows.
 */
export function namesParts(context: PrintContext, category: string): DiffPart[][] {
  const traits = (context.character.get(category) as SimpleTrait[] | undefined) ?? [];
  return traits.map((trait) =>
    diffParts(
      context,
      { name: trait.name, category },
      trait.name,
      (entry) => (entry.fake ? trait.name : undefined),
      isDeleted(trait),
    ),
  );
}

/** The focus row for an attribute: "Physical" -> the focus_physicals names. */
export function focusParts(context: PrintContext, attributeName: string): DiffPart[][] {
  return namesParts(context, `focus_${attributeName.toLowerCase()}s`);
}
