"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to the three realtime tables and refreshes the current
 * Next.js route on any change. Drop into a layout to get live updates
 * across all child routes for one viewer.
 *
 * Postgres realtime respects RLS as of Supabase 2024+, so each viewer
 * only sees changes they're authorized for (parents see only their
 * family's events, etc.).
 */
export function RealtimeRefresher({
  tables = ["student_day_events", "student_day_records", "van_locations"],
  channelName = "app-realtime",
}: {
  tables?: ("student_day_events" | "student_day_records" | "van_locations")[];
  channelName?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let channel = supabase.channel(channelName);
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => router.refresh(),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), channelName]);
  return null;
}
