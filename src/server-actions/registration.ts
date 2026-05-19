"use server";

import { headers } from "next/headers";
import { FamilyRegistrationSchema } from "@/lib/registration/schema";
import { VBS_DATES } from "@/lib/registration/dates";
import { createAdminClient } from "@/lib/supabase/admin";

export type RegistrationResult =
  | {
      ok: true;
      familyId: string;
      familyAccessToken: string;
      familyStatusUrl: string;
      wristbandCodes: { studentName: string; code: string }[];
    }
  | { ok: false; error: string };

export async function registerFamily(
  payload: unknown,
): Promise<RegistrationResult> {
  const parsed = FamilyRegistrationSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }

  const data = parsed.data;
  const admin = createAdminClient();

  // 1) Family
  const { data: family, error: familyErr } = await admin
    .from("families")
    .insert({
      primary_guardian_name: data.family.primaryGuardianName,
      primary_email: data.family.primaryEmail,
      primary_phone: data.family.primaryPhone,
      street_address: data.family.streetAddress ?? null,
      city: data.family.city ?? null,
      state: data.family.state ?? null,
      postal_code: data.family.postalCode ?? null,
      emergency_contact_name: data.emergencyContact.name,
      emergency_contact_phone: data.emergencyContact.phone,
      emergency_contact_relationship: data.emergencyContact.relationship,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (familyErr || !family) {
    return { ok: false, error: `could not create family: ${familyErr?.message ?? "unknown"}` };
  }

  const familyId = family.id;

  // 2) Guardians
  const guardianRows = data.guardians.map((g) => ({
    family_id: familyId,
    full_name: g.fullName,
    email: g.email,
    phone: g.phone,
    relationship: g.relationship ?? null,
  }));
  const { error: guardianErr } = await admin.from("guardians").insert(guardianRows as never);
  if (guardianErr) {
    return { ok: false, error: `could not create guardians: ${guardianErr.message}` };
  }

  // 3) Authorized pickup persons (optional)
  if (data.authorizedPickup.length > 0) {
    const rows = data.authorizedPickup.map((p) => ({
      family_id: familyId,
      full_name: p.fullName,
      phone: p.phone ?? null,
      relationship: p.relationship ?? null,
      is_restricted: p.isRestricted ?? false,
      notes: p.notes ?? null,
    }));
    const { error } = await admin.from("authorized_pickup_persons").insert(rows as never);
    if (error) {
      return { ok: false, error: `could not record pickup contacts: ${error.message}` };
    }
  }

  // 4) Students with wristband codes. We insert per-student with retry-on-
  // unique-violation: two concurrent signups could generate the same code,
  // and pre-checking the existing set isn't race-safe. The unique index on
  // students.wristband_code is the authoritative gate; we just regenerate
  // and retry on conflict (Postgres code 23505).
  const { generateWristbandCode } = await import("@/lib/wristband/generate");

  type InsertedStudent = { id: string; legal_first_name: string; legal_last_name: string; wristband_code: string };
  const inserted: InsertedStudent[] = [];

  for (const s of data.students) {
    const row = {
      family_id: familyId,
      legal_first_name: s.legalFirstName,
      legal_last_name: s.legalLastName,
      preferred_first_name: s.preferredFirstName ?? null,
      dob: s.dob ?? null,
      age_at_registration: s.ageAtRegistration ?? null,
      grade: s.grade ?? null,
      allergies: s.allergies ?? null,
      medical_notes: s.medicalNotes ?? null,
      wristband_code: "",
    };
    let result: InsertedStudent | null = null;
    let lastErr: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      row.wristband_code = generateWristbandCode();
      const { data: ins, error } = await admin
        .from("students")
        .insert(row as never)
        .select("id, legal_first_name, legal_last_name, wristband_code")
        .single<InsertedStudent>();
      if (!error && ins) {
        result = ins;
        break;
      }
      lastErr = error;
      // 23505 = unique_violation. Anything else is fatal.
      if (error?.code !== "23505") break;
    }
    if (!result) {
      return {
        ok: false,
        error: `could not create student ${s.legalFirstName} ${s.legalLastName}: ${lastErr?.message ?? "unknown"}`,
      };
    }
    inserted.push(result);
  }

  // Upload photos for each student (if provided). Path: <family>/<student>.jpg
  for (let i = 0; i < data.students.length; i++) {
    const photo = data.students[i]!.photoBytes;
    if (!photo) continue;
    const studentId = inserted[i]!.id;
    const path = `${familyId}/${studentId}.jpg`;
    const bytes = Buffer.from(photo, "base64");
    const { error: uploadErr } = await admin.storage
      .from("student-photos")
      .upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadErr) {
      console.error(`photo upload failed for student ${studentId}: ${uploadErr.message}`);
      continue;
    }
    await admin
      .from("students")
      .update({ photo_path: path } as never)
      .eq("id", studentId);
  }

  // 5) student_day_records — one per (student, VBS date)
  const studentMeta = inserted;
  const dayRows = data.students.flatMap((s, i) => {
    const studentId = studentMeta[i]!.id;
    return VBS_DATES.map((d) => ({
      student_id: studentId,
      event_date: d,
      attending: true,
      mode: s.transport.mode,
      morning_stop_id: s.transport.morningStopId,
      afternoon_stop_id: s.transport.afternoonStopId,
    }));
  });
  const { error: dayErr } = await admin.from("student_day_records").insert(dayRows as never);
  if (dayErr) {
    return { ok: false, error: `could not create day records: ${dayErr.message}` };
  }

  // 6) Consents — snapshot each text+hash with typed name, ip, ua
  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  const ua = hdrs.get("user-agent") || null;
  const consentRows = data.consents.agreed.map((c) => ({
    family_id: familyId,
    kind: c.kind,
    text_version: c.textVersion,
    text_hash: c.textHash,
    typed_name: data.consents.typedName,
    ip_address: ip,
    user_agent: ua,
  }));
  const { error: consentErr } = await admin.from("consents").insert(consentRows as never);
  if (consentErr) {
    return { ok: false, error: `could not record consents: ${consentErr.message}` };
  }

  // 7) Family access token for the parent status URL
  const { data: tokenRow, error: tokenErr } = await admin
    .from("family_access_tokens")
    .insert({ family_id: familyId } as never)
    .select("token")
    .single<{ token: string }>();
  if (tokenErr || !tokenRow) {
    return { ok: false, error: `could not create access token: ${tokenErr?.message ?? "unknown"}` };
  }

  const { env } = await import("@/lib/env");
  const familyStatusUrl = `${env.NEXT_PUBLIC_BASE_URL}/parent/${tokenRow.token}`;

  return {
    ok: true,
    familyId,
    familyAccessToken: tokenRow.token,
    familyStatusUrl,
    wristbandCodes: studentMeta.map((s) => ({
      studentName: `${s.legal_first_name} ${s.legal_last_name}`,
      code: s.wristband_code,
    })),
  };
}
