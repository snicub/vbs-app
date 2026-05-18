import { z } from "zod";

const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;

export const PhoneSchema = z
  .string()
  .trim()
  .regex(PHONE_RE, "Enter a valid phone number");

export const EmailSchema = z.string().trim().email("Enter a valid email");

export const GuardianSchema = z.object({
  fullName: z.string().trim().min(1, "Guardian name is required"),
  email: EmailSchema,
  phone: PhoneSchema,
  relationship: z.string().trim().optional().nullable(),
});

export const EmergencyContactSchema = z.object({
  name: z.string().trim().min(1, "Emergency contact name is required"),
  phone: PhoneSchema,
  relationship: z.string().trim().min(1, "Relationship is required"),
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
  morningStopId: z.string().uuid().nullable(),
  afternoonStopId: z.string().uuid().nullable(),
});

export const StudentSchema = z.object({
  legalFirstName: z.string().trim().min(1, "Legal first name is required"),
  legalLastName: z.string().trim().min(1, "Legal last name is required"),
  preferredFirstName: z.string().trim().optional().nullable(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .nullable(),
  ageAtRegistration: z
    .number()
    .int()
    .min(1)
    .max(18)
    .optional()
    .nullable(),
  grade: z.string().trim().optional().nullable(),
  allergies: z.string().trim().optional().nullable(),
  medicalNotes: z.string().trim().optional().nullable(),
  transport: StudentTransportSchema,
}).superRefine((s, ctx) => {
  if (!s.dob && (s.ageAtRegistration == null)) {
    ctx.addIssue({
      code: "custom",
      path: ["dob"],
      message: "Provide either date of birth or age",
    });
  }
  if (s.transport.mode === "van" && !s.transport.morningStopId) {
    ctx.addIssue({
      code: "custom",
      path: ["transport", "morningStopId"],
      message: "Van mode requires a morning stop",
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
    primaryEmail: EmailSchema,
    primaryPhone: PhoneSchema,
    streetAddress: z.string().trim().optional().nullable(),
    city: z.string().trim().optional().nullable(),
    state: z.string().trim().optional().nullable(),
    postalCode: z.string().trim().optional().nullable(),
  }),
  guardians: z.array(GuardianSchema).min(1, "At least one guardian is required"),
  emergencyContact: EmergencyContactSchema,
  authorizedPickup: z.array(AuthorizedPickupSchema).default([]),
  students: z.array(StudentSchema).min(1, "Add at least one child"),
  consents: z.object({
    typedName: z.string().trim().min(1, "Type your full name to sign"),
    agreed: z.array(ConsentInputSchema).min(5, "All consents are required"),
  }),
});

export type FamilyRegistrationInput = z.infer<typeof FamilyRegistrationSchema>;
