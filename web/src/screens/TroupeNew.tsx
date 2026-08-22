import { useState } from 'react';
import { Page } from '@/jqm/Page';
import { InputField, TextareaField, ButtonField, SpacerField } from '@/forms/Backform';
import { useLoading } from '@/jqm/Loader';
import { Parse } from '@/parse/init';
import { Troupe } from '@/parse/models/Troupe';
import { navigate } from '@/router/router';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Create a troupe.
 *
 * Ports the `troupenew` handler, views/TroupeNewView.js, forms/TroupeForm.js and
 * the `#troupe-new` block in index.html.
 *
 * Saving a troupe is not one write. It is a five-step chain that builds the
 * troupe's staff hierarchy, and the order is the whole point -- see `save()`
 * below. A troupe saved without it exists but nobody but an Administrator can
 * ever edit it, so a partial failure leaves a troupe that cannot be staffed.
 * The original's answer to that is to send you to `#administration` and log the
 * message; this keeps it.
 *
 * @compare #troupe/new
 */
export function TroupeNew(_: ScreenProps) {
  const [fields, setFields] = useState<TroupeFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const { track } = useLoading();

  const bind = (key: keyof TroupeFields) => (value: string) =>
    setFields((previous) => ({ ...previous, [key]: value }));

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    try {
      const troupe = await track(saveTroupeWithRoles(fields));
      // TroupeNewView.render() hands the form a fresh Troupe on success, which
      // is what blanks the fields. Reproduced even though the navigation below
      // unmounts this screen a moment later, because the two are one act in the
      // original and splitting them is how the blanking gets lost.
      setFields(EMPTY);
      navigate(`#troupe/${troupe.id}`);
    } catch (error) {
      // TroupeNewView.js:83. A troupe whose role chain did not complete is not
      // usable, so the original does not leave you looking at it.
      console.log('Failed to save troupe ' + (error instanceof Error ? error.message : error));
      navigate('#administration');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page id="troupe-new" title="New Troupe">
      {/* No `profile-form` class: Backbone applies a view's `className` only
          when it creates the element, and this form already exists in
          index.html as a bare `<form id="troupe-new-form">`. So the form here
          is written out rather than taken from forms/Backform, whose `Form`
          carries the class the one screen that *does* create its own element
          needs. */}
      <form
        id="troupe-new-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <InputField name="name" label="Name" value={fields.name} onChange={bind('name')} />
        <InputField
          name="shortname"
          label="Short Name"
          value={fields.shortname}
          onChange={bind('shortname')}
        />
        <InputField
          name="shortdescription"
          label="Short Public Description"
          value={fields.shortdescription}
          onChange={bind('shortdescription')}
        />
        <InputField
          name="location"
          label="Location"
          value={fields.location}
          onChange={bind('location')}
        />
        <InputField
          name="boundaries"
          label="Troupe Boundaries"
          value={fields.boundaries}
          onChange={bind('boundaries')}
        />
        <InputField
          name="staffemail"
          label="Staff Email Address"
          value={fields.staffemail}
          onChange={bind('staffemail')}
        />
        {/* `{control: "spacer"}` in TroupeForm.js, between the single-line
            fields and the two long ones. Backform's Field defaults `name` to
            "", so the group carries no name class. */}
        <SpacerField name="" />
        <TextareaField
          name="description"
          label="Long Public Description"
          value={fields.description}
          onChange={bind('description')}
        />
        <TextareaField
          name="proxypolicy"
          label="Policies for Proxied Characters"
          value={fields.proxypolicy}
          onChange={bind('proxypolicy')}
        />
        {/* The button is not in TroupeForm.js's field list -- it is appended by
            TroupeNewView's initialize, so the same form can be reused for
            editing without an "Add New" button on it. */}
        <ButtonField name="" label="Add New" disabled={busy} />
      </form>
    </Page>
  );
}

/** The eight editable attributes, in the order TroupeForm.js lists them. */
interface TroupeFields {
  name: string;
  shortname: string;
  shortdescription: string;
  location: string;
  boundaries: string;
  staffemail: string;
  description: string;
  proxypolicy: string;
}

const EMPTY: TroupeFields = {
  name: '',
  shortname: '',
  shortdescription: '',
  location: '',
  boundaries: '',
  staffemail: '',
  description: '',
  proxypolicy: '',
};

/**
 * Save a new troupe and the three roles that staff it.
 *
 * Ports TroupeNewView.js:22-88 step for step. Five round trips, in this order
 * and no other:
 *
 * 1. Save the troupe, because the roles are named after its objectId.
 * 2. Save `LST_<id>`, `AST_<id>` and `Narrator_<id>`, each containing the
 *    Administrator role. Their ACLs nest the same way the roles are about to:
 *    AST is readable and writable by LST, Narrator by both. That nesting is
 *    written on the ACLs *before* the roles exist as rows, which is fine --
 *    an ACL stores a role by name, not by pointer.
 * 3. Add LST to AST's roles and both to Narrator's, and save again. This
 *    cannot be done in step 2: a role's `roles` relation needs saved rows on
 *    both ends, so the members can only be added once the ids exist.
 * 4. Grant LST read and write on the troupe itself, and save the troupe again.
 *    Until this lands only an Administrator can edit the troupe.
 */
async function saveTroupeWithRoles(fields: TroupeFields): Promise<Troupe> {
  const troupe = new Troupe();
  // Only the fields that were filled in. Backform writes an attribute when its
  // control fires `change`, so a field nobody touched is never set at all --
  // and on a brand new troupe "untouched" and "empty" are the same set.
  for (const [key, value] of Object.entries(fields)) {
    if (value !== '') troupe.set(key, value);
  }
  const saved = await troupe.save();

  const adminRole = await new Parse.Query(Parse.Role).equalTo('name', 'Administrator').first();
  if (!adminRole) {
    // The original passes `q.first()`'s result straight to `relation.add()`,
    // so a missing Administrator role throws inside the SDK there. Same
    // outcome -- a rejected save, and the caller's redirect to
    // #administration -- with a message that names the cause.
    throw new Error('No Administrator role to seed the troupe roles with');
  }

  const lstAcl = new Parse.ACL();
  lstAcl.setPublicReadAccess(true);
  lstAcl.setPublicWriteAccess(false);
  lstAcl.setRoleReadAccess('Administrator', true);
  lstAcl.setRoleWriteAccess('Administrator', true);
  const lst = new Parse.Role(`LST_${saved.id}`, lstAcl);
  lst.getRoles().add(adminRole);

  const astAcl = new Parse.ACL();
  astAcl.setPublicReadAccess(true);
  astAcl.setPublicWriteAccess(false);
  astAcl.setRoleReadAccess('Administrator', true);
  astAcl.setRoleWriteAccess('Administrator', true);
  astAcl.setRoleReadAccess(lst, true);
  astAcl.setRoleWriteAccess(lst, true);
  const ast = new Parse.Role(`AST_${saved.id}`, astAcl);
  ast.getRoles().add(adminRole);

  const narratorAcl = new Parse.ACL();
  narratorAcl.setPublicReadAccess(true);
  narratorAcl.setPublicWriteAccess(false);
  narratorAcl.setRoleReadAccess('Administrator', true);
  narratorAcl.setRoleWriteAccess('Administrator', true);
  narratorAcl.setRoleReadAccess(lst, true);
  narratorAcl.setRoleWriteAccess(lst, true);
  narratorAcl.setRoleReadAccess(ast, true);
  narratorAcl.setRoleWriteAccess(ast, true);
  const narrator = new Parse.Role(`Narrator_${saved.id}`, narratorAcl);
  narrator.getRoles().add(adminRole);

  await Parse.Object.saveAll([lst, ast, narrator]);

  ast.getRoles().add(lst);
  narrator.getRoles().add([lst, ast]);
  await Parse.Object.saveAll([lst, ast, narrator]);

  const acl = saved.getACL() ?? new Parse.ACL();
  acl.setRoleReadAccess(lst, true);
  acl.setRoleWriteAccess(lst, true);
  saved.setACL(acl);
  return (await saved.save()) as Troupe;
}

registerScreen('troupenew', TroupeNew);
