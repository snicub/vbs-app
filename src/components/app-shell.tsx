import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "./sign-out-button";
import { AppShellNav } from "./app-shell-nav";
import type { UserRole } from "@/types/domain";
import {
  isStaff,
  isCoordinator,
  canCheckIn,
  canDriveVan,
} from "@/lib/auth/roles";

type NavLink = { href: string; label: string };

function linksFor(role: UserRole): NavLink[] {
  if (isCoordinator(role)) {
    return [
      { href: "/coordinator", label: "Today" },
      { href: "/table", label: "Check-In" },
      { href: "/coordinator/vans", label: "Vans" },
      { href: "/coordinator/vans/map", label: "Live Map" },
      { href: "/coordinator/announcements", label: "Announce" },
      { href: "/coordinator/closeout", label: "Closeout" },
    ];
  }
  const links: NavLink[] = [];
  if (canCheckIn(role)) links.push({ href: "/table", label: "Check-In" });
  if (canDriveVan(role)) links.push({ href: "/van", label: "My Van" });
  if (!isStaff(role)) links.push({ href: "/parent", label: "My Family" });
  return links;
}

const ROLE_LABEL: Record<UserRole, string> = {
  parent: "Parent",
  driver: "Driver",
  aide: "Aide",
  table_volunteer: "Table",
  coordinator: "Coordinator",
  admin: "Admin",
};

export function AppShell({
  user,
  children,
}: {
  user: { fullName: string; email: string | null; role: UserRole };
  children: React.ReactNode;
}) {
  const links = linksFor(user.role);
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-[1100] border-b bg-card">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Link
              href="/"
              className="font-semibold whitespace-nowrap text-sm sm:text-base"
            >
              VBS Check-In
            </Link>
            <AppShellNav links={links} />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {ROLE_LABEL[user.role]}
            </Badge>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div>{children}</div>
    </div>
  );
}
