"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to the realtime tables and refreshes the current Next.js
 * route on any change. Drop into a layout to get live updates across
 * all child routes for one viewer.
 *
 * Refreshes are debounced (default 150ms) — during a check-in burst,
 * 50 inserts in a second coalesce into ~7 refreshes instead of 50.
 * Without this, the page would self-DoS on a busy morning.
 *
 * Postgres realtime respects RLS as of Supabase 2024+, so each viewer
 * only sees changes they're authorized for.
 */
export function RealtimeRefresher({
  tables = ["student_day_events", "student_day_records", "van_locations"],
  channelName = "app-realtime",
  debounceMs = 150,
}: {
  tables?: ("student_day_events" | "student_day_records" | "van_locations")[];
  channelName?: string;
  debounceMs?: number;
}) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel = supabase.channel(channelName);

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        router.refresh();
      }, debounceMs);
    }

    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    }
    channel.subscribe();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), channelName, debounceMs]);
  return null;
}
