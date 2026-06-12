import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Plain native <select> wrapped to match shadcn styling. We deliberately use
 * a native select for the registration form — better mobile UX (the OS
 * native picker is faster on phones than a custom dropdown).
 *
 * `text-base` on mobile keeps iOS Safari from autozooming on focus.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:min-h-9 md:py-1 md:text-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export { Select };
