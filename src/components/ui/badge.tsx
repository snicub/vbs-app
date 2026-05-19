import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border",
  {
    variants: {
      variant: {
        default:     "bg-primary/10 text-primary border-primary/20",
        secondary:   "bg-secondary text-secondary-foreground border-transparent",
        outline:     "border-border text-foreground bg-transparent",
        muted:       "bg-muted text-muted-foreground border-transparent",

        // Semantic — green = good/safe
        success:     "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
        // Deep green = terminal/safe (home)
        successDeep: "bg-green-600 text-white border-green-700 dark:bg-green-600 dark:text-white",

        // Blue = on-van / in transit
        info:        "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",

        // Teal = arrived but not yet checked in
        accent:      "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",

        // Amber = checked out, transitioning to home
        warning:     "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",

        // Red = problem state
        destructive: "bg-destructive/15 text-destructive border-destructive/30",
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
