<script>
import Parse from 'parse/dist/parse.js'

export default {
  name: 'Playeroptions',
}

function hasAdminInterface() {
  return Parse.User.current().get('admininterface')
}
</script>

<template>
  aouaouaoeu
  <div role="main" class="ui-content">
    <ul data-role="listview" data-inset="true" class="ui-listview ui-listview-inset ui-corner-all ui-shadow">
      <li>
        <router-link :to="{ name: 'characters-type', params: { type: 'all' } }">
          Characters
        </router-link>
      </li>
      <li><a href="#profile">Profile Settings</a></li>
      <template v-if="hasAdminInterface">
        <li><a href="#administration">Administration</a></li>
      </template>
      <li><a href="#troupes">Troupes</a></li>
      <li><a href="#referendums">Referendums</a></li>
    </ul>
    <div id="troupe-characters-quick-access" />
  </div>
</template>

<style scoped>

</style>
