import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  FlaskConical,
  Layers,
  LayoutDashboard,
  ListChecks,
  Microscope,
  Receipt,
  FileStack,
  Ruler,
  Settings,
  TestTube,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { MobileNavTrigger } from './mobile-nav-trigger';

// Nav grows as later features add routes -- not invented ahead of them.
// TASK-041: "Register patient" -> "Patients" (search list owns the
// create-button, matching the Stitch pattern) -- registration is still
// reachable from /patients. TASK-044: "Orders" added, closing FEAT-012 --
// a global, cross-patient list (proposal §5), same standing as "Patients".
// TASK-047: "Reception" added -- the scan/lookup entry point for receiving
// specimens (revision §2), same standing as "Orders"/"Patients". TASK-048:
// "Collection queue" added -- pending-collection worklist (revision §2),
// same standing as the others. TASK-070: "QC violations" added -- unlike
// control-lots/[id]/chart (TASK-069, still direct-link-only, no list to
// link from), this route IS that list (proposal §10 Q2, folding in #381),
// so it earns a real nav entry rather than staying link-only.
//
// FEAT-035: "Reference ranges"/"Add test" added -- unconditionally listed
// for every session, not role-filtered here. No nav-level role gate exists
// anywhere in this file today (confirmed: `Sidebar` receives no `session`
// prop at all) -- `qc-violations`'s own real precedent gates only the
// Resolve *button* inside its page via `hasQaRole()`, never the nav entry
// or the route itself. Both new pages follow that identical shape: a
// non-`qa` visitor reaches the page and sees the data, but the create
// control (the real, API-enforced action) doesn't render for them.
// FEAT-048 (ADR-0043): `labelKey` looks up the nav item's own label in the
// `Sidebar` message namespace (messages/*.json) -- the literal English
// strings that used to live here moved there instead.
// FEAT-052: "Culture reads" added -- the due-reads worklist earns a real
// nav entry, same standing as "QC violations" (a real list to link to, not
// a link-only detail route).
// FEAT-066 (ADR-0053): "Referring facilities" added -- the same standing as
// "Reference ranges"/"Add test" (a real admin list+create screen, not
// role-filtered at the nav level either).
// FEAT-067 (ADR-0055): "Cases" added -- the first real nav entry into the
// M13 Anatomic Pathology hierarchy (Case/Specimen/Block/Slide), which had
// no apps/web UI at all before this feature. Same standing as "Orders"/
// "Patients" (a real global, cross-patient list to link to).
// Issue #489 (§17.1 only, docs/plans/task-489-invoice-list.md): "Invoices"
// added -- a real, filterable, cross-patient list (unlike the pre-existing
// `/billing/invoices/[invoiceId]` detail route, which was link-only, no
// list to reach it from), same standing as "Cases"/"QC violations". Not
// role-filtered here either, matching this file's own established
// convention -- `GET /v1/invoices`'s own `CapabilityGuard` is the real
// enforcement point.
// Issue #706 (EPIC #697): "Org settings" added -- the first real
// organization-profile screen (name/address/contact/logo/currency, plus
// the pre-existing #692 synoptic-standard preference, which had no editing
// UI at all before this). Same standing as "Reference ranges"/"Add test"/
// "Referring facilities" -- not role-filtered here either; `GET
// /v1/org-settings` needs no capability gate, and the save action's own
// `manage_org_settings` `CapabilityGuard` is the real enforcement point.
// Issue #704 (EPIC #697): "Facility statement" added -- the consolidated,
// date-ranged view across a referring facility's own invoices (the design
// partner's own stated "one invoice for all patients in this date range"
// scenario). Same standing as "Invoices" -- `GET /v1/invoices`'s own
// `manage_billing` `CapabilityGuard` is the real enforcement point.
// Issue #703 (EPIC #697): "Users" added -- the first real user-management
// screen (create/list/deactivate/assign role), closing the original
// pilot-readiness audit's #2 finding. Same standing as the other admin
// entries -- not role-filtered here either; `GET /v1/users`'s own
// `manage_users` `CapabilityGuard` is the real enforcement point.
const NAV_ITEMS = [
  { href: '/', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/patients', labelKey: 'patients', icon: Users },
  { href: '/orders', labelKey: 'orders', icon: ClipboardList },
  { href: '/cases', labelKey: 'cases', icon: Layers },
  { href: '/reception', labelKey: 'reception', icon: FlaskConical },
  { href: '/collection-queue', labelKey: 'collectionQueue', icon: ListChecks },
  { href: '/qc-violations', labelKey: 'qcViolations', icon: AlertTriangle },
  { href: '/culture-reads', labelKey: 'cultureReads', icon: Microscope },
  { href: '/billing/invoices', labelKey: 'invoices', icon: Receipt },
  { href: '/billing/facility-statement', labelKey: 'facilityStatement', icon: FileStack },
  { href: '/admin/reference-ranges', labelKey: 'referenceRanges', icon: Ruler },
  { href: '/admin/tests', labelKey: 'addTest', icon: TestTube },
  { href: '/admin/referring-facilities', labelKey: 'referringFacilities', icon: Building2 },
  { href: '/admin/org-settings', labelKey: 'orgSettings', icon: Settings },
  { href: '/admin/users', labelKey: 'users', icon: UserCog },
] as const;

function SidebarNavLinks({
  items,
  t,
}: {
  items: readonly { href: string; labelKey: string; icon: LucideIcon }[];
  t: (key: string) => string;
}) {
  return (
    <>
      {items.map(({ href, labelKey, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon className="size-4" />
          {t(labelKey)}
        </Link>
      ))}
    </>
  );
}

export async function Sidebar() {
  const t = await getTranslations('Sidebar');
  const appName = t('appName');

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-4 sm:flex print:hidden"
    >
      <div className="mb-4 px-2 text-sm font-semibold text-foreground">{appName}</div>
      <SidebarNavLinks items={NAV_ITEMS} t={t} />
    </nav>
  );
}

// Rendered by (app)/layout.tsx inside the main content column, above TopBar
// -- not a sibling of Sidebar's own <nav> above, which sits in the layout's
// outer flex row and would otherwise place this bar beside the content
// column instead of stacked full-width above it. Kept in this file, not
// top-bar.tsx, so NAV_ITEMS/translations stay owned in one place (proposal
// §5.3, docs/plans/task-240-mobile-nav.md).
export async function MobileTopNav() {
  const t = await getTranslations('Sidebar');
  const appName = t('appName');

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-2 py-2 sm:hidden print:hidden">
      <MobileNavTrigger triggerLabel={t('openNav')} title={appName}>
        <SidebarNavLinks items={NAV_ITEMS} t={t} />
      </MobileNavTrigger>
      <span className="text-sm font-semibold text-foreground">{appName}</span>
    </div>
  );
}
