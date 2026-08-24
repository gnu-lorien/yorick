<script setup lang="ts">
/**
 * The administration menu -- static markup that lived in `index.html:135-153`.
 *
 * Its route handler was a bare `changePage` with no gate of any kind, which is
 * the gap the design note in `mobileRouter.js#enforce_admin` describes: this
 * page is the front door listing all thirteen destinations and it checked
 * nothing, while two of the destinations behind it did. Most of them are
 * protected server-side, so the effect was confusion rather than a breach --
 * but a page a non-admin cannot use should not render for them, and finding out
 * on submit is worse than being told up front. The route table now marks this
 * `gate: 'admin'` like everything it links to.
 *
 * The menu is an inset listview. It was a plain `<ul>` with no `data-role`, so
 * jQuery Mobile left it alone and the administration front door rendered as
 * bullet-point links while `#player-options`, one click away, was a listview of
 * full-width buttons. Fixed upstream in `index.html:137`; matched here.
 */
import { JqmPage, vJqmListview } from '@/components/jqm'

const DESTINATIONS = [
  { href: '#troupes', label: 'Troupes' },
  { href: '#administration/characters/all', label: 'Characters' },
  { href: '#administration/characters/summarize', label: 'Summarize Characters' },
  { href: '#administration/users/all', label: 'Users' },
  { href: '#administration/patronages', label: 'Patronages' },
  { href: '#administration/patronagescsv', label: 'Patronages CSV' },
  { href: '#administration/descriptions', label: 'Descriptions' },
  { href: '#administration/bnsctdbs_kith_rules', label: 'Kith Rules' },
  { href: '#administration/bnsmetv1_clan_rules', label: 'Clan Rules' },
  { href: '#administration/bnsmetv1_elder_discipline_rules', label: 'Elder Discipline Rules' },
  { href: '#administration/bnsmetv1_technique_rules', label: 'Technique Rules' },
  { href: '#administration/bnsmetv1_ritual_rules', label: 'Ritual Rules' },
  { href: '#administration/referendums', label: 'Referendums' },
]
</script>

<template>
  <JqmPage id="administration" title="Administration">
    <ul v-jqm-listview data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
      <li v-for="d in DESTINATIONS" :key="d.href">
        <a :href="d.href">{{ d.label }}</a>
      </li>
    </ul>
  </JqmPage>
</template>
