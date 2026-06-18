import { z } from "zod";

const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;

/**
 * Strip a phone string to digits and normalize to E.164 for Twilio.
 * - 10 digits → +1XXXXXXXXXX (US)
 * - 11 digits starting with 1 → +1XXXXXXXXXX (US with country code)
 * - anything else → +<digits> (international)
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export const PhoneSchema = z
  .string()
  .trim()
  .regex(PHONE_RE, "Enter a valid phone number")
  .transform(normalizePhone);

export const EmailSchema = z.string().trim().email("Enter a valid email");

/** Email is optional for door-to-door signup; accept a valid address, blank, or omitted. */
export const OptionalEmailSchema = z
  .union([z.string().trim().email("Enter a valid email"), z.literal("")])
  .optional();

export const GuardianSchema = z.object({
  fullName: z.string().trim().min(1, "Guardian name is required"),
  email: OptionalEmailSchema,
  phone: PhoneSchema,
  relationship: z.string().trim().optional().nullable(),
});

export const EmergencyContactSchema = z.object({
  name: z.string().trim().min(1, "Emergency contact name is required"),
  phone: PhoneSchema,
  relationship: z.string().trim().optional().nullable(),
});

export const AuthorizedPickupSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  phone: PhoneSchema.optional().nullable(),
  relationship: z.string().trim().optional().nullable(),
  isRestricted: z.boolean().default(false),
  notes: z.string().trim().optional().nullable(),
});

export const StudentTransportSchema = z.object({
  mode: z.enum(["van", "parent_dropoff_only", "parent_pickup_only", "parent_both"]),
});

/**
 * Split a single typed name into the first/last columns the schema stores.
 * Last whitespace-separated word becomes the last name; the rest is the first
 * name. A single-word name stores an empty last name (the column is text, not
 * required to be non-empty).
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  const last = parts.pop()!;
  return { first: parts.join(" "), last };
}

export const StudentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .nullable(),
  ageAtRegistration: z
    .number()
    .int()
    .min(1)
    .max(99)
    .optional()
    .nullable(),
  grade: z.string().trim().optional().nullable(),
  allergies: z.string().trim().optional().nullable(),
  medicalNotes: z.string().trim().optional().nullable(),
  // Base64-encoded JPEG bytes (≤~200KB after client-side resize). Optional —
  // door-to-door signups often skip it; a coordinator can add it later.
  photoBytes: z
    .string()
    .regex(/^[A-Za-z0-9+/]+=*$/, "Invalid photo encoding")
    .optional()
    .nullable(),
  transport: StudentTransportSchema,
}).superRefine((s, ctx) => {
  if (!s.dob && (s.ageAtRegistration == null)) {
    ctx.addIssue({
      code: "custom",
      path: ["dob"],
      message: "Provide either date of birth or age",
    });
  }
});

export const ConsentInputSchema = z.object({
  kind: z.enum([
    "media_release",
    "medical",
    "transport",
    "general_liability",
    "photo_release",
  ]),
  textVersion: z.string().min(1),
  textHash: z.string().regex(/^[0-9a-f]{64}$/, "consent text hash must be SHA-256 hex"),
});

export const FamilyRegistrationSchema = z.object({
  family: z.object({
    primaryGuardianName: z.string().trim().min(1),
    primaryEmail: OptionalEmailSchema,
    primaryPhone: PhoneSchema,
    streetAddress: z.string().trim().optional().nullable(),
    city: z.string().trim().optional().nullable(),
    state: z.string().trim().optional().nullable(),
    postalCode: z.string().trim().optional().nullable(),
  }),
  guardians: z.array(GuardianSchema).min(1, "At least one guardian is required"),
  emergencyContact: EmergencyContactSchema.optional(),
  authorizedPickup: z.array(AuthorizedPickupSchema).default([]),
  students: z.array(StudentSchema).min(1, "Add at least one child").max(15, "Maximum 15 children per family"),
  consents: z.object({
    agreed: z.array(ConsentInputSchema).min(3, "All consents are required"),
  }),
}).superRefine((data, ctx) => {
  // Address is the routing input: required when any child needs a van. Stops are
  // no longer picked at registration — the coordinator builds routes from these
  // addresses later. Children driven by a parent both ways don't need an address.
  const needsVan = data.students.some((s) => s.transport.mode !== "parent_both");
  if (!needsVan) return;
  if (!data.family.streetAddress?.trim()) {
    ctx.addIssue({ code: "custom", path: ["family", "streetAddress"], message: "Home address is required for van transportation" });
  }
  if (!data.family.city?.trim()) {
    ctx.addIssue({ code: "custom", path: ["family", "city"], message: "City is required for van transportation" });
  }
  // State + ZIP aren't collected (the event is in Sisseton, SD): state is hard-set
  // to "SD" on the client, ZIP is omitted. Street + city geocodes the home fine.
});

export type FamilyRegistrationInput = z.infer<typeof FamilyRegistrationSchema>;
