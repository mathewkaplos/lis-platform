import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { OrgSettingsForm } from './org-settings-form';

/**
 * Issue #706 (part of EPIC #697, Pilot Readiness). No page previously
 * existed to view or edit organization identity after signup -- `tenant`
 * had only a `name` column, set once at signup and never editable
 * (confirmed via the pilot-readiness audit and a `find` for any
 * "organization"/"org-settings" page turning up nothing). `GET
 * /v1/org-settings` needs no *specific* capability gate (reading one's own
 * org's settings is informational, matching the controller's own
 * precedent) -- every real staff session can view this page; the form's
 * save action is `manage_org_settings`-gated server-side and returns a
 * friendly 403 message rather than hiding the whole page for a non-`qa`/
 * `lab_admin` viewer.
 *
 * Issue #762: `GET /v1/org-settings` now additionally rejects a zero-role
 * account (`AnyRoleGuard`) -- a live pilot-readiness pass found a real
 * Keycloak account with no assigned role could still read the full org
 * profile here. That 403 is handled below the same way the save action's
 * already was, rather than falling into the generic error branch.
 */
export default async function OrgSettingsPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    // Issue #758: a thrown Error's message is redacted by Next.js in a real production
    // build (see `frontend-design` Skill entry #12) -- return inline instead.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Your session has expired — please log in again.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  const { data: settings, response } = await client.GET('/v1/org-settings');
  if (response.status === 403) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view organization settings.
        </p>
      </div>
    );
  }
  if (!response.ok || !settings) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading organization settings. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Organization settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Your lab&apos;s identity, contact details, and reporting defaults.
        </p>
      </div>
      <OrgSettingsForm settings={settings} />
    </div>
  );
}
