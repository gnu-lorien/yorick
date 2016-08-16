define(["jquery","backbone","parse","backform","../forms/UserForm"],function(e,s,t,r,o){var n=s.View.extend({initialize:function(){var o=this;o.errorModel=new s.Model,this.form=new r.Form({errorModel:o.errorModel,model:new s.Model,fields:[{name:"email",label:"Email Address for the Account",control:"input",type:"email"},{name:"reset",label:"Reset Password",control:"button",id:"reset",extraClasses:["reset-user-password"],type:"submit"}],events:{"click .reset-user-password":function(s){s.preventDefault();var r=this,o=r.model.get("email");e.mobile.loading("show"),r.undelegateEvents(),r.$(".reset-password-button").attr("disabled",!0),t.User.requestPasswordReset(o,function(){r.fields.get("reset").set({status:"success",message:"Password Reset Email Sent"})},function(e){r.fields.get("reset").set({status:"error",message:_.escape(e.message)})}).always(function(){r.$el.enhanceWithin(),r.$(".reset-password-button").removeAttr("disabled"),e.mobile.loading("hide")})}}})},render:function(){return this.form.setElement(this.$el.find("form.profile-form")),this.form.render(),this.$el.enhanceWithin(),this}});return n});