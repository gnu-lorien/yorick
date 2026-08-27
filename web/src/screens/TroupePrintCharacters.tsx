import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import { Parse } from '@/parse/init';
import type { Character } from '@/parse/models/Character';
import { Troupe } from '@/parse/models/Troupe';
import { PrintSheet } from '@/print/PrintSheet';
import { PrintSettings } from './CharacterPrint';
import { SummarizeRoster, fetchSummarizable } from './CharactersSummarize';
import { registerScreen, type ScreenProps } from './registry';

/**
 * What the two print screens share, and why it is a module-level store.
 *
 * "Print Shown" on the selection screen navigates to
 * `#troupe/:id/characters/print/selected`, and the print screen then reads the
 * filtered set back off the *selection view* -- which works because the router
 * memoises both views for the life of the page:
 *
 *     if ("selected" == type && self.troupeSelectToPrintCharacters) {
 *         self.troupePrintCharacters.collection.reset(
 *             self.troupeSelectToPrintCharacters.get_filtered());
 *     }
 *
 * React unmounts the selection screen on that navigation, so the selection has
 * to outlive it somewhere. This is that somewhere, and it is deliberately as
 * dumb as the original: last write wins, cleared by nothing, and read only by
 * the `selected` branch. The guard is the same too -- with nothing stored, the
 * print screen falls back to fetching the whole troupe, exactly as the legacy
 * does when `troupeSelectToPrintCharacters` has never been built.
 */
let lastFilteredSelection: Character[] | null = null;

/** The print settings both troupe print screens share, as one model. */
interface TroupePrintOptions {
  fontSize: number;
  excludeExtended: boolean;
}

const DEFAULT_PRINT_OPTIONS: TroupePrintOptions = { fontSize: 100, excludeExtended: false };

/**
 * Choose which of a troupe's characters to print.
 *
 * Ports views/CharactersSelectToPrintView.js. It is the summarize roster with
 * two additions: the print settings form, and a "Print Shown" button that hands
 * the filtered set to the print screen.
 *
 * @compare #troupe/qvtD2RxzGG/characters/selecttoprint/all
 */
export function TroupeSelectToPrintCharacters({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  useBackButton(`#troupe/${id}`);

  const { show, hide } = useLoading();
  const [options, setOptions] = useState(DEFAULT_PRINT_OPTIONS);

  const { data, isFetching, error } = useQuery({
    queryKey: ['troupe-selecttoprint', id],
    enabled: !!id,
    queryFn: async () => {
      const troupe = await new Parse.Query(Troupe).include('portrait').get(id);
      return fetchSummarizable((query) => query.equalTo('troupes', troupe));
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  useEffect(() => {
    if (error) showError(error, "Couldn't list that troupe's characters");
  }, [error]);

  return (
    <SummarizeRoster
      pageId="troupe-select-to-print-characters-all"
      title="Troupe Characters"
      listId="troupe-select-to-print-characters-list"
      // This page declares no search box of its own, unlike the summarize one.
      filterId=""
      showFormat={false}
      characters={data ?? []}
      href={(cid) => `#troupe/${id}/character/${cid}`}
      onFilteredChange={(characters) => {
        lastFilteredSelection = characters;
      }}
      betweenSections={
        <>
          <div id="print-options">
            <PrintSettings
              fontSize={options.fontSize}
              onFontSize={(fontSize) => setOptions((o) => ({ ...o, fontSize }))}
              excludeExtended={options.excludeExtended}
              onExcludeExtended={(excludeExtended) =>
                setOptions((o) => ({ ...o, excludeExtended }))
              }
            />
          </div>
          {/* No jQM classes: the button is written into index.html as a bare
              `<button id="print-shown">`, and jQM's buttonMarkup gives it the
              full set when it enhances the page. */}
          <button
            id="print-shown"
            className="ui-btn ui-shadow ui-corner-all"
            onClick={() => navigate(`#troupe/${id}/characters/print/selected`)}
          >
            Print Shown
          </button>
        </>
      }
    />
  );
}

/**
 * Every chosen character's sheet, one after another, ready to print.
 *
 * Ports views/CharactersPrintView.js, which is a CollectionView whose child is
 * the whole character sheet -- built with `no_print_settings_form: true`, so
 * the per-sheet settings form is suppressed and the one on the selection screen
 * governs them all.
 *
 * `:type` of "selected" prints what the selection screen filtered; anything
 * else prints the whole troupe. The back button differs between the two for the
 * same reason.
 *
 * @compare #troupe/qvtD2RxzGG/characters/print/all
 */
export function TroupePrintCharacters({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  const type = route.named['type'];
  const selected = type === 'selected';

  useBackButton(selected ? `#troupe/${id}/characters/selecttoprint/all` : `#troupe/${id}`);

  const { show, hide } = useLoading();
  const options = DEFAULT_PRINT_OPTIONS;

  const { data, isFetching, error } = useQuery({
    queryKey: ['troupe-print', id, type],
    enabled: !!id,
    queryFn: async () => {
      if (selected && lastFilteredSelection) return lastFilteredSelection;
      const troupe = await new Parse.Query(Troupe).include('portrait').get(id);
      return fetchSummarizable((query) => query.equalTo('troupes', troupe));
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  useEffect(() => {
    if (error) showError(error, "Couldn't print that troupe's characters");
  }, [error]);

  return (
    <Page id="troupe-print-characters-all" title="Print Troupe Characters">
      {(data ?? []).map((character) => (
        <PrintSheet
          key={character.id}
          standalone={false}
          character={character}
          excludeExtended={options.excludeExtended}
        />
      ))}
    </Page>
  );
}

registerScreen('troupe_select_to_print_characters', TroupeSelectToPrintCharacters);
registerScreen('troupe_print_characters', TroupePrintCharacters);
