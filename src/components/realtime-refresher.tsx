"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type ConnectionStatus = "connected" | "disconnected" | "error";

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
 *
 * When the WebSocket drops, a persistent amber banner appears so the
 * coordinator knows data may be stale. Reconnecting hides the banner
 * and triggers a one-time refresh.
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
  const [status, setStatus] = useState<ConnectionStatus>("connected");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  function scheduleRefresh() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      router.refresh();
    }, debounceMs);
  }

  function subscribe() {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    let ch = supabase.channel(channelName);

    for (const table of tables) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    }

    ch.subscribe((subStatus: string) => {
      if (subStatus === "SUBSCRIBED") {
        let wasDisconnected = false;
        setStatus((prev) => {
          if (prev !== "connected") wasDisconnected = true;
          return "connected";
        });
        if (wasDisconnected) router.refresh();
      } else if (
        subStatus === "CLOSED" ||
        subStatus === "CHANNEL_ERROR" ||
        subStatus === "TIMED_OUT"
      ) {
        setStatus(subStatus === "CHANNEL_ERROR" ? "error" : "disconnected");
      }
    });

    channelRef.current = ch;
  }

  function handleReconnect() {
    const supabase = supabaseRef.current;
    if (!supabase || !channelRef.current) return;
    supabase.removeChannel(channelRef.current);
    router.refresh();
    subscribe();
  }

  useEffect(() => {
    supabaseRef.current = createClient();
    subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(channelRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), channelName, debounceMs]);

  if (status === "connected") return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-3 bg-amber-100 border-b border-amber-300 px-4 py-2 text-amber-900 text-sm">
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="size-4 shrink-0"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <span>Live updates disconnected — data may be stale</span>
      </div>
      <button
        onClick={handleReconnect}
        className="shrink-0 rounded bg-amber-200 px-3 py-1 font-medium hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
      >
        Refresh
      </button>
    </div>
  );
}
