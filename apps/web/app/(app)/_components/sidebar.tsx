import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  AlertTriangle,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Ruler,
  TestTube,
  Users,
} from 'lucide-react';

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
const NAV_ITEMS = [
  { href: '/', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/patients', labelKey: 'patients', icon: Users },
  { href: '/orders', labelKey: 'orders', icon: ClipboardList },
  { href: '/reception', labelKey: 'reception', icon: FlaskConical },
  { href: '/collection-queue', labelKey: 'collectionQueue', icon: ListChecks },
  { href: '/qc-violations', labelKey: 'qcViolations', icon: AlertTriangle },
  { href: '/admin/reference-ranges', labelKey: 'referenceRanges', icon: Ruler },
  { href: '/admin/tests', labelKey: 'addTest', icon: TestTube },
] as const;

export async function Sidebar() {
  const t = await getTranslations('Sidebar');

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-4 sm:flex print:hidden"
    >
      <div className="mb-4 px-2 text-sm font-semibold text-foreground">{t('appName')}</div>
      {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon className="size-4" />
          {t(labelKey)}
        </Link>
      ))}
    </nav>
  );
}
