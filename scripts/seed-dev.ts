/* eslint-disable no-console */
// Node < 22 doesn't ship a native WebSocket; supabase-js initializes a
// Realtime client even when we don't use realtime. Polyfill before import.
import WebSocket from "ws";
// @ts-expect-error global polyfill
globalThis.WebSocket ??= WebSocket;

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { generateWristbandCode } from "../src/lib/wristband/generate";

config({ path: ".env.local" });
config({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is required (run pnpm supabase:start, then copy from output)",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const STOPS = [
  { name: "First Baptist Springfield", town: "Springfield",  color_code: "#ef4444", color_name: "Red",    am: "07:30", pm: "16:15", order: 1 },
  { name: "Maple Town Hall",           town: "Maple Falls",  color_code: "#3b82f6", color_name: "Blue",   am: "07:45", pm: "16:30", order: 2 },
  { name: "Riverside Coffee",          town: "Riverside",    color_code: "#22c55e", color_name: "Green",  am: "08:00", pm: "16:45", order: 3 },
  { name: "Oakridge Library",          town: "Oakridge",     color_code: "#eab308", color_name: "Yellow", am: "08:15", pm: "17:00", order: 4 },
  { name: "Willow Creek Center",       town: "Willow Creek", color_code: "#a855f7", color_name: "Purple", am: "08:30", pm: "17:15", order: 5 },
] as const;

const VAN_NAMES = ["Van 1", "Van 2", "Van 3", "Van 4", "Van 5"] as const;

const SAMPLE_FAMILIES = [
  { last: "Anderson", first: ["Aiden", "Ava"],        email: "anderson@example.com", phone: "+15555550101" },
  { last: "Brown",    first: ["Brendan"],             email: "brown@example.com",    phone: "+15555550102" },
  { last: "Chen",     first: ["Charlotte", "Cooper"], email: "chen@example.com",     phone: "+15555550103" },
  { last: "Diaz",     first: ["Diego"],               email: "diaz@example.com",     phone: "+15555550104" },
  { last: "Edwards",  first: ["Emma", "Ethan", "Eli"],email: "edwards@example.com",  phone: "+15555550105" },
  { last: "Foster",   first: ["Finn"],                email: "foster@example.com",   phone: "+15555550106" },
  { last: "Garcia",   first: ["Gabriela", "Gianna"],  email: "garcia@example.com",   phone: "+15555550107" },
  { last: "Hall",     first: ["Hudson"],              email: "hall@example.com",     phone: "+15555550108" },
  { last: "Iyer",     first: ["Isha"],                email: "iyer@example.com",     phone: "+15555550109" },
  { last: "Johnson",  first: ["Jack", "Jordan"],      email: "johnson@example.com",  phone: "+15555550110" },
] as const;

// VBS event week + today for live demoing
const EVENT_DATES = [
  new Date().toISOString().slice(0, 10),
  "2026-06-30",
  "2026-07-01",
  "2026-07-02",
];

function uniqueDates(): string[] {
  return Array.from(new Set(EVENT_DATES));
}

async function reset() {
  // Order matters: children before parents. We don't truncate student_day_events
  // because the trigger blocks DELETE — use a one-shot service-role escape via raw
  // SQL only if needed; in fresh dev this table is already empty.
  const tables = [
    "notifications_sent",
    "incidents",
    "daily_closeouts",
    "van_locations",
    "student_day_records",
    "consents",
    "authorized_pickup_persons",
    "family_access_tokens",
    "guardians",
    "students",
    "families",
    "van_assignments",
    "routes",
    "vans",
    "stops",
  ];
  for (const t of tables) {
    const { error } = await db.from(t).delete().not("id", "is", null);
    if (error && error.code !== "PGRST116") {
      console.warn(`  ! could not clear ${t}: ${error.message}`);
    }
  }
}

async function main() {
  console.log(`Seeding against ${SUPABASE_URL}`);
  console.log("  Clearing existing dev rows…");
  await reset();

  // -------------------------------------------------------------------------
  // Stops
  // -------------------------------------------------------------------------
  const stopRows = STOPS.map((s) => ({
    name: s.name, town: s.town,
    color_code: s.color_code, color_name: s.color_name,
    scheduled_am_time: s.am, scheduled_pm_time: s.pm, sort_order: s.order,
  }));
  const { data: insertedStops, error: stopErr } = await db
    .from("stops").insert(stopRows).select("id, name");
  if (stopErr) throw stopErr;
  console.log(`  ✓ ${insertedStops!.length} stops`);

  // Keep them ordered as listed.
  const orderedStops = STOPS.map((s) =>
    insertedStops!.find((r: { id: string; name: string }) => r.name === s.name)!,
  );

  // -------------------------------------------------------------------------
  // Vans + routes
  // -------------------------------------------------------------------------
  const { data: insertedVans, error: vanErr } = await db
    .from("vans")
    .insert(VAN_NAMES.map((name) => ({ name, capacity: 14 })))
    .select("id, name");
  if (vanErr) throw vanErr;
  console.log(`  ✓ ${insertedVans!.length} vans`);

  const routeRows = insertedVans!.flatMap((v: { id: string; name: string }, i: number) => {
    const stopId = orderedStops[i]!.id;
    return (["am", "pm"] as const).map((direction) => ({
      van_id: v.id, direction, stop_ids: [stopId],
    }));
  });
  const { error: routeErr } = await db.from("routes").insert(routeRows);
  if (routeErr) throw routeErr;
  console.log(`  ✓ ${routeRows.length} routes`);

  // -------------------------------------------------------------------------
  // Families + students + day records
  // -------------------------------------------------------------------------
  const codeSet = new Set<string>();
  function nextCode(): string {
    for (let i = 0; i < 32; i++) {
      const c = generateWristbandCode();
      if (!codeSet.has(c)) {
        codeSet.add(c);
        return c;
      }
    }
    throw new Error("could not generate unique wristband");
  }

  let totalStudents = 0;
  for (let i = 0; i < SAMPLE_FAMILIES.length; i++) {
    const fam = SAMPLE_FAMILIES[i]!;
    const stop = orderedStops[i % orderedStops.length]!;

    const { data: family, error: famErr } = await db
      .from("families")
      .insert({
        primary_guardian_name: `${fam.first[0]} ${fam.last}`,
        primary_email: fam.email,
        primary_phone: fam.phone,
        emergency_contact_name: "Emergency Contact",
        emergency_contact_phone: "+15555559999",
        emergency_contact_relationship: "Friend",
      })
      .select("id")
      .single<{ id: string }>();
    if (famErr || !family) throw famErr ?? new Error("no family inserted");

    for (const firstName of fam.first) {
      const dob = new Date(
        2018 + (firstName.charCodeAt(0) % 4),
        5,
        15,
      ).toISOString().slice(0, 10);

      const { data: studentRow, error: stuErr } = await db
        .from("students")
        .insert({
          family_id: family.id,
          legal_first_name: firstName,
          legal_last_name: fam.last,
          dob,
          wristband_code: nextCode(),
        })
        .select("id")
        .single<{ id: string }>();
      if (stuErr || !studentRow) {
        console.warn(`    skip ${firstName} ${fam.last}: ${stuErr?.message}`);
        continue;
      }

      const dayRows = uniqueDates().map((d) => ({
        student_id: studentRow.id,
        event_date: d,
        attending: true,
        mode: "van" as const,
        morning_stop_id: stop.id,
        afternoon_stop_id: stop.id,
      }));
      const { error: dayErr } = await db.from("student_day_records").insert(dayRows);
      if (dayErr) console.warn(`    day records error: ${dayErr.message}`);

      totalStudents++;
    }
  }
  console.log(`  ✓ ${SAMPLE_FAMILIES.length} families with ${totalStudents} students`);

  // -------------------------------------------------------------------------
  // Van assignments for today
  // -------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  await db.from("van_assignments").insert(
    insertedVans!.map((v: { id: string }) => ({
      assignment_date: today,
      van_id: v.id,
    })),
  );
  console.log(`  ✓ van assignments for ${today}`);

  console.log("Seed complete.");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
