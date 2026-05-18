"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Refresh the coordinator page when any event lands. Cheap and reliable —
 * we just refetch on the change feed rather than diff-applying client-side.
 */
export function CoordinatorRealtime() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("coordinator-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "student_day_events" }, () => {
        router.refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "student_day_records" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
