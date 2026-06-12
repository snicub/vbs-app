import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Generic badge variants. State-specific badges should use the
 * `tone`-driven classes from `@/lib/state-presentation` rather than
 * picking a variant here — that file is the source of truth for state
 * color, this file is just plumbing.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:     "bg-primary/10 text-primary border-primary/25",
        secondary:   "bg-secondary text-secondary-foreground border-transparent",
        outline:     "border-border text-foreground bg-transparent",
        muted:       "bg-muted text-muted-foreground border-border",
        success:     "bg-[var(--state-safe)]/12 text-[var(--state-safe)] border-[var(--state-safe)]/30",
        successDeep: "bg-[var(--state-home)] text-white border-[var(--state-home)]",
        info:        "bg-[var(--state-transit)]/12 text-[var(--state-transit)] border-[var(--state-transit)]/30",
        accent:      "bg-[var(--state-arrived)]/12 text-[var(--state-arrived)] border-[var(--state-arrived)]/30",
        warning:     "bg-[var(--anomaly-warn)]/15 text-[var(--anomaly-warn)] border-[var(--anomaly-warn)]/35",
        destructive: "bg-[var(--anomaly-critical)]/15 text-[var(--anomaly-critical)] border-[var(--anomaly-critical)]/40",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
