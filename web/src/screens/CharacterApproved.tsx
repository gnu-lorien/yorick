import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { loadCharacter } from '@/parse/character/load';
import { fetchLongText } from '@/parse/character/longTexts';
import { transformedLastApproved } from '@/parse/character/approvals';
import { PrintSheet } from '@/print/PrintSheet';
import { PrintSettings } from './CharacterPrint';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The character as it stood at its most recent approval.
 *
 * Ports `character_show_approved` (mobileRouter.js:508). It is the only handler
 * that lands on one of two different pages depending on the data: with no
 * approvals at all it shows `#character-print-no-approval`, a single line of
 * text, and otherwise the ordinary printable sheet.
 *
 * `transformed.transform_description = []` before rendering, so the sheet is a
 * plain printout rather than a diff -- the same "show a state, not a change"
 * choice the history screen makes, and expressed the same way here by passing
 * no context.
 *
 * @compare #character/9cYrGGv2w3/approved
 */
export function CharacterApproved({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  useBackButton(`#character?${cid}`);

  const { show, hide } = useLoading();
  const [fontSize, setFontSize] = useState(100);
  const [excludeExtended, setExcludeExtended] = useState(false);

  const { data, error, isFetching } = useQuery({
    queryKey: ['character-approved', cid],
    enabled: !!cid,
    queryFn: async () => {
      const loaded = await loadCharacter(cid, 'all');
      await fetchLongText(loaded.character, 'extended_print_text');
      const approved = await transformedLastApproved(loaded.character);
      return { ...loaded, approved };
    },
  });

  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  useEffect(() => {
    if (error) showError(error, "Couldn't open the approved sheet");
  }, [error]);

  if (!data) return <Page id="character-print-no-approval" title="Print Approval" />;

  if (!data.approved) {
    return (
      <Page id="character-print-no-approval" title="Print Approval">
        <p>No approved versions of your character</p>
      </Page>
    );
  }

  return (
    <Page
      id="printable-sheet"
      title="Printable Sheet"
      contentClassName="force-printing-page-break"
      contentStyle={{ fontSize: `${fontSize}%` }}
    >
      <PrintSheet
        character={data.approved.character}
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

registerScreen('character_show_approved', CharacterApproved);
