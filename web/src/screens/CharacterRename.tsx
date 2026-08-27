import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { InputField, ButtonField } from '@/forms/Backform';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Rename a character.
 *
 * Ports the `characterrename` handler (mobileRouter.js:531),
 * views/CharacterRenameView.js and the `#character-rename` block in
 * public/index.html.
 *
 * The whole screen is two Backform fields over one attribute. There is no
 * validation of any kind: the submit handler is `character.set("name", ...)`
 * followed by `character.save()`, and nothing anywhere checks the new name
 * against the names already in use. Character names are not unique in this
 * app and renaming one character into another's exact name succeeds --
 * measured, and recorded as e2e/assets-rename-portrait.spec.js's test 114.
 *
 * The rename *is* logged, server-side: `beforeSave("Vampire")`'s
 * `tracked_texts` allowlist (cloud/main.js:153) includes "name", so one
 * `VampireChange` row with `type: "core_update"` and the two names falls out of
 * the plain save. Nothing here has to write it.
 *
 * The handler loads the character with `get_character(cid, "all")`, which
 * fetches every trait category the sheet knows about. This form reads and
 * writes exactly one attribute, so the categories are not fetched here; the
 * save sends only the dirty key either way.
 *
 * @compare #character/9cYrGGv2w3/rename
 */
export function CharacterRename({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  // mobileRouter.js:534, before the fetch -- Back works while the character is
  // still loading.
  useBackButton(`#character?${cid}`);

  const { track, show, hide } = useLoading();
  const [name, setName] = useState('');
  // Backform's submit field is declared `disabled: true`, and the form's
  // delegated `"change"` handler is what re-enables it, so "Update" is only
  // ever clickable when there is something to update.
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const {
    data: character,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['character', cid, 'rename'],
    enabled: !!cid,
    queryFn: () => new Parse.Query(Character).get(cid),
  });

  // `register()` sets the form model's `name` from the character. It does not
  // touch the submit field, which is why the E2E helper hard-reloads before
  // each rename: within one page session the memoized view can open still
  // showing "Successfully Updated" from a previous visit. React mounts this
  // component fresh per navigation, so that staleness cannot happen here --
  // and the fresh mount is the same fix the helper applies by hand.
  useEffect(() => {
    if (character) setName(character.name);
  }, [character]);

  // The handler brackets the route in $.mobile.loading("show") / ("hide"), the
  // hide in an `.always()` so a character that fails to load does not strand
  // the spinner.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // The legacy chain ends in `.fail(PromiseFailReport)`: it logs and never
  // transitions, so a character that cannot be loaded leaves you on whatever
  // page you were already on. React has already navigated by the time the
  // fetch fails, so saying so is the one deliberate addition here.
  useEffect(() => {
    if (error) showError(error, "Couldn't load the character");
  }, [error]);

  function edit(value: string) {
    setName(value);
    setDirty(true);
    // The same `"change"` handler clears a previous "Successfully Updated" --
    // it resets status, message and disabled whenever the status was "success"
    // or was never set. An error message is deliberately left standing; the
    // error branch already left the button enabled.
    setStatus((previous) => (previous?.kind === 'success' ? null : previous));
  }

  async function onSubmit() {
    if (!character || busy) return;
    setBusy(true);
    character.set('name', name);
    try {
      await track(character.save());
      setStatus({ kind: 'success', message: 'Successfully Updated' });
      // `disabled: true` on success, so the button goes back to being
      // unclickable until the field changes again.
      setDirty(false);
    } catch (err) {
      // The view writes `_.escape(error.message)` because Backform's
      // ButtonControl interpolates the message unescaped. React escapes text
      // children, so the raw message is the equivalent, not a weakening.
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      setDirty(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id="character-rename" title="Rename Character">
      {/* No `profile-form` class: the view is a Marionette ItemView with
          `tagName: 'form'` and no `className`, and it is bound to the
          `<form id="character-rename-main">` that already exists in
          index.html. Same reasoning as TroupeNew and Profile. */}
      <form
        id="character-rename-main"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <InputField name="name" label="Character Name" value={name} onChange={edit} />
        {/* `id: "submit"` is on the field too, but Backform's ButtonControl
            template does not emit an id, so the rendered button carries none.
            The E2E suite finds it as `button[name="submit"]` and reads the
            outcome from the sibling `span.status`. */}
        <ButtonField
          name="submit"
          label="Update"
          disabled={!dirty || busy}
          status={status?.kind}
          message={status?.message}
        />
      </form>
    </Page>
  );
}

registerScreen('characterrename', CharacterRename);
