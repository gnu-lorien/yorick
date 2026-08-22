import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { reportError, clearError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import { Parse } from '@/parse/init';
import { Description } from '@/parse/models/Description';
import { SimpleTrait } from '@/parse/models/SimpleTrait';
import { loadCharacter } from '@/parse/character/load';
import { getTrait, updateTrait } from '@/parse/character/traits';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Name a trait's specialization -- the "Kindred" in "Lore: Kindred".
 *
 * Ports views/SimpleTraitSpecializationView.js, its
 * `#simpleTraitSpecialization` template, and the two handlers that render it:
 * `simpletraitspecialize` for an existing trait and
 * `charactercreatespecializesimpletrait` for one being picked during creation.
 *
 * The help text above the field comes from the Description row whose name
 * *starts with* the trait's base name -- `startsWith("name",
 * simpletrait.get_base_name())` -- so "Lore: Kindred" finds the row for "Lore".
 * Only the first match is used.
 *
 * @compare #simpletrait/specialize/backgrounds/9cYrGGv2w3/uOmy3vFpWt
 */
export function SimpleTraitSpecialization({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';
  const bid = route.named['bid'] ?? route.named['stid'] ?? '';
  const backToCategory = `#simpletraits/${category}/${cid}/all`;

  useBackButton(backToCategory);

  const { show, hide } = useLoading();

  const { data, isFetching } = useQuery({
    queryKey: ['specialize', cid, category, bid],
    enabled: !!cid && !!bid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, [category]);
      const trait = await getTrait(loaded.character, category, bid);
      if (!trait) return { ...loaded, trait: null, description: null };
      const description = await new Parse.Query(Description)
        .equalTo('category', category)
        .startsWith('name', trait.baseName())
        .first();
      return { ...loaded, trait, description: description ?? null };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  if (!data?.trait) return null;
  return (
    <Editor
      trait={data.trait}
      description={data.description}
      character={data.character}
      venue={data.venue}
      category={category}
      redirect={backToCategory}
    />
  );
}

function Editor({
  trait,
  description,
  character,
  venue,
  redirect,
}: {
  trait: SimpleTrait;
  description: Description | null;
  character: Parameters<typeof updateTrait>[0];
  venue: Parameters<typeof updateTrait>[1];
  category: string;
  redirect: string;
}) {
  const [specialization, setSpecialization] = useState(trait.specialization() ?? '');
  const [busy, setBusy] = useState(false);
  const { show, hide } = useLoading();

  async function onSave() {
    setBusy(true);
    show();
    trait.setSpecialization(specialization);
    try {
      await updateTrait(character, venue, { nameOrTrait: trait, category: trait.category });
      clearError();
      navigate(redirect);
    } catch (error) {
      // A colliding name is genuinely rejected -- the name never persists -- but
      // until now the only trace was a console.log, which no player ever sees.
      // Reported before the redirect; the banner follows it.
      hide();
      setBusy(false);
      try {
        reportError(error, "Couldn't rename this trait");
      } catch {
        /* the banner is the point here, not the rethrow */
      }
      navigate(redirect);
    }
  }

  return (
    <Page id="simpletrait-specialization" title="Simple Trait Specialization">
      {/* `description.attributes.help_specialization` in the template, which on
          a missing row is a property read on `undefined` -- so a trait whose
          category has no Description throws while rendering. React would show a
          blank page instead of a broken one, so the guard is here; the visible
          result for a row that exists is identical. */}
      <p>{description ? String(description.get('help_specialization') ?? '') : ''}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void onSave();
        }}
      >
        <label htmlFor="specialization">Specialization for {trait.baseName()}:</label>
        <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input
            type="text"
            name="specialization"
            id="specialization"
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
          />
        </div>
      </form>
      <p>
        <button className="cancel ui-btn" disabled={busy} onClick={() => navigate(redirect)}>
          Cancel
        </button>
        <button className="save ui-btn" disabled={busy} onClick={() => void onSave()}>
          Save Changes
        </button>
      </p>
    </Page>
  );
}

/**
 * Name the specialization of a trait that does not exist yet.
 *
 * Ports views/SimpleTraitNewSpecializationView.js and the
 * `simpletrait_new_specialize` handler. Same page and same template as the
 * screen above, and a different job: there is no row to update, so nothing is
 * saved here. Saving sets the specialization on the in-memory trait and hands
 * it to the add-trait screen through the URL --
 *
 *   #simpletrait/spacer/:category/:cid/:name/:value/:free_value/new
 *
 * -- with `name` now carrying the "Base: Specialization" form. The trait is
 * created there, once, rather than created here and edited there.
 *
 * @compare #simpletrait/specialize/backgrounds/9cYrGGv2w3/Resources/2/0/new
 */
export function SimpleTraitNewSpecialization({ route }: ScreenProps) {
  const category = route.named['category'] ?? '';
  const cid = route.named['cid'] ?? '';
  const backToCategory = `#simpletraits/${category}/${cid}/all`;

  useBackButton(backToCategory);

  // Built from the URL, and coerced for the same reason `simpletraitnew` does
  // it: SimpleTrait.validate rejects a non-finite value, and under parse@8 that
  // throws "Can't create an invalid Parse Object" with no clue which field was
  // wrong. A hand-typed hash should land on a page, not kill the route.
  const trait = useMemo(() => {
    const t = new SimpleTrait({
      name: decodeURIComponent(route.named['name'] ?? ''),
      value: Number.parseInt(route.named['value'] ?? '', 10) || 0,
      free_value: Number.parseInt(route.named['free_value'] ?? '', 10) || 0,
    });
    // No `category` on it: the legacy constructor omits it here too, and the
    // add-trait screen supplies one from its own route.
    return t;
  }, [route.named]);

  const { data } = useQuery({
    queryKey: ['new-specialize-description', category, trait.baseName()],
    queryFn: async () =>
      (await new Parse.Query(Description)
        .equalTo('category', category)
        .startsWith('name', trait.baseName())
        .first()) ?? null,
  });

  const [specialization, setSpecialization] = useState(trait.specialization() ?? '');

  function onSave() {
    trait.setSpecialization(specialization);
    navigate(
      `#simpletrait/spacer/${category}/${cid}/${trait.name}/${trait.value}/${trait.freeValue}/new`,
    );
  }

  return (
    <Page id="simpletrait-new-specialization" title="Simple Trait Specialization">
      <p>{data ? String(data.get('help_specialization') ?? '') : ''}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <label htmlFor="specialization">Specialization for {trait.baseName()}:</label>
        <div className="ui-input-text ui-body-inherit ui-corner-all ui-shadow-inset">
          <input
            type="text"
            name="specialization"
            id="specialization"
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
          />
        </div>
      </form>
      <p>
        <button className="cancel ui-btn" onClick={() => navigate(backToCategory)}>
          Cancel
        </button>
        <button className="save ui-btn" onClick={onSave}>
          Save Changes
        </button>
      </p>
    </Page>
  );
}

registerScreen('simpletraitspecialize', SimpleTraitSpecialization);
registerScreen('charactercreatespecializesimpletrait', SimpleTraitSpecialization);
registerScreen('simpletrait_new_specialize', SimpleTraitNewSpecialization);
