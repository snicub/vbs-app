import { env } from "@/lib/env";
import { PhoneIcon } from "lucide-react";

export default function ParentStatusNotFound() {
  const coordinatorPhone = env.COORDINATOR_PHONE;
  const coordinatorName = env.COORDINATOR_NAME;

  return (
    <main className="mx-auto max-w-xl px-4 py-12 space-y-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        This status link is no longer active
      </h1>
      <p className="text-muted-foreground text-sm">
        It may have expired or been replaced with a new link.
      </p>

      {coordinatorPhone ? (
        <a
          href={`tel:${coordinatorPhone}`}
          className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <PhoneIcon className="size-4" />
          Need help? Call{" "}
          {coordinatorName ? coordinatorName : "the coordinator"} at{" "}
          {coordinatorPhone}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">
          Contact the coordinator for a new link.
        </p>
      )}
    </main>
  );
}
