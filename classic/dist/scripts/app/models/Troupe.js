define(["jquery","parse"],function(t,e){var r=e.Object.extend("Troupe",{initialize:function(t){var r=this,n=new e.ACL;n.setPublicReadAccess(!0),n.setPublicWriteAccess(!1),n.setRoleReadAccess("Administrator",!0),n.setRoleWriteAccess("Administrator",!0),r.setACL(n),r.title_options=["LST","AST","Narrator"]},get_staff:function(){var t=this,r=[];return e.Promise.when(t.get_roles()).then(function(t){var n=_.map(t,function(t,e){var n=t.getUsers(),i=n.query();return i.each(function(t){t.set("role",e),r.push(t)})});return e.Promise.when(n)}).then(function(){return e.Promise.as(r)})},get_roles:function(){var t=this,r={},n=_.map(t.title_options,function(n){var i=new e.Query(e.Role);return i.equalTo("name",n+"_"+t.id),i.first().then(function(t){r[n]=t})});return e.Promise.when(n).then(function(){return e.Promise.as(r)})},get_generic_roles:function(){var t=this,r={},n=_.map(t.title_options,function(t){var n=new e.Query(e.Role);return n.equalTo("name",t),n.first().then(function(e){r[t]=e})});return e.Promise.when(n).then(function(){return e.Promise.as(r)})},get_thumbnail:function(t){var r=this;if(r.get("portrait")){var n=r.get("portrait");return n.fetch().then(function(n){return console.log(r.get_thumbnail_sync(t)),e.Promise.as(n.get("thumb_"+t).url())})}return e.Promise.as("head_skull.png")},get_thumbnail_sync:function(t){var e=this;return _.result(e,"attributes.portrait.attributes.thumb_"+t+".url","head_skull.png")}});return r});