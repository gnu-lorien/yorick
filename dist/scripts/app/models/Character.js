define(["underscore","jquery","parse","../models/SimpleTrait","../models/VampireChange","../models/VampireCreation","../collections/VampireChangeCollection","../collections/ExperienceNotationCollection","../models/ExperienceNotation","../helpers/BNSMETV1_VampireCosts","../helpers/PromiseFailReport","../helpers/ExpirationMixin","../helpers/UserWreqr","../models/FauxSimpleTrait","../collections/Approvals","../models/Approval","../models/LongText"],function(e,t,n,r,i,a,o,s,c,u,_,l,p,d,h,g,m){var f=e.extend({remove_trait:function(e){var t=this;return e.destroy().then(function(){var n={alteration_spent:(e.get("cost")||0)*-1,reason:"Removed "+e.get("name")};return t.remove(e.get("category"),e),t.increment("change_count"),t.add_experience_notation(n)})},ensure_category:function(e){this.has(e)||this.set(e,[])},get_troupe_ids:function(){return this.troupe_ids},get_me_acl:function(){var t=this,r=new n.ACL;r.setPublicReadAccess(!1),r.setPublicWriteAccess(!1);var i=t.get("owner");return e.isUndefined(i)?(r.setReadAccess(n.User.current(),!0),r.setWriteAccess(n.User.current(),!0)):(r.setReadAccess(i,!0),r.setWriteAccess(i,!0)),r.setRoleReadAccess("Administrator",!0),r.setRoleWriteAccess("Administrator",!0),e.each(t.troupe_ids,function(e){r.setRoleReadAccess("LST_"+e,!0),r.setRoleWriteAccess("LST_"+e,!0),r.setRoleReadAccess("AST_"+e,!0),r.setRoleWriteAccess("AST_"+e,!0)}),r},set_cached_acl:function(e){var t=this;e=e||t.get_me_acl(),t.set("acl_to_json",JSON.stringify(e.toJSON()))},get_category_for_fetch:function(t){var n=this,r=n.get(t);return e.filter(r,function(t){return!e.isUndefined(t.id)})},update_trait:function(t,i,a,o,s,c,u){var l=this;return l._updateTraitWrapper=l._updateTraitWrapper||n.Promise.as(),l._updateTraitWrapper=l._updateTraitWrapper.always(function(){var p,d;return e.isString(t)?d=t:(p=t,a=p.get("category")),e.isUndefined(s)&&(s=!0),l.ensure_category(a),n.Object.fetchAllIfNeeded(l.get_category_for_fetch(a)).then(function(){if(e.isString(t)){p=new r,e.each(l.get(a),function(t){e.isEqual(t.get("name"),d)&&(p=t)}),p.setACL(l.get_me_acl());var h=n.Object.extend("Vampire");p.set({name:d,value:i||o,category:a,owner:new h({id:l.id}),free_value:o||0}),c&&(p.set("experience_cost_type",c),p.set("experience_cost_modifier",e.parseInt(u)))}else{if(!e.contains(l.get(a),p))return n.Promise.error({code:0,message:"Provided trait not already in Vampire as expected"});if(p.dirty("name")){var g=e.select(e.without(l.get(a),p),"attributes.name",p.get("name"));if(0!=g.length)try{return p.set("name",p._serverData.name),n.Promise.error({code:1,message:"Name matches an existing trait. Restoring original name"})}catch(m){return n.Promise.error({code:2,message:"Name matches an existing trait. Failed to restore original name. "+m})}}}var f=l.calculate_trait_cost(p),v=l.calculate_trait_to_spend(p);e.isFinite(v)||(v=0),p.set("cost",f),l.increment("change_count"),l.addUnique(a,p,{silent:!0}),l.progress("Updating trait "+p.get("name"));var x,y=l.update_creation_rules_for_changed_trait(a,p,o).then(function(){return l.save()}).then(function(){return 0!=v?l.add_experience_notation({alteration_spent:v,reason:"Update "+p.get("name")+" to "+p.get("value")}):n.Promise.as()}).then(function(){return console.log("Finished saving character"),n.Promise.as(l)}).fail(function(e){console.log("Failing to save vampire because of "+JSON.stringify(e)),_(e)});return x=s?y:n.Promise.as(l),x.then(function(){return l.trigger("change:"+a),n.Promise.as(p,l)})})}),l._updateTraitWrapper},update_text:function(e,t){var r=this;return r.set(e,t),r.save().then(function(){return n.Object.fetchAllIfNeeded([r.get("creation")]).then(function(t){var i=t[0];return i.get(e)?n.Promise.as(r):(i.set(e,!0),i.save().then(function(){return n.Promise.as(r)}))})}).fail(_)},unpick_text:function(e){var t=this;return t.unset(e),t.save().then(function(){return n.Object.fetchAllIfNeeded([t.get("creation")]).then(function(r){var i=r[0];return i.set(e,!1),i.save().then(function(){return n.Promise.as(t)})})})},get_trait_by_name:function(t,r){var i=this,a=i.get(t);r=""+r;var o=e.find(a,"attributes.name",r);return n.Promise.as(o,i)},get_trait:function(t,r){var i=this,a=i.get(t);e.isObject(r)&&(r=r.id||r.cid);var o=e.findWhere(a,{cid:r});if(o)return n.Promise.as(o,i);o=e.findWhere(a,{id:r});try{var s=n.Object.fetchAllIfNeeded([o])}catch(c){return c instanceof TypeError?(console.log("Caught a typeerror indicating this object is still saving "+c.message),console.log(JSON.stringify(o)),console.log(JSON.stringify(a)),o.save().then(function(e){return n.Promise.as(e,i)})):n.Promise.reject(c)}return s.then(function(e){return n.Promise.as(e[0],i)})},unpick_from_creation:function(t,r,i){var a=this;return a._updateTraitWrapper=a._updateTraitWrapper||n.Promise.as(),a._updateTraitWrapper=a._updateTraitWrapper.always(function(){return a.fetch_all_creation_elements().then(function(){return a.get_trait(t,r)}).then(function(r){var o=t+"_"+i+"_picks",s=t+"_"+i+"_remaining",c=a.get("creation");if(c.remove(o,r),e.contains(a.get_sum_creation_categories(),t)){var u=e.sum(c.get(o),"attributes.value");c.set(s,7-u)}else c.increment(s,1);return a.progress("Removing creation trait"),c.save().then(function(){return a.remove_trait(r)}).then(function(){return n.Promise.as(a)})})}),a._updateTraitWrapper},is_being_created:function(){return!this.get("creation").get("completed")},complete_character_creation:function(){var e=this;return e.fetch_all_creation_elements().then(function(){var t=e.get("creation");return t.set("completed",!0),t.save()})},health_levels:function(){var t=this,n=["Healthy","Injured","Incapacitated"],r={},i=[];return e.each(t.get("health_levels"),function(e){r[e.get("name")]=e.get("value")}),e.each(n,function(e){i.push([e,r[e]])}),i},experience_available:function(){var e=this;return e.get("experience_earned")-e.get("experience_spent")},get_experience_notations:function(t,r){var i=this;return e.isUndefined(i.experience_notations)?(i.experience_notations=new s,i.experience_notations.on("change",i.on_update_experience_notation,i),i.experience_notations.on("remove",i.on_remove_experience_notation,i),t&&t(i.experience_notations),i.fetch_experience_notations()):(t&&t(i.experience_notations),r&&r(i.experience_notations),n.Promise.as(i.experience_notations))},fetch_experience_notations:function(){var e=this;return e._experienceNotationsFetch=e._experienceNotationsFetch||n.Promise.as(),e._experienceNotationsFetch=e._experienceNotationsFetch.always(function(){var t=new n.Query(c);return t.equalTo("owner",e).addDescending("entered").addDescending("createdAt"),e.experience_notations.query=t,e.experience_notations.fetch({reset:!0})}),e._experienceNotationsFetch},wait_on_current_experience_update:function(){var e=this;return e._propagateExperienceUpdate||n.Promise.as()},_finalize_triggered_experience_notation_changes:function(t,r){var i=this,a=i._propagate_experience_notation_change(i.experience_notations,t);return i._propagateExperienceUpdate=i._propagateExperienceUpdate||n.Promise.as(),i._propagateExperienceUpdate=i._propagateExperienceUpdate.done(function(){return n.Object.saveAll(a)}).done(function(){i.trigger("finish_experience_notation_propagation")}).fail(function(t){e.isArray(t)?e.each(t,function(e){console.log("Something failed"+e.message)}):console.log("error updating experience"+t.message)}),i._propagateExperienceUpdate},on_remove_experience_notation:function(e,t,n){var r=this;return r._finalize_triggered_experience_notation_changes(n.index,t)},on_update_experience_notation:function(e,t,r){var i,a=this,o=!1;n.Promise.as([]);r=r||{};var s=t.changes;return s.entered&&(o=!0,a.experience_notations.sort()),(s.alteration_earned||s.alteration_spent)&&(o=!0),o?(i=a.experience_notations.indexOf(e),a._finalize_triggered_experience_notation_changes(i,a.experience_notations)):n.Promise.as([])},_default_experience_notation:function(t){var n=this,r=e.defaults(t||{},{entered:new Date,reason:"Unspecified reason",earned:0,spent:0,alteration_earned:0,alteration_spent:0,owner:n}),i=new c(r);return i.setACL(n.get_me_acl()),i},_propagate_experience_notation_change:function(t,n){var r=this;r.trigger("begin_experience_notation_propagation");var i;i=n+1<t.models.length?t.at(n+1):r._default_experience_notation();var a=[],o=e.reduceRight(e.slice(t.models,0,n+1),function(e,t,n,r){var i=t.get("alteration_earned")+e.get("earned");t.set("earned",i,{silent:!0});var o=t.get("alteration_spent")+e.get("spent");return t.set("spent",o,{silent:!0}),a.push(t),t},i);return r.set("experience_earned",o.get("earned")),r.set("experience_spent",o.get("spent")),a.push(r),a},add_experience_notation:function(e){var t=this;return t._addExperienceEntryWrapper=t._addExperienceEntryWrapper||n.Promise.as(),t._addExperienceEntryWrapper=t._addExperienceEntryWrapper.always(function(){return t.get_experience_notations()}).then(function(r){var i=t._default_experience_notation(e);r.add(i,{silent:!0});for(var a,o,s=0,c=r.models.length;s<c;s++)if(o=r.models[s],r._byCid[o.cid]){a=s;break}var u=t._propagate_experience_notation_change(r,a);return n.Object.saveAll(u).then(function(){o.trigger("add",o,r,{index:a}),t.trigger("finish_experience_notation_propagation")})}),t._addExperienceEntryWrapper},remove_experience_notation:function(t,r){var r,t,i=this;r=r||{},t=e.isArray(t)?t.slice():[t];var a=t[0],o=a;return i.get_experience_notations().then(function(e){var t=e.indexOf(a);e.remove(a,{silent:!0});var r=i._propagate_experience_notation_change(e,t);return n.Promise.when(a.destroy(),n.Object.saveAll(r)).then(function(){o.trigger("remove",o,e,{index:t}),i.trigger("finish_experience_notation_propagation")})})},get_recorded_changes:function(t){var n=this;if(!e.isUndefined(n.recorded_changes)){var r=n.update_recorded_changes();return t&&r.then(function(e){t(e)}),r}return n.recorded_changes=new o,n.on("saved",n.update_recorded_changes,n),t&&t(n.recorded_changes),n.fetch_recorded_changes()},update_recorded_changes:function(){var t=this;return 0==t.recorded_changes.models.length?t.fetch_recorded_changes():(t._recordedChangesFetch=t._recordedChangesFetch||n.Promise.as(),t._recordedChangesFetch=t._recordedChangesFetch.always(function(){var r=e.last(t.recorded_changes.models).createdAt,a=new n.Query(i);return a.equalTo("owner",t).addAscending("createdAt").limit(1e3),a.greaterThan("createdAt",r),t.recorded_changes.query=a,t.recorded_changes.fetch({add:!0})}),t._recordedChangesFetch)},fetch_recorded_changes:function(){var e=this;return e._recordedChangesFetch=e._recordedChangesFetch||n.Promise.as(),e._recordedChangesFetch=e._recordedChangesFetch.always(function(){console.log("Resetting recorded changes");var t=new n.Query(i);return t.equalTo("owner",e).addAscending("createdAt").limit(1e3),e.recorded_changes.query=t,e.recorded_changes.fetch({reset:!0})}),e._recordedChangesFetch},get_approvals:function(){var t=this;return t._approvalsFetch=t._approvalsFetch||n.Promise.as(),t._approvalsFetch=t._approvalsFetch.always(function(){e.isUndefined(t.approvals)&&(t.approvals=new h);var r=new n.Query(g);return r.equalTo("owner",t),0!=t.approvals.length&&r.greaterThan("createdAt",t.approvals.last().createdAt),r.each(function(e){t.approvals.add(e)})}).then(function(){return n.Promise.as(t.approvals)}),t._approvalsFetch},get_transformed_last_approved:function(){var t=this;return t.get_approvals().then(function(){return t.get_recorded_changes()}).then(function(){if(0==t.approvals.length)return n.Promise.as(null);var r=t.approvals.last().get("change").id,i=e.chain(t.recorded_changes.models).takeRightWhile(function(e){return e.id!=r}).reverse().value(),a=t.get_transformed(i);return n.Promise.as(a)})},get_transformed:function(t){var n=!e.isUndefined(this.troupes),r=this.clone();n&&(this.troupes.parent=null),r._ltCache=this._ltCache;var i=[];return e.each(t,function(t){if("core"!=t.get("category")){var n=t.get("category"),a=e.find(r.get(n),function(n){return e.isUndefined(n)&&console.log("Something went wrong fetching the full character object and now a name is undefined"),e.isEqual(n.get("name"),t.get("name"))}),o=new d({name:t.get("old_text")||t.get("name"),free_value:t.get("free_value"),value:t.get("old_value")||t.get("value"),cost:t.get("old_cost")||t.get("cost"),category:t.get("category")});"update"==t.get("type")?(r.set(n,e.xor(r.get(n),[a,o])),i.push({category:n,name:t.get("name"),fake:o,type:"changed"})):"define"==t.get("type")?(r.set(n,e.without(r.get(n),a)),i.push({category:n,name:o.get("name"),fake:void 0,type:"define"})):"remove"==t.get("type")&&(r.set(n,e.union(r.get(n),[o])),i.push({category:n,name:o.get("name"),fake:o,type:"removed"}))}else"core_define"==t.get("type")?(r.set(t.get("name"),void 0),i.push({category:t.get("category"),name:t.get("name"),old_text:void 0,type:"define"})):"core_update"==t.get("type")&&(r.set(t.get("name"),t.get("old_text")),i.push({category:t.get("category"),name:t.get("name"),old_text:t.get("old_text"),type:"update"}))}),r.transform_description=i,r},get_sorted_skills:function(){var t=this,n=t.get("skills");return n=e.sortBy(n,"attributes.name")},get_grouped_skills:function(t,n){var r=this,t=t||r.get_sorted_skills(),n=n||3,i={0:[],1:[],2:[]},a=e.ceil(t.length/n);return e.each(e.range(n),function(n){i[n]=e.take(t,a),t=e.drop(t,a)}),i=e.zip(i[0],i[1],i[2])},get_thumbnail:function(e){var t=this;if(t.get("portrait")){var r=t.get("portrait");return r.fetch().then(function(r){return console.log(t.get_thumbnail_sync(e)),n.Promise.as(r.get("thumb_"+e).url())})}return n.Promise.as("head_skull.png")},get_thumbnail_sync:function(t){var n=this;return e.result(n,"attributes.portrait.attributes.thumb_"+t+".url","head_skull.png")},get_willpower_total:function(){var t=this,n=t.get("willpower_sources"),r=e.sum(n,"attributes.value");return r},archive:function(){var e=this;return e.unset("owner"),e.save()},initialize_troupe_membership:function(t){var r=this,i=!0;if(r.troupe_ids&&t){var a=new Date-r.last_initialized_troupe_membership;a<5e4&&(i=!1)}if(i){r.last_initialized_troupe_membership=new Date,r.troupe_ids=[],e.isUndefined(r.troupes)?(r.troupes=r.relation("troupes"),r.troupes.targetClassName="Troupe"):e.isNull(r.troupes.parent)&&(r.troupes.parent=r);var o=r.troupes.query();return o.each(function(e){r.troupe_ids.push(e.id)}).then(function(){return n.Promise.as(r)})}return n.Promise.as(r)},broken_update_troupe_acls:function(){var e=this,r=[],i=e.get_me_acl();return t.mobile.loading("show",{text:"Updating character permissions",textVisible:!0}),e.set_cached_acl(i),e.setACL(i),e.save().then(function(){t.mobile.loading("show",{text:"Updating trait permissions",textVisible:!0});var i=new n.Query("SimpleTrait");return i.equalTo("owner",e),i.each(function(t){t.setACL(e.get_me_acl()),r.push(t)})}).then(function(){return t.mobile.loading("show",{text:"Saving trait permissions",textVisible:!0}),n.Object.saveAll(r)}).then(function(){return t.mobile.loading("show",{text:"Fetching experience notations",textVisible:!0}),n.Promise.error()}).then(function(r){return t.mobile.loading("show",{text:"Updating experience notations",textVisible:!0}),r.each(function(t){t.setACL(e.get_me_acl())}),n.Object.saveAll(r.models)}).then(function(){return t.mobile.loading("show",{text:"Updating server side change log",textVisible:!0}),n.Cloud.run("update_vampire_change_permissions_for",{character:e.id})})},progress:function(n){e.isUndefined(t)||e.isUndefined(t.mobile)||e.isUndefined(t.mobile.loading)?console.log("Progress: "+n):t.mobile.loading("show",{text:n,textVisible:!0})},update_troupe_acls:function(){var t=this,r=[],i=t.get_me_acl();return t.progress("Updating character permissions"),t.set_cached_acl(i),t.setACL(i),t.save().then(function(){t.progress("Updating trait permissions"),delete t.attributes.troupes,delete t.troupes,delete t._previousAttributes.troupes,delete t._serverData.troupes;var e=new n.Query("SimpleTrait");return e.equalTo("owner",t),e.each(function(e){e.setACL(t.get_me_acl()),r.push(e)})}).then(function(){t.progress("Saving trait permissions");var i=e.map(r,function(e){var t=e.get("name");return e.save().fail(function(e){return new n.Error(n.Error.OTHER_CAUSE,"Could not save "+t)})});return n.Promise.when(i)}).then(function(){return t.progress("Fetching experience notations"),t.get_experience_notations()}).then(function(e){return t.progress("Updating experience notations"),e.each(function(e){e.setACL(t.get_me_acl())}),n.Object.saveAll(e.models)}).then(function(){return t.progress("Updating server side change log"),n.Cloud.run("update_vampire_change_permissions_for",{character:t.id})}).then(function(){return t.progress("Fetching long texts to update"),t.get_minimal_long_texts()}).then(function(r){return t.progress("Updating long texts with new permissions"),e.each(r,function(e){e.setACL(t.get_me_acl())}),n.Object.saveAll(r)}).then(function(){return t.progress("Finishing up!"),n.Promise.as(t)})},join_troupe:function(e){var t=this;return t.initialize_troupe_membership().then(function(){return t.troupes.add(e),t.troupe_ids.push(e.id),t.update_troupe_acls()})},leave_troupe:function(t){var n=this;return n.initialize_troupe_membership().then(function(){return n.troupes.remove(t),n.troupe_ids=e.remove(n.troupe_ids,t.id),n.update_troupe_acls()})},get_owned_ids:function(){var t=this,r={SimpleTrait:[],ExperienceNotation:[],VampireChange:[]},i=t;return n.Promise.when(e.map(["SimpleTrait","ExperienceNotation","VampireChange"],function(e){var t=new n.Query(e).equalTo("owner",i).select("id");return t.each(function(t){r[e].push(t.id)})})).then(function(){return n.Promise.as(r)})},update_server_client_permissions_mismatch:function(){var t=this;return t._mismatchFetch=t._mismatchFetch||n.Promise.as(),t._mismatchFetch=t._mismatchFetch.always(function(){return n.Promise.when(t.get_owned_ids(),n.Cloud.run("get_expected_vampire_ids",{character:t.id})).then(function(r,i){return e.eq(r,i)?t.is_mismatched=!1:t.is_mismatched=!0,n.Promise.as(t)})}),t._mismatchFetch},check_server_client_permissions_mismatch:function(){return e.isUndefined(this.is_mismatched)?this.update_server_client_permissions_mismatch():n.Promise.as(this)},get_long_text:function(t,r){var i=this,r=r||{update:!1};return i._ltPromise=i._ltPromise||n.Promise.as(),i._ltPromise=i._ltPromise.always(function(){if(i._ltCache=i._ltCache||{},e.has(i._ltCache,t)&&!r.update)return n.Promise.as(e.result(i._ltCache,t));var a=new n.Query(m).equalTo("owner",i).equalTo("category",t);return a.first().then(function(r){return i._ltCache=i._ltCache||{},e.isUndefined(r)?e.set(i._ltCache,t,null):e.set(i._ltCache,t,r),i.trigger("change:longtext"+t,r),n.Promise.as(e.result(i._ltCache,t))})}),i._ltPromise},fetch_long_text:function(e,t){var r=this;return r.get_long_text(e,t).then(function(){return n.Promise.as(r)})},has_long_text:function(t){var r=this;return r._ltPromise=r._ltPromise||n.Promise.as(),r._ltPromise=r._ltPromise.always(function(){var i=new n.Query(m).equalTo("owner",r).equalTo("category",t);return i.first().then(function(t){return n.Promise.as(!e.isUndefined(t))})}),r._ltPromise},has_fetched_long_text:function(t){var n=this;return n._ltCache=n._ltCache||{},e.has(n._ltCache,t)},get_fetched_long_text:function(t){var n=this;return n._ltCache=n._ltCache||{},e.result(n._ltCache,t)},update_long_text:function(t,r){var i=this,a=i.get_long_text(t,{update:!0});return a.then(function(a){return null==a?a=new m({category:t,owner:i,text:r}):a.set({text:r}),a.setACL(i.get_me_acl()),a.save().then(function(){return i._ltCache=i._ltCache||{},e.set(i._ltCache,t,a),i.trigger("change:longtext"+t,a),n.Promise.as(a)})})},remove_long_text:function(t,r){var i=this,r=r||{};e.defaults(r,{update:!0});var a=i.get_long_text(t,r);return a.then(function(e){return e?e.destroy({wait:!0}).then(function(){i._ltCache=i._ltCache||{},delete i._ltCache[t],i.trigger("change:longtext"+t)}):n.Promise.as(null)})},free_fetched_long_text:function(e){var t=this;t._ltCache=t._ltCache||{},delete t._ltCache[e]},get_minimal_long_texts:function(){var e=this;return e._ltPromise=e._ltPromise||n.Promise.as(),e._ltPromise=e._ltPromise.always(function(){var t=new n.Query(m).equalTo("owner",e).select(["owner","category","ACL"]),r=[];return t.each(function(e){r.push(e)}).then(function(){return n.Promise.as(r)})}),e._ltPromise}},l),v=n.Object.extend("Vampire",f);return v});