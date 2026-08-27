import { useState } from 'react';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { reportError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import { Form, InputField, SelectField, ButtonField } from '@/forms/Backform';
import type { VenueName } from '@/parse/models/Character';
import { createCharacter, VENUE_CHOICES } from '@/parse/character/create';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The new-character form: a name, a venue, and a button.
 *
 * Ports views/CharacterNewView.js and the `characternew` handler. The creation
 * itself is `parse/character/create.ts`, which is where the starting traits and
 * their order live.
 *
 * The route gained an `enforce_logged_in()` during the security remediation --
 * it had none, so the form rendered in full for an anonymous visitor, and the
 * anonymous-*write* hole behind it was closed at the class permissions and in
 * `require_a_user`. The guard is App.tsx's here, since `characternew` is not in
 * the public-handler list.
 *
 * @compare #characternew
 */
export function CharacterNew(_: ScreenProps) {
  useBackButton('#characters?all');

  const { track } = useLoading();
  const [name, setName] = useState('');
  const [venue, setVenue] = useState<VenueName>('Vampire');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    // `validate` clears the error model and refuses an empty name. It is the
    // only validation the form does.
    setNameError(null);
    if (!name.trim()) {
      setNameError('Name cannot be empty.');
      return;
    }

    setBusy(true);
    try {
      const character = await track(createCharacter(name, venue));
      navigate(`#character?${character.id}`);
    } catch (error) {
      setBusy(false);
      reportError(error, "Couldn't create that character");
    }
  }

  return (
    <Page id="character-new" title="New Character">
      {/* `<form id="character-new-form">` is written into index.html and the
          view renders its fields into it, so the id is on the element rather
          than added by the form component. */}
      <Form id="character-new-form" onSubmit={onSubmit}>
        <InputField
          name="name"
          label="Character Name"
          value={name}
          onChange={setName}
          helpMessage={nameError ?? undefined}
        />
        <SelectField
          name="type"
          label="Venue"
          value={venue}
          onChange={(value) => setVenue(value as VenueName)}
          options={VENUE_CHOICES.map((choice) => ({ label: choice.label, value: choice.value }))}
        />
        {/* No `name`: the legacy field config is `{control: "Button", label:
            "Create New Character"}` with none, so its group carries only
            `form-group`. */}
        <ButtonField label="Create New Character" disabled={busy} />
      </Form>
    </Page>
  );
}

registerScreen('characternew', CharacterNew);
