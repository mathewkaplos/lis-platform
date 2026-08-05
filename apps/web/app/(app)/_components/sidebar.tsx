import Link from 'next/link';
import { ClipboardList, FlaskConical, LayoutDashboard, Users } from 'lucide-react';

// Nav grows as later features add routes -- not invented ahead of them.
// TASK-041: "Register patient" -> "Patients" (search list owns the
// create-button, matching the Stitch pattern) -- registration is still
// reachable from /patients. TASK-044: "Orders" added, closing FEAT-012 --
// a global, cross-patient list (proposal §5), same standing as "Patients".
// TASK-047: "Reception" added -- the scan/lookup entry point for receiving
// specimens (revision §2), same standing as "Orders"/"Patients".
const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/reception', label: 'Reception', icon: FlaskConical },
];

export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-4 sm:flex print:hidden"
    >
      <div className="mb-4 px-2 text-sm font-semibold text-foreground">LIS Platform</div>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
