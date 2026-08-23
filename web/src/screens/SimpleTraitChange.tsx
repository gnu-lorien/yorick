import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { Slider, TextInput, Select } from '@/jqm/Controls';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { reportError, clearError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import type { Character } from '@/parse/models/Character';
import type { Venue } from '@/parse/venues/types';
import { SimpleTrait } from '@/parse/models/SimpleTrait';
import { loadCharacter } from '@/parse/character/load';
import { getTrait, updateTrait, removeTrait } from '@/parse/character/traits';
import { experienceAvailable } from '@/parse/character/experience';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Change one trait: its value, its specialization, and what it costs.
 *
 * Ports views/SimpleTraitChangeView.js and the `#simpleTraitChangeView` /
 * `#simpleTraitChangeChange` templates. Two routes render it:
 *
 *   simpletrait/:category/:cid/:bid              edit an existing trait
 *   simpletrait/spacer/:category/:cid/:name/:value/:free_value/new   add one
 *
 * The design worth understanding is the *working copy*. Every price quoted on
 * this page is computed from a throwaway SimpleTrait -- the legacy code calls it
 * the `fauxtrait` -- built from the real trait's attributes. Moving a slider
 * changes only the copy, so the quote updates without touching the row; saving
 * copies the values across and calls updateTrait.
 *
 * The legacy version rebuilt that copy only when the trait's object identity
 * changed, and the router hands back the same cached instance for the life of
 * the page -- so after the first visit it never rebuilt, and the copy kept the
 * values it held when the page was first opened. Measured: after raising
 * Physical 5 to 6 (quoted 3, charged 3), reopening the page and sliding to 7
 * quoted 6 -- the cost from 5 -- rather than the 3-point increment. The save was
 * correct; the player was shown the wrong price. React remounts per navigation,
 * so the copy is rebuilt from the trait every time and the class of bug is gone.
 *
 * @compare #simpletrait/backgrounds/9cYrGGv2w3/uOmy3vFpWt
 */
export function SimpleTraitChange({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';
  const bid = route.named['bid'];
  const isNew = route.entry.handler === 'simpletraitnew';

  useBackButton(`#simpletraits/${category}/${cid}/all`);

  const { show, hide } = useLoading();
  const { data, isFetching } = useQuery({
    // Its own key, not `['character', cid, category]`. That key belongs to the
    // category listing, whose value has no `trait` in it -- sharing it would
    // hand this screen the listing's cached shape and render nothing.
    queryKey: ['character-trait', cid, category, bid, isNew, route.fragment],
    enabled: !!cid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, [category]);
      const trait = isNew ? newTraitFromRoute(route, category) : await getTrait(loaded.character, category, bid ?? '');
      return { ...loaded, trait: trait ?? null };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  if (!data || !data.trait) return null;
  return (
    <Editor
      character={data.character}
      venue={data.venue}
      trait={data.trait}
      category={category}
      isNew={isNew}
    />
  );
}

/**
 * The trait being edited, in the SAME query as the character that owns it.
 *
 * It used to be a second query, and that is a trap worth naming. `updateTrait`
 * refuses a trait that is not in `character.get(category)` -- an identity check
 * the legacy inherits from Parse 1.5's single-instance cache, where there was
 * only ever one object per row. Single instance is off here, so the check holds
 * only while the trait came out of *this* character object. Two queries mean
 * two independent fetches: the character can be re-fetched into a new instance
 * while the trait query, whose key did not change, keeps handing back a trait
 * belonging to the old one. Saving then fails with "Provided trait not already
 * in Vampire as expected", which says nothing about the real cause.
 *
 * One query, one character, one trait out of it.
 */
function newTraitFromRoute(route: ScreenProps['route'], category: string): SimpleTrait {
  // Coerced, because SimpleTrait.validate rejects a non-finite `value` or
  // `free_value`. Parse 1.5 constructed silently and never validated; parse@8
  // throws, and the throw arrives as "Can't create an invalid Parse Object"
  // with no clue which field was wrong. A hand-typed or stale hash should land
  // on a page, not kill the route.
  return new SimpleTrait({
    name: decodeURIComponent(route.named['name'] ?? ''),
    value: Number.parseInt(route.named['value'] ?? '', 10) || 0,
    free_value: Number.parseInt(route.named['free_value'] ?? '', 10) || 0,
    category,
  });
}

function Editor({
  character,
  venue,
  trait,
  category,
  isNew,
}: {
  character: Character;
  venue: Venue;
  trait: SimpleTrait;
  category: string;
  isNew: boolean;
}) {
  // The working copy. Rebuilt from the trait whenever the trait changes, which
  // in React means whenever this screen mounts -- see the note on the component.
  const faux = useMemo(() => new SimpleTrait({ ...trait.attributes }), [trait]);

  const [value, setValue] = useState(faux.value);
  const [freeValue, setFreeValue] = useState(faux.freeValue);
  const [specialization, setSpecialization] = useState(faux.specialization() ?? '');
  const [costType, setCostType] = useState<string>((faux.get('experience_cost_type') as string) ?? 'automatic');
  const [costModifier, setCostModifier] = useState<number>(
    (faux.get('experience_cost_modifier') as number) ?? 1,
  );
  const [busy, setBusy] = useState(false);
  const { show, hide } = useLoading();

  // Keep the working copy in step with the controls, so the quote below is
  // computed from exactly what the player is looking at.
  faux.set('value', value);
  faux.set('free_value', freeValue);
  faux.setSpecialization(specialization || undefined);
  faux.set('experience_cost_type', costType === 'automatic' ? undefined : costType);
  faux.set('experience_cost_modifier', costModifier);

  const newCost = venue.costs.calculateTraitCost(character, faux);
  // What this change actually costs: the new price less what has already been
  // paid. `calculate_trait_to_spend` in the venue models.
  const spend = newCost === undefined ? undefined : newCost - trait.cost;
  const costKnown = spend !== undefined && Number.isFinite(spend);
  const available = experienceAvailable(character);
  const traitMax = venue.maxTraitValue(faux);

  const backToCategory = () => navigate(`#simpletraits/${category}/${character.id}/all`);

  async function onRemove() {
    setBusy(true);
    show();
    try {
      await removeTrait(character, venue, trait);
    } catch (error) {
      reportError(error, "Couldn't remove this trait");
    } finally {
      hide();
      // `.always()` in the original: the navigation happens whether the removal
      // succeeded or not, so a failure does not strand the player on a page
      // showing a trait that may or may not still exist.
      backToCategory();
    }
  }

  async function onSave() {
    setBusy(true);
    show();
    try {
      if (!isNew) {
        // Inline specialization edits change the name of the original trait, so
        // the real trait is updated in place rather than a new one created.
        trait.set({
          name: faux.name,
          value: faux.value,
          category: faux.category,
          free_value: faux.freeValue,
          experience_cost_type: faux.get('experience_cost_type'),
          experience_cost_modifier: faux.get('experience_cost_modifier'),
        });
        // freeValue 0, explicitly, and not omitted.
        // `updateCreationRulesForChangedTrait` composes its key from it, so
        // `undefined` wrote the right number to `<category>_undefined_remaining`
        // -- a key nothing reads -- and left the real `<category>_0_remaining`
        // stale, so the pool a player is shown never moved. 0 makes the sum
        // categories recompute against the right key, and every other category
        // early-returns on a falsy free value, which is correct: editing a trait
        // must not consume a second creation slot.
        await updateTrait(character, venue, { nameOrTrait: trait, category, freeValue: 0 });
      } else {
        await updateTrait(character, venue, {
          nameOrTrait: faux.name,
          value: faux.value,
          category: faux.category,
          freeValue: faux.freeValue,
          experienceCostType: faux.get('experience_cost_type') as string | undefined,
          experienceCostModifier: faux.get('experience_cost_modifier') as number | undefined,
        });
      }
      clearError();
      backToCategory();
    } catch (error) {
      // Stay on the page, drop the spinner, and say what went wrong. A refused
      // save used to report to trackJs and nothing else: the button simply
      // stopped responding.
      setBusy(false);
      hide();
      reportError(error, "Couldn't save this trait");
    }
  }

  return (
    <Page id="simpletrait-change" title="SimpleTraitChange">
      <div id="simpletrait-viewing">
        <p>
          {character.name} {faux.name} {faux.value}
        </p>
        {/* A category with no cost branch used to render a literal "Cost: NaN"
            and "Final: NaN". Whatever the engine cannot work out is said in
            words -- never arithmetic on a non-number. */}
        <p>Cost: {costKnown ? spend : 'unknown - no cost rule for this category'}</p>
        <p>Available XP: {available}</p>
        <p>Final: {costKnown ? available - spend! : 'unknown'}</p>
      </div>
      <div id="simpletrait-changing">
        <p>
          <Slider
            id="value-slider"
            name="simpleTraitValue"
            label="Slider:"
            className="value-slider"
            value={value}
            min={1}
            max={traitMax}
            onChange={setValue}
          />
        </p>
        <p>
          <button className="remove ui-btn" disabled={busy} onClick={() => void onRemove()}>
            Remove
          </button>
          <button className="save ui-btn" disabled={busy} onClick={() => void onSave()}>
            Save Changes
          </button>
        </p>
        {/*
          The template wraps all of this in one <p>, with an <h2> inside it.
          That is not what the browser builds: an <h2> may not appear inside a
          <p>, so the parser closes the paragraph before it and opens a fresh
          empty one after the block -- leaving `<p></p><h2>...</h2>...<p></p>`
          with the controls as SIBLINGS of both paragraphs.

          React does not go through the HTML parser. `createElement` plus
          `appendChild` nests exactly what it is told, so writing the template's
          own structure here would produce a <p> containing an <h2> -- markup
          the legacy app has never actually had. The parser's result is written
          out instead, empty paragraphs included, because that is the DOM the
          stylesheet is handed.
        */}
        <p />
        <h2>Advanced Options</h2>
        <TextInput
          id="specialize-name"
          name="specialize-name"
          label="Specialize Name"
          value={specialization}
          onChange={(e) => setSpecialization(e.target.value)}
        />
        <Slider
          id="free-slider"
          name="free-slider"
          label="Free Value:"
          className="free-slider"
          value={freeValue}
          min={0}
          max={traitMax}
          onChange={setFreeValue}
        />
        <Select
          id="experience-type-select"
          name="experience-type-select"
          label="Experience Cost Type Override"
          value={costType}
          onChange={(e) => {
            setCostType(e.target.value);
            // Selecting an override with no modifier set leaves the price
            // multiplied by NaN, so the legacy handler seeds it to 1.
            if (!Number.isFinite(costModifier)) setCostModifier(1);
          }}
        >
          <option value="automatic">Automatic</option>
          <option value="flat">Flat</option>
          <option value="linear">Linear</option>
        </Select>
        <Slider
          id="experience-cost-modifier"
          name="experience-cost-modifier"
          label="Experience Cost Modifier"
          className="cost-modifier-slider"
          value={costModifier}
          min={1}
          max={10}
          onChange={setCostModifier}
        />
        <p />
      </div>
    </Page>
  );
}

registerScreen('simpletrait', SimpleTraitChange);
registerScreen('simpletraitnew', SimpleTraitChange);
