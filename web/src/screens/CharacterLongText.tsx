import { useCallback, useEffect, useState } from 'react';
import template from 'lodash/template';
import { Page } from '@/jqm/Page';
import { cx } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { TextareaField, ButtonField } from '@/forms/Backform';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import { setTroupeIds } from '@/parse/character/acl';
import { fetchLongText, getFetchedLongText, updateLongText } from '@/parse/character/longTexts';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Editing one of a character's three long texts, with a live preview.
 *
 * Ports views/CharacterLongTextView.js and
 * templates/character-long-text-parent.html, inside the bare `#long-text` and
 * `#extended-print-text` pages from public/index.html.
 *
 * One view serves three handlers and two pages. The only things that differ are
 * the category, the field's label, the blurb above the form, and which page id
 * the text is edited on -- `character_extended_print_text` gets its own page,
 * while background and notes share `#long-text` (mobileRouter.js:781-847).
 *
 * The legacy layout has three Marionette regions and this keeps all three, ids
 * included: `#top` is the blurb, `#edit` is the Backform form, `#preview` is
 * the rendered text. e2e/long-texts.spec.js selects inside them
 * (`.form-group.text label.control-label`, `textarea[name="text"]`,
 * `button[name="submit"]`, `.status`), so the shape is a contract.
 *
 * The long text is run through an Underscore template with the character in
 * scope -- `_.template(inputtext)({character: character})` -- so a player can
 * write `<%= character.get("name") %>` into their background and have it
 * resolve. That is a feature of the original, not an accident, and it means the
 * preview both executes and injects whatever the field holds. See
 * `renderTemplate` below.
 *
 * @compare #character/9cYrGGv2w3/backgroundlt
 * @compare #character/9cYrGGv2w3/noteslt
 * @compare #character/9cYrGGv2w3/extendedprinttext
 */

/** What each of the three handlers passes to the view, verbatim. */
interface LongTextConfig {
  pageId: string;
  title: string;
  category: string;
  /** The textarea's label. `pretty` in the handler's options. */
  pretty: string;
  /**
   * The blurb above the form, rendered by the `Description` child view.
   *
   * It reaches `#top` only. `EditForm` declares the textarea with
   * `helpMessage: options.description`, but `setup_regions` builds that view
   * with `{character, category, pretty, model}` and no `description`
   * (CharacterLongTextView.js:160-172) -- so the help message is always
   * undefined, Backform's TextareaControl skips the `<span class="help-block">`
   * it would have gone in, and the intended second copy has never appeared.
   * Reproduced: passing it here would add an element the legacy DOM does not
   * have.
   */
  description: string;
}

const CONFIGS: Record<string, LongTextConfig> = {
  character_extended_print_text: {
    pageId: 'extended-print-text',
    title: 'Additional Printed Text',
    category: 'extended_print_text',
    pretty: 'Extended Print Text',
    description: 'Additional text to display with your printed character sheet.',
  },
  character_background_long_text: {
    pageId: 'long-text',
    title: 'Long Text',
    category: 'background',
    pretty: 'Background',
    description: 'History and backstory for your character.',
  },
  character_notes_long_text: {
    pageId: 'long-text',
    title: 'Long Text',
    category: 'notes',
    pretty: 'Notes',
    description: "Notes about your character's interactions and progression",
  },
};

export function CharacterLongTextScreen({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  const config = CONFIGS[route.entry.handler] ?? CONFIGS['character_background_long_text']!;
  const { category, pretty, description } = config;
  const { track } = useLoading();

  const [character, setCharacter] = useState<Character | null>(null);
  const [text, setText] = useState('');
  const [live, setLive] = useState(true);
  /** The preview's rendered HTML. Recomputed only when the original re-renders
   *  the Preview view; see `renderPreview`. */
  const [previewHtml, setPreviewHtml] = useState('');
  /** Backform's submit control starts `disabled: true` and is enabled by the
   *  form's own `change` handler. `dirty` is that flag. */
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // All three handlers call set_back_button before they fetch anything, so Back
  // works while the character is still loading.
  useBackButton(`#character?${cid}`);

  /**
   * Recompute the preview, the way `Preview.templateHelpers` does.
   *
   * With live preview on it shows what is in the textarea; with it off it shows
   * the *saved* text, read back out of the character's long-text cache. Both
   * are then run through the template.
   */
  const renderPreview = useCallback(
    (subject: Character, showTyped: boolean, typed: string) => {
      const source = showTyped
        ? typed
        : ((getFetchedLongText(subject, category)?.get('text') as string | undefined) ?? '');
      try {
        setPreviewHtml(renderTemplate(source, subject));
      } catch (error) {
        // A text containing a malformed `<%` makes the template compiler throw.
        // The original lets that escape: on the first render it surfaces through
        // the handler's `.fail(PromiseFailReport)`, and on a later one it is an
        // uncaught exception in a Backbone event handler. Neither is available
        // here -- a throw out of a React event handler unmounts the tree -- so
        // it is reported and the previous preview stands.
        showError(error, "Couldn't render the preview");
      }
    },
    [category],
  );

  // Ports the body of all three handlers, plus `LayoutView.setup`. State is
  // reset up front because this component is reused across routes: navigating
  // #...backgroundlt -> #...noteslt renders the same component with a different
  // category and React keeps the old state otherwise.
  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    setCharacter(null);
    setText('');
    setLive(true);
    setPreviewHtml('');
    setDirty(false);
    setStatus(null);

    void (async () => {
      try {
        // The handlers call `get_character(cid, "all")`, which also fetches
        // every trait category, injects the creation rules and initialises the
        // vampire costs. None of that is read on this screen, so only the row
        // itself is fetched.
        //
        // NO include("owner"), and that is load-bearing rather than an
        // omission. Including it made parse-server DELETE the pointer for a
        // private owner, and `characterAcl` reads a missing owner as "no owner"
        // and grants the CURRENT user read and write instead -- so opening
        // someone else's sheet would rewrite the ACL of every long text saved
        // from it to the viewer. Without the include the bare pointer survives
        // and the ACL takes its correct branch. models/Vampire.js:317-332.
        const loaded = await track(new Parse.Query(Character).get(cid));
        if (cancelled) return;

        // `get_character` finishes with `initialize_troupe_membership`, and the
        // ACL stamped on a saved long text needs its result: without the troupe
        // ids, `characterAcl` grants the owner and administrators and drops the
        // troupe's storytellers. web/src/parse/models/Character.ts has no
        // `initializeTroupeMembership` yet and it is shared, so the relation
        // walk is done here through acl.ts's `setTroupeIds` seam. Reported for
        // a central port.
        const troupeIds: string[] = [];
        await loaded
          .relation('troupes')
          .query()
          .each((troupe) => {
            // `id` is optional on the Parse type because an unsaved object has
            // none; everything a query returns has one.
            if (troupe.id) troupeIds.push(troupe.id);
          });
        if (cancelled) return;
        setTroupeIds(loaded, troupeIds);

        // `character.transform_description = []` is set by all three handlers
        // before setup. Nothing in CharacterLongTextView reads it; it belongs to
        // the transformed-character rendering the sheet does. Not ported.
        await track(fetchLongText(loaded, category));
        if (cancelled) return;

        // LayoutView.setup: seed the editor from the cached text if there is
        // one. `lt && lt.has("text")` -- a row with no `text` key leaves the
        // field empty rather than writing "undefined" into it.
        const existing = getFetchedLongText(loaded, category);
        const initial = (existing?.get('text') as string | undefined) ?? '';
        setCharacter(loaded);
        setText(initial);
        renderPreview(loaded, true, initial);
      } catch (error) {
        if (cancelled) return;
        // `.fail(PromiseFailReport)` and nothing else: the original reports and
        // stays put, because the `changePage` that would have shown this screen
        // never runs. Here the page is already on screen, so it stays with an
        // empty form and the banner above it.
        showError(error, "Couldn't load the long text");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cid, category, track, renderPreview]);

  /**
   * The form's delegated `change` handler: clear the last result and enable
   * Update.
   *
   * One timing difference, and it is forced. Backform binds `change textarea`,
   * the native event, which fires on blur -- so in the legacy app the model,
   * the preview and the button all update when the field is left. React's
   * `onChange` is the input event, so all three happen as you type. Restoring
   * the original timing needs an `onBlur` on `forms/Backform`'s `TextareaField`,
   * which is shared. Reported rather than changed.
   *
   * `busy` stands in for `undelegateEvents()`, which the submit handler calls to
   * stop the form reacting to anything while a save is in flight.
   */
  function onFormChange() {
    if (busy) return;
    setStatus(null);
    setDirty(true);
  }

  function onTextChange(value: string) {
    setText(value);
    onFormChange();
    // `Preview.renderIfLive`: bound to the model's `change:text`, and it returns
    // without rendering unless live preview is on.
    if (live && character) renderPreview(character, true, value);
  }

  function onLiveChange(checked: boolean) {
    setLive(checked);
    onFormChange();
    // Deliberately no re-render. `Preview` listens to `change:text` and to the
    // character's `change:longtext<category>` -- not to `change:preview` -- so
    // in the legacy app ticking this box changes nothing until the next
    // keystroke or the next save. Reproduced: React would otherwise re-render
    // here and quietly "fix" a behaviour a reviewer could not attribute.
  }

  async function onSubmit() {
    if (!character || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await track(updateLongText(character, category, text));
      setStatus({ kind: 'success', message: 'Successfully Updated' });
      setDirty(false);
      // update_long_text ends with `trigger("change:longtext" + category)`,
      // which is what re-renders Preview -- with the *current* live-preview
      // setting, not necessarily from the textarea.
      renderPreview(character, live, text);
    } catch (error) {
      // `{status: "error", message: _.escape(error.message), disabled: false}`:
      // the failure is shown beside the button and Update stays clickable so it
      // can be tried again. React escapes the message for us.
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      setDirty(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id={config.pageId} title={config.title}>
      {/* The three Marionette regions from character-long-text-parent.html.
          Each region's contents are the child view's own element, which is why
          `#top` and `#preview` each hold a bare `<div>` that looks like a
          wrapper doing nothing: it is `Description`'s and `Preview`'s
          `tagName: 'div'`. */}
      <div id="top">
        <div>
          <p>{description}</p>
        </div>
      </div>
      <div id="edit">
        {/* No `profile-form` class. Backbone applies a view's `className` only
            when it creates the element, and Backform is handed the `<form>`
            that EditForm's `tagName` already made -- so the legacy form element
            carries no class at all. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          {/* No `helpMessage`: the one the field asks for never arrives. See
              LongTextConfig.description. */}
          <TextareaField name="text" label={pretty} value={text} onChange={onTextChange} />
          <CheckboxGroup
            name="preview"
            label="Live Preview Changes"
            checked={live}
            onChange={onLiveChange}
          />
          {/* The field is declared with `id: "submit"`, but Backform's
              ButtonControl template never writes it out -- the rendered button
              has no id, which is why e2e/long-texts.spec.js selects it as
              `button[name="submit"]`. Passing one here would put an id in the
              legacy DOM's blank. */}
          <ButtonField
            name="submit"
            label="Update"
            disabled={!dirty || busy}
            status={status?.kind}
            message={status?.message}
          />
        </form>
      </div>
      <div id="preview">
        {/*
          Set as one string, not as `<h1>` and `<p>` elements with the text
          inside the `<p>`, because `Preview`'s template is
          `"<h1>Preview</h1><p><%= inputtext %></p>"` and the browser parses all
          of it at once: block-level markup in a player's text closes the `<p>`
          and becomes its sibling. Building the `<p>` in JSX and filling it
          instead would nest that markup inside it, which is a different tree.

          `<%= %>`, not `<%- %>`: the text is injected as HTML on purpose -- it
          is how a player gets a heading or a list into their background. It is
          also, with the template compiler above, an execution path for whoever
          can write the field. That is the legacy behaviour and the migration is
          not the place to change it; the row is readable and writable only by
          the character's owner, administrators and its troupe's storytellers.
        */}
        <div dangerouslySetInnerHTML={{ __html: `<h1>Preview</h1><p>${previewHtml}</p>` }} />
      </div>
    </Page>
  );
}

/**
 * The long text, compiled as an Underscore template with the character in scope.
 *
 * lodash's `template` rather than Underscore's: the delimiters and semantics
 * are the same and the React app does not vendor Underscore. Compiled fresh on
 * every render, as the original does -- the text being previewed is the thing
 * that changes.
 */
function renderTemplate(source: string, character: Character): string {
  return template(source)({ character });
}

/**
 * Backform's checkbox group with jQuery Mobile's enhancement applied.
 *
 * `forms/Backform`'s `CheckboxField` emits Backform's *pre-enhancement* markup,
 * `div.checkbox > label > input`, but `EditForm.onRender` calls
 * `enhanceWithin()` immediately, which rewrites it to
 * `div.checkbox > div.ui-checkbox > (label.ui-btn…, input)`. Composed locally
 * for the same reason Profile.tsx composes its own: both `forms/Backform` and
 * `jqm/Controls` are shared and being edited by other screens. Reported for a
 * central fix -- this is now the second copy.
 */
function CheckboxGroup({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={cx('form-group', name)}>
      {/* Backform writes &nbsp; into a boolean field's label column: the text
          belongs beside the box, and the four grid columns still have to be
          reserved or the control slides left. */}
      <label className="control-label col-sm-4">{' '}</label>
      <div className="col-sm-8">
        <div className="checkbox">
          <div className="ui-checkbox">
            {/* The label is the visible control -- the stylesheet positions the
                real input off it -- so its click handler is the whole of the
                widget's behaviour. */}
            <label
              className={cx(
                'ui-btn ui-corner-all ui-btn-inherit ui-btn-icon-left',
                checked ? 'ui-checkbox-on' : 'ui-checkbox-off',
              )}
              onClick={() => onChange(!checked)}
            >
              {label}
            </label>
            <input
              type="checkbox"
              name={name}
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

registerScreen('character_extended_print_text', CharacterLongTextScreen);
registerScreen('character_background_long_text', CharacterLongTextScreen);
registerScreen('character_notes_long_text', CharacterLongTextScreen);
