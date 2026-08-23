import { Parse } from '@/parse/init';
import { Character, type VenueName } from '@/parse/models/Character';
import { SimpleTrait } from '@/parse/models/SimpleTrait';
import { characterAcl } from '@/parse/character/acl';
import { fetchRecordedChanges } from '@/parse/character/recordedChanges';
import {
  EXPERIENCE_NOTATION_CLASS,
  fetchExperienceNotations,
  recomputeRunningBalances,
} from '@/parse/character/experience';
import { venueByName } from '@/parse/venues';
import { loadCharacter, type Categories } from '@/parse/character/load';
import { createCharacter } from '@/parse/character/create';
import { updateTrait } from '@/parse/character/traits';
import {
  fetchAllCreationElements,
  isBeingCreated,
} from '@/parse/character/creation';
import { addExperienceNotation } from '@/parse/character/experience';
import { generation, hasGeneration, inClanDisciplines } from '@/parse/venues/vampire';
import { affinitiesOf } from '@/parse/venues/werewolf';
import { artsAffinities, hasSeeming, seeming } from '@/parse/venues/changeling';
import type { Venue } from '@/parse/venues/types';
import { parseCsv } from '@/csv/papa';

/**
 * The model surface the Playwright suite reaches into the page for.
 *
 * The suite does its fixture setup and its assertion read-back through the
 * app's own models rather than through the UI -- `createCharacter`,
 * `readTraits`, `readAffinities` and a dozen others in `e2e/helpers/`. On the
 * legacy front end that is `window.require(['app/models/Vampire'], ...)`. This
 * answers the same module names with the same method names, over the ported
 * modules, so the helpers work against either app without a fork.
 *
 * Why the legacy *names* rather than the React ones: the alternative is to
 * rewrite every call site in the suite, and the suite is the thing being used
 * to prove the port correct. A shim with a dozen methods in it is a much
 * smaller object to be wrong about than 24,000 lines of edited spec.
 *
 * The legacy methods are attached to the returned character rather than to the
 * `Character` class. Nothing in the app should be able to reach them, and a
 * prototype method would be reachable from anywhere.
 */

/** A character with the legacy instance methods the suite calls. */
type LegacyCharacter = Character & {
  all_text_attributes(): string[];
  all_simpletrait_categories(): [string, string, string][];
  get_sum_creation_categories(): string[];
  fetch_all_creation_elements(): Promise<void>;
  is_being_created(): boolean;
  get_in_clan_disciplines(): string[];
  generation(): number;
  has_generation(): boolean;
  get_affinities(): string[];
  get_arts_affinities(): string[];
  seeming(): number;
  has_seeming(): boolean;
  add_experience_notation(options: Record<string, unknown>): Promise<unknown>;
  get_me_acl(): Parse.ACL;
  get_experience_notations(): Promise<{ models: Parse.Object[] }>;
  _propagate_experience_notation_change(
    notations: { models: Parse.Object[] },
    index: number,
  ): void;
  get_recorded_changes(): Promise<Parse.Object[]>;
  recorded_changes: { models: Parse.Object[] };
  update_creation_rules_for_changed_trait(
    category: string,
    trait: SimpleTrait,
    freeValue: number,
  ): Promise<void>;
  update_trait(
    nameOrTrait: string | SimpleTrait,
    value?: number,
    category?: string,
    freeValue?: number,
    wait?: boolean,
    experienceCostType?: string,
    experienceCostModifier?: number,
  ): Promise<SimpleTrait>;
};

function decorate(character: Character, venue: Venue): LegacyCharacter {
  const decorated = character as LegacyCharacter;
  decorated.all_text_attributes = () => venue.data.textAttributes.map((t) => t.key);
  decorated.all_simpletrait_categories = () =>
    venue.data.categories.map((c) => [c.key, c.prettyName, c.group]);
  decorated.get_sum_creation_categories = () => venue.sumCreationCategories;
  decorated.fetch_all_creation_elements = () => fetchAllCreationElements(character, venue);
  decorated.is_being_created = () => isBeingCreated(character);
  decorated.get_in_clan_disciplines = () => inClanDisciplines(character);
  decorated.generation = () => generation(character);
  decorated.has_generation = () => hasGeneration(character);
  decorated.get_affinities = () => affinitiesOf(character);
  decorated.get_arts_affinities = () => artsAffinities(character);
  decorated.seeming = () => seeming(character);
  decorated.has_seeming = () => hasSeeming(character);
  decorated.add_experience_notation = (options) => addExperienceNotation(character, options);
  decorated.get_me_acl = () => characterAcl(character);
  // The ledger, newest first, wrapped in the `{ models }` shape the legacy's
  // Backbone collection had -- which is what the suite reads off it.
  decorated.get_experience_notations = async () => ({
    models: await fetchExperienceNotations(character),
  });
  decorated._propagate_experience_notation_change = (notations, index) => {
    recomputeRunningBalances(character, notations.models, index);
  };
  // `get_recorded_changes()` resolves, and leaves the rows on
  // `character.recorded_changes.models` -- a Backbone collection in the
  // original, and the shape the suite reads afterwards.
  decorated.recorded_changes = { models: [] };
  decorated.get_recorded_changes = async () => {
    const rows = await fetchRecordedChanges(character);
    decorated.recorded_changes = { models: rows };
    return rows;
  };
  decorated.update_creation_rules_for_changed_trait = (category, trait, freeValue) =>
    venue.updateCreationRulesForChangedTrait(character, category, trait, freeValue);
  // Positional, matching the legacy signature the suite calls it with. `wait`
  // is the fifth argument and is dropped: it told the legacy model to await its
  // own save queue, which `updateTrait` does unconditionally.
  decorated.update_trait = (
    nameOrTrait,
    value,
    category,
    freeValue,
    _wait,
    experienceCostType,
    experienceCostModifier,
  ) =>
    updateTrait(character, venue, {
      nameOrTrait,
      value,
      category: category ?? '',
      freeValue,
      experienceCostType,
      experienceCostModifier,
    });
  return decorated;
}

/**
 * One legacy venue module: a constructor with statics hung off it.
 *
 * `new Model()` has to work, because the suite builds a bare character that
 * never entered the wizard -- `#9`'s fixture is exactly "a model with no
 * creation record". A constructor may return an object and `new` will use it,
 * which is how a plain factory stands in for the legacy's `Parse.Object.extend`
 * subclass without giving `Character` a second identity.
 */
function venueModule(venueName: VenueName) {
  function Model(this: unknown) {
    return decorate(new Character(), venueByName(venueName));
  }

  async function create(name: string) {
    const character = await createCharacter(name, venueName);
    const { venue } = await loadCharacter(character.id!, []);
    return decorate(character, venue);
  }

  return Object.assign(Model, {
    create,
    async get_character(id: string, categories?: Categories) {
      const { character, venue } = await loadCharacter(id, categories);
      return decorate(character, venue);
    },
    /**
     * `create_test_character`, name and all.
     *
     * The random suffix is what keeps two runs from colliding, and the
     * "karmacharactertest" prefix is what several specs and the seeding script
     * recognise a throwaway character by, so both are reproduced exactly.
     */
    create_test_character(nameappend?: string) {
      const name =
        'karmacharactertest' + (nameappend ?? '') + Math.random().toString(36).slice(2);
      return create(name);
    },
  });
}

/**
 * The module names the suite asks for, and what answers each.
 *
 * `papaparse` is in here because the descriptions helper parses the CSV
 * textarea with the same parser the screen uses, so a disagreement between the
 * two would show up as a test that passes while the screen is broken.
 */
const MODULES: Record<string, unknown> = {
  'app/models/Vampire': venueModule('Vampire'),
  'app/models/Werewolf': venueModule('Werewolf'),
  'app/models/ChangelingBetaSlice': venueModule('ChangelingBetaSlice'),
  // The SDK itself, for the bodies that build their own queries.
  parse: Parse,
  'app/models/SimpleTrait': SimpleTrait,
  // The legacy declares a subclass; the port never needed one, because the
  // ledger is only ever read through `parse/character/experience.ts`. The
  // suite constructs rows directly, so it gets the registered class.
  'app/models/ExperienceNotation': Parse.Object.extend(EXPERIENCE_NOTATION_CLASS),
  papaparse: {
    parse(text: string) {
      const { fields, rows, errors } = parseCsv(text);
      return { data: rows, errors, meta: { fields } };
    },
  },
};

/**
 * `window.require(names, callback, errback)`, for the modules above only.
 *
 * Asynchronous, like the original: the suite's `runInApp` wraps the callback in
 * a promise and a synchronous callback would resolve it before the caller had
 * attached anything.
 */
export function requireModules(
  names: string[],
  callback: (...mods: unknown[]) => void,
  errback?: (error: Error) => void,
): void {
  const missing = names.filter((name) => !(name in MODULES));
  if (missing.length) {
    const error = new Error(`No E2E shim for module(s): ${missing.join(', ')}`);
    if (errback) errback(error);
    else throw error;
    return;
  }
  const mods = names.map((name) => MODULES[name]);
  setTimeout(() => callback(...mods), 0);
}
