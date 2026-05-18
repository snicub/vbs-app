/* eslint-disable no-console */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { generateWristbandCode } from "../src/lib/wristband/generate";

config({ path: ".env.local" });
config({ path: ".env" });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is required (run pnpm supabase start, then copy from output)",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const STOPS = [
  { name: "First Baptist Springfield",  town: "Springfield",  color_code: "#ef4444", color_name: "Red",    am: "07:30", pm: "16:15", order: 1 },
  { name: "Maple Town Hall",            town: "Maple Falls",  color_code: "#3b82f6", color_name: "Blue",   am: "07:45", pm: "16:30", order: 2 },
  { name: "Riverside Coffee",           town: "Riverside",    color_code: "#22c55e", color_name: "Green",  am: "08:00", pm: "16:45", order: 3 },
  { name: "Oakridge Library",           town: "Oakridge",     color_code: "#eab308", color_name: "Yellow", am: "08:15", pm: "17:00", order: 4 },
  { name: "Willow Creek Center",        town: "Willow Creek", color_code: "#a855f7", color_name: "Purple", am: "08:30", pm: "17:15", order: 5 },
] as const;

const VAN_NAMES = ["Van 1", "Van 2", "Van 3", "Van 4", "Van 5"] as const;

const SAMPLE_FAMILIES = [
  { last: "Anderson",  first: ["Aiden", "Ava"],         email: "anderson@example.com",  phone: "+15555550101" },
  { last: "Brown",     first: ["Brendan"],              email: "brown@example.com",     phone: "+15555550102" },
  { last: "Chen",      first: ["Charlotte", "Cooper"],  email: "chen@example.com",      phone: "+15555550103" },
  { last: "Diaz",      first: ["Diego"],                email: "diaz@example.com",      phone: "+15555550104" },
  { last: "Edwards",   first: ["Emma", "Ethan", "Eli"], email: "edwards@example.com",   phone: "+15555550105" },
  { last: "Foster",    first: ["Finn"],                 email: "foster@example.com",    phone: "+15555550106" },
  { last: "Garcia",    first: ["Gabriela", "Gianna"],   email: "garcia@example.com",    phone: "+15555550107" },
  { last: "Hall",      first: ["Hudson"],               email: "hall@example.com",      phone: "+15555550108" },
  { last: "Iyer",      first: ["Isha"],                 email: "iyer@example.com",      phone: "+15555550109" },
  { last: "Johnson",   first: ["Jack", "Jordan"],       email: "johnson@example.com",   phone: "+15555550110" },
] as const;

// VBS event week: 2026-06-22 .. 2026-06-26
const EVENT_DATES = [
  "2026-06-22",
  "2026-06-23",
  "2026-06-24",
  "2026-06-25",
  "2026-06-26",
] as const;

async function uniqueWristbandCode(existing: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = generateWristbandCode();
    if (!existing.has(code)) {
      existing.add(code);
      return code;
    }
  }
  throw new Error("could not generate a unique wristband code in 32 tries");
}

async function main() {
  console.log(`Seeding against ${SUPABASE_URL}`);

  // -------------------------------------------------------------------------
  // Stops
  // -------------------------------------------------------------------------
  const insertedStops: { id: string; name: string; order: number }[] = [];
  for (const s of STOPS) {
    const { data, error } = await db
      .from("stops")
      .upsert(
        {
          name: s.name,
          town: s.town,
          color_code: s.color_code,
          color_name: s.color_name,
          scheduled_am_time: s.am,
          scheduled_pm_time: s.pm,
          sort_order: s.order,
        },
        { onConflict: "name" },
      )
      .select("id, name")
      .single();
    if (error) throw error;
    insertedStops.push({ id: data.id, name: data.name, order: s.order });
  }
  insertedStops.sort((a, b) => a.order - b.order);
  console.log(`  ✓ ${insertedStops.length} stops`);

  // -------------------------------------------------------------------------
  // Vans + routes (each van does AM forward, PM reverse)
  // -------------------------------------------------------------------------
  const insertedVans: { id: string; name: string }[] = [];
  for (let i = 0; i < VAN_NAMES.length; i++) {
    const name = VAN_NAMES[i]!;
    const { data, error } = await db
      .from("vans")
      .upsert({ name, capacity: 14 }, { onConflict: "name" })
      .select("id, name")
      .single();
    if (error) throw error;
    insertedVans.push({ id: data.id, name: data.name });
  }
  console.log(`  ✓ ${insertedVans.length} vans`);

  for (let i = 0; i < insertedVans.length; i++) {
    const van = insertedVans[i]!;
    const stopId = insertedStops[i]!.id;     // one stop per van for the dev seed
    for (const direction of ["am", "pm"] as const) {
      const { error } = await db
        .from("routes")
        .upsert(
          { van_id: van.id, direction, stop_ids: [stopId] },
          { onConflict: "van_id,direction" },
        );
      if (error) throw error;
    }
  }
  console.log(`  ✓ ${insertedVans.length * 2} routes`);

  // -------------------------------------------------------------------------
  // Families, students, day records
  // -------------------------------------------------------------------------
  const existingCodes = new Set<string>();
  const { data: existingStudents } = await db.from("students").select("wristband_code");
  for (const s of existingStudents ?? []) existingCodes.add(s.wristband_code);

  for (let i = 0; i < SAMPLE_FAMILIES.length; i++) {
    const fam = SAMPLE_FAMILIES[i]!;
    const stop = insertedStops[i % insertedStops.length]!;
    const { data: familyRow, error: familyErr } = await db
      .from("families")
      .upsert(
        {
          primary_guardian_name: `${fam.first[0]} ${fam.last}`,
          primary_email: fam.email,
          primary_phone: fam.phone,
        },
        { onConflict: "primary_email" }
      )
      .select("id")
      .single();
    if (familyErr) {
      // primary_email isn't unique; fall back to manual lookup
      const { data: lookup } = await db
        .from("families")
        .select("id")
        .eq("primary_email", fam.email)
        .limit(1)
        .single();
      if (!lookup) throw familyErr;
    }
    const familyId = familyRow?.id ?? (await (async () => {
      const { data, error } = await db.from("families").select("id").eq("primary_email", fam.email).limit(1).single();
      if (error) throw error;
      return data.id;
    })());

    for (const firstName of fam.first) {
      const dob = new Date(2018 + (firstName.length % 4), 5, 15).toISOString().slice(0, 10);
      const code = await uniqueWristbandCode(existingCodes);
      const { data: studentRow, error: studentErr } = await db
        .from("students")
        .upsert(
          {
            family_id: familyId,
            legal_first_name: firstName,
            legal_last_name: fam.last,
            dob,
            wristband_code: code,
          },
          { onConflict: "family_id,legal_first_name,legal_last_name,dob" }
        )
        .select("id")
        .single();
      if (studentErr) {
        console.warn(`    skip ${firstName} ${fam.last}: ${studentErr.message}`);
        continue;
      }
      const studentId = studentRow!.id;

      for (const eventDate of EVENT_DATES) {
        await db.from("student_day_records").upsert(
          {
            student_id: studentId,
            event_date: eventDate,
            attending: true,
            mode: "van",
            morning_stop_id: stop.id,
            afternoon_stop_id: stop.id,
          },
          { onConflict: "student_id,event_date" }
        );
      }
    }
  }
  console.log(`  ✓ ${SAMPLE_FAMILIES.length} families + students + day records`);

  // -------------------------------------------------------------------------
  // Van assignments (just for today's date, useful for local dev)
  // -------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  for (const van of insertedVans) {
    await db.from("van_assignments").upsert(
      { assignment_date: today, van_id: van.id },
      { onConflict: "assignment_date,van_id" }
    );
  }
  console.log(`  ✓ van assignments for ${today}`);

  console.log("Seed complete.");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
