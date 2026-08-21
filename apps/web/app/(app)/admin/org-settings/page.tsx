import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { OrgSettingsForm } from './org-settings-form';

/**
 * Issue #706 (part of EPIC #697, Pilot Readiness). No page previously
 * existed to view or edit organization identity after signup -- `tenant`
 * had only a `name` column, set once at signup and never editable
 * (confirmed via the pilot-readiness audit and a `find` for any
 * "organization"/"org-settings" page turning up nothing). `GET
 * /v1/org-settings` needs no capability gate (reading one's own org's
 * settings is informational, matching the controller's own precedent) --
 * every staff session can view this page; the form's save action is
 * `manage_org_settings`-gated server-side and returns a friendly 403
 * message rather than hiding the whole page for a non-`qa` viewer.
 */
export default async function OrgSettingsPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: settings, response } = await client.GET('/v1/org-settings');
  if (!response.ok || !settings) {
    throw new Error('Something went wrong loading organization settings. Please try again.');
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
