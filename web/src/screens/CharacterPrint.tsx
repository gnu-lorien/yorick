import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { loadCharacter } from '@/parse/character/load';
import { fetchLongText } from '@/parse/character/longTexts';
import { PrintSheet } from '@/print/PrintSheet';
import { Form, SelectField, CheckboxField } from '@/forms/Backform';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The printable character sheet.
 *
 * Ports the `characterprint` handler (mobileRouter.js:545) and the
 * `#printable-sheet` page. The sheet itself is web/src/print/PrintSheet.tsx;
 * this is the screen that loads a character for it.
 *
 * `get_character(cid, "all")` -- every trait category, because the sheet prints
 * all of them -- followed by a separate fetch of the extended print text, which
 * is a LongText row rather than a field.
 *
 * The handler also sets `character.transform_description = []` before rendering.
 * That is what puts the sheet in "plain printout" mode: with no description the
 * formatters take their no-diff path and nothing is marked red or green. Here
 * that is expressed by simply not passing a context.
 *
 * @compare #character/9cYrGGv2w3/print
 */
export function CharacterPrint({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  useBackButton(`#character?${cid}`);

  const { show, hide } = useLoading();
  const [fontSize, setFontSize] = useState(100);
  const [excludeExtended, setExcludeExtended] = useState(false);

  const { data, error, isFetching } = useQuery({
    queryKey: ['character-print', cid],
    enabled: !!cid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, 'all');
      await fetchLongText(loaded.character, 'extended_print_text');
      return loaded;
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  useEffect(() => {
    if (error) showError(error, "Couldn't open that character sheet");
  }, [error]);

  if (!data) return <Page id="printable-sheet" title="Printable Sheet" />;

  return (
    // `force-printing-page-break` and the font size both belong on the page's
    // own content div. The legacy layout view's template opens with
    // `<div role="main" class="ui-content force-printing-page-break">` and
    // Marionette renders it in place of the page's content div rather than
    // inside it, so the printed page has exactly one `role="main"`; and
    // `match_font_size` sets the size on that same element.
    <Page
      id="printable-sheet"
      title="Printable Sheet"
      contentClassName="force-printing-page-break"
      contentStyle={{ fontSize: `${fontSize}%` }}
    >
      <PrintSheet
        character={data.character}
        excludeExtended={excludeExtended}
        settings={
          <PrintSettings
            fontSize={fontSize}
            onFontSize={setFontSize}
            excludeExtended={excludeExtended}
            onExcludeExtended={setExcludeExtended}
          />
        }
      />
    </Page>
  );
}

/** Font-size and extended-text controls. Ports forms/PrintSettingsForm.js. */
export function PrintSettings({
  fontSize,
  onFontSize,
  excludeExtended,
  onExcludeExtended,
}: {
  fontSize: number;
  onFontSize: (value: number) => void;
  excludeExtended: boolean;
  onExcludeExtended: (value: boolean) => void;
}) {
  return (
    <Form>
      <SelectField
        name="font_size"
        label="Font Size"
        value={String(fontSize)}
        onChange={(value) => onFontSize(Number.parseInt(value, 10))}
        options={FONT_SIZES.map((size) => ({ label: `${size}%`, value: String(size) }))}
      />
      <CheckboxField
        name="exclude_extended"
        label="Exclude Extended Print Text"
        checked={excludeExtended}
        onChange={onExcludeExtended}
      />
    </Form>
  );
}

const FONT_SIZES = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

registerScreen('characterprint', CharacterPrint);
