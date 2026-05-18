"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string };

export function AppShellNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  }

  return (
    <>
      {/* Desktop nav: inline pills, hidden on small screens */}
      <nav className="hidden md:flex gap-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
              isActive(l.href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      {/* Mobile trigger: hamburger button (visible only on small screens) */}
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
        className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <HamburgerIcon open={open} />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div
          id="mobile-nav"
          className="md:hidden fixed left-0 right-0 top-14 z-[1099] border-b bg-card shadow-lg"
        >
          <nav className="px-4 py-2 flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "py-3 text-base border-b last:border-b-0",
                  isActive(l.href)
                    ? "font-semibold text-primary"
                    : "text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      {open ? (
        <>
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
