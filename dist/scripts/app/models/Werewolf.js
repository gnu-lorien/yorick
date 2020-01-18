define(["underscore","jquery","parse","../models/SimpleTrait","../models/VampireChange","../models/VampireCreation","../collections/VampireChangeCollection","../collections/ExperienceNotationCollection","../models/ExperienceNotation","../helpers/BNSWTAV1_WerewolfCosts","../helpers/PromiseFailReport","../helpers/ExpirationMixin","../helpers/UserWreqr","../models/Character"],function(e,t,n,i,a,r,s,c,o,u,l,_,f,d){var h=[["attributes","Attributes","Attributes"],["focus_physicals","Physical Focus","Attributes"],["focus_mentals","Mental Focus","Attributes"],["focus_socials","Social Focus","Attributes"],["health_levels","Health Levels","Expended"],["willpower_sources","Willpower","Expended"],["wta_gnosis_sources","Gnosis","Expended"],["skills","Skills","Skills"],["lore_specializations","Lore Specializations","Skills"],["academics_specializations","Academics Specializations","Skills"],["drive_specializations","Drive Specializations","Skills"],["linguistics_specializations","Languages","Skills"],["wta_gifts","Gifts","Gifts"],["extra_affinity_links","Extra Affinities","Gifts"],["wta_backgrounds","Backgrounds","Backgrounds"],["wta_territory_specializations","Territory Specializations","Backgrounds"],["contacts_specializations","Contacts Specializations","Backgrounds"],["allies_specializations","Allies Specializations","Backgrounds"],["influence_elite_specializations","Influence: Elite","Backgrounds"],["influence_underworld_specializations","Influence: Underworld","Backgrounds"],["wta_rites","Rites","Backgrounds"],["wta_monikers","Monikers","Backgrounds"],["wta_merits","Merits","Merits and Flaws"],["wta_flaws","Flaws","Merits and Flaws"],["wta_totem_bonus_traits","Totem Bonuses","Pack"]],g=["archetype","archetype_2","wta_breed","wta_auspice","wta_tribe","wta_camp","wta_faction","antecedence"],m=["Archetype","Second Archetype","Breed","Auspice","Tribe","Camp","Faction","Primary, Secondary, or NPC"],p=["wta_merits","wta_flaws"],w=e.extend({get_sum_creation_categories:function(){return p},update_creation_rules_for_changed_trait:function(t,i,a){var r=this;return(e.contains(["wta_merits","wta_flaws"],t)||a)&&e.contains(["wta_flaws","wta_merits","focus_mentals","focus_physicals","focus_socials","attributes","skills","wta_gifts","wta_backgrounds"],t)?n.Object.fetchAllIfNeeded([r.get("creation")]).then(function(s){var c=s[0],o=t+"_"+a+"_remaining",u=t+"_"+a+"_picks";if(c.addUnique(u,i),e.contains(["wta_merits","wta_flaws"],t)){var l=e.sum(c.get(u),"attributes.value");c.set(o,7-l)}else c.increment(o,-1);return n.Promise.as(r)}):n.Promise.as(r)},ensure_creation_rules_exist:function(){var e=this;if(e.has("creation"))return n.Object.fetchAllIfNeeded([e.get("creation")]).then(function(){return n.Promise.as(e)},function(e){console.log("ensure_creation_rules_exist",e)});var t=new r({owner:e,completed:!1,concept:!1,archetype:!1,clan:!1,attributes:!1,focuses:!1,skills_4_remaining:1,skills_3_remaining:2,skills_2_remaining:3,skills_1_remaining:4,wta_backgrounds_3_remaining:1,wta_backgrounds_2_remaining:1,wta_backgrounds_1_remaining:1,wta_gifts_1_remaining:3,attributes_7_remaining:1,attributes_5_remaining:1,attributes_3_remaining:1,focus_mentals_1_remaining:1,focus_socials_1_remaining:1,focus_physicals_1_remaining:1,wta_merits_0_remaining:7,wta_flaws_0_remaining:7,phase_1_finished:!1,initial_xp:30,phase_2_finished:!1});return t.save().then(function(t){return e.set("creation",t),e.add_experience_notation({reason:"Character Creation XP",alteration_earned:30,earned:30})}).then(function(t){return n.Promise.as(e)})},fetch_all_creation_elements:function(){var t=this;return t.ensure_creation_rules_exist().then(function(){var i=t.get("creation"),a=["wta_flaws","wta_merits","focus_mentals","focus_physicals","focus_socials","attributes","skills","wta_backgrounds","wta_gifts"],r=[];return e.each(a,function(t){e.each(e.range(-1,10),function(n){var a=t+"_"+n+"_picks";r=e.union(i.get(a),r)})}),r=e.chain(r).flatten().without(void 0).filter(function(e){return e.id}).value(),n.Object.fetchAllIfNeeded(r).then(function(){return n.Promise.as(t)})})},all_simpletrait_categories:function(){return h},all_text_attributes:function(){return g},all_text_attributes_pretty_names:function(){return m},_raw_rank:function(){var t,n=this;return e.each(n.get("wta_backgrounds"),function(e){"Rank"==e.get_base_name()&&(t=e.get("value"))}),t},rank:function(){return this._raw_rank()||0},has_rank:function(){return!e.isUndefined(this._raw_rank())},get_gnosis_total:function(){var t=this,n=t.get("wta_gnosis_sources"),i=e.sum(n,"attributes.value");return i},calculate_trait_cost:function(e){var t=this;return t.Costs.calculate_trait_cost(t,e)},calculate_trait_to_spend:function(e){var t=this,n=t.Costs.calculate_trait_cost(t,e),i=e.get("cost")||0;return n-i},calculate_total_cost:function(){var t=this,i=["skills","wta_backgrounds","wta_gifts","attributes","wta_merits"],a={},r=e.chain(i).map(function(e){return t.get(e)}).flatten().without(void 0).value();return n.Object.fetchAllIfNeeded(r).then(function(i){return e.each(i,function(e){a[e.get("category")+"-"+e.get("name")]={trait:e,cost:t.calculate_trait_cost(e)}}),n.Promise.as(a)})},max_trait_value:function(e){return"skills"==e.get("category")?10:20},initialize_costs:function(){var t=this;return e.isUndefined(t.Costs)?(t.Costs=new u,t.Costs.initialize().then(function(){return n.Promise.as(t)})):n.Promise.as(t)},get_affinities:function(){var t=this,n=[t.get("wta_tribe"),t.get("wta_auspice"),t.get("wta_breed")];n=e.without(n,void 0);var i=e.map(t.get("extra_affinity_links"),"attributes.name");return i=e.without(i,void 0),[].concat(n,i)}},_);e.extend(w,d);var b=n.Object.extend("Vampire",w);b.get_character=function(t,i,a){if(e.isUndefined(a)&&(a={_character:null}),i=i||[],e.isString(i)&&(i=[i]),null===a._character){var r=new n.Query(b);return r.include("portrait"),r.include("owner"),r.include("wta_backgrounds"),r.include("extra_affinity_links"),r.get(t).then(function(e){return a._character=e,b.get_character(t,i,a)})}if(a._character.id!=t)return a._character.save().then(function(){return a._character=null,b.get_character(t,i,a)});if("all"==i&&(i=e.result(a._character,"all_simpletrait_categories",[]),i=e.map(i,function(e){return e[0]})),0!==i.length){var s=e.chain(i).map(function(e){return a._character.get(e)}).flatten().without(void 0).filter(function(e){return e.id}).value();return n.Object.fetchAllIfNeeded(s).done(function(){return b.get_character(t,[],a)})}return a._character.ensure_creation_rules_exist().then(function(e){return a._character.initialize_costs()}).then(function(e){return a._character.initialize_troupe_membership()})};var k=function(n){e.isUndefined(t)||e.isUndefined(t.mobile)||e.isUndefined(t.mobile.loading)?console.log("Progress: "+n):t.mobile.loading("show",{text:n,textVisible:!0})};return b.create=function(t){var i,a=new b,r=new n.ACL;return r.setPublicReadAccess(!1),r.setPublicWriteAccess(!1),r.setWriteAccess(n.User.current(),!0),r.setReadAccess(n.User.current(),!0),r.setRoleReadAccess("Administrator",!0),r.setRoleWriteAccess("Administrator",!0),a.setACL(r),k("Fetching patronage status"),f.get_latest_patronage(n.User.current()).then(function(i){var r={name:t,type:"Werewolf",owner:n.User.current(),change_count:0};return i&&e.extend(r,{expiresOn:i.get("expiresOn")}),k("Saving base character"),a.save(r)}).then(function(){return k("Fetching character from server"),b.get_character(a.id)}).then(function(e){return i=e,k("Adding Healthy"),i.update_trait("Healthy",3,"health_levels",3,!0)}).then(function(){return k("Adding Injured"),i.update_trait("Injured",3,"health_levels",3,!0)}).then(function(){return k("Adding Incapacitated"),i.update_trait("Incapacitated",3,"health_levels",3,!0)}).then(function(){return k("Adding Willpower"),i.update_trait("Willpower",6,"willpower_sources",6,!0)}).then(function(){return k("Adding Gnosis"),i.update_trait("Gnosis",10,"wta_gnosis_sources",6,!0)}).then(function(){return k("Done!"),n.Promise.as(i)})},b.create_test_character=function(e){var e=e||"",t="karmacharactertestwerewolf"+e+Math.random().toString(36).slice(2);return b.create(t)},b.all_simpletrait_categories=function(){return h},b.all_text_attributes=function(){return g},b.all_text_attributes_pretty_names=function(){return m},b});