import Link from "next/link";
import { HomeIcon } from "lucide-react";
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
      { href: "/coordinator/students", label: "Students" },
      { href: "/table", label: "Check-In" },
      { href: "/coordinator/groups", label: "Groups" },
      { href: "/coordinator/nametags", label: "Name Tags" },
      { href: "/coordinator/acupuncture", label: "Acupuncture" },
      { href: "/coordinator/medical", label: "Medical" },
      { href: "/coordinator/stops", label: "Colors" },
      { href: "/coordinator/vans", label: "Vans" },
      { href: "/coordinator/van-rosters", label: "Driver Sheets" },
      { href: "/photos", label: "Photos" },
    ];
  }
  const links: NavLink[] = [];
  if (canCheckIn(role)) links.push({ href: "/table", label: "Check-In" });
  if (canDriveVan(role)) links.push({ href: "/van", label: "My Van" });
  if (isStaff(role)) links.push({ href: "/photos", label: "Photos" });
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
      <header className="sticky top-0 z-[1100] border-b bg-card print:hidden">
        <div className="mx-auto max-w-7xl px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Link
              href={isCoordinator(user.role) ? "/coordinator" : "/"}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/50 px-2.5 py-1.5 font-semibold whitespace-nowrap text-sm sm:text-base hover:bg-muted transition-colors"
            >
              <HomeIcon className="size-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">VBS Check-In</span>
              <span className="sm:hidden">Home</span>
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
