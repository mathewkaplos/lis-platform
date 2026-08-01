import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';

// One real destination exists today ("/"). Nav grows as later features add
// routes -- not invented ahead of them.
const NAV_ITEMS = [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }];

export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-4 sm:flex"
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
