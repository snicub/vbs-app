import { describe, it, expect } from "vitest";
import {
  FamilyRegistrationSchema,
  StudentSchema,
  PhoneSchema,
  normalizePhone,
} from "@/lib/registration/schema";

const SAMPLE_HASH = "a".repeat(64);
const SAMPLE_STOP_ID = "550e8400-e29b-41d4-a716-446655440000";

type RawInput = ReturnType<typeof FamilyRegistrationSchema.parse>;
function validInput(): RawInput {
  return {
    family: {
      primaryGuardianName: "Jane Doe",
      primaryEmail: "jane@example.com",
      primaryPhone: "+15555550100",
      streetAddress: "123 Main St",
      city: "Springfield",
      state: "MA",
      postalCode: "01001",
    },
    guardians: [
      {
        fullName: "Jane Doe",
        email: "jane@example.com",
        phone: "+15555550100",
        relationship: "Mother",
      },
    ],
    emergencyContact: {
      name: "Aunt Sue",
      phone: "+15555550199",
      relationship: "Aunt",
    },
    authorizedPickup: [],
    students: [
      {
        legalFirstName: "Joey",
        legalLastName: "Doe",
        dob: "2018-04-01",
        photoBytes: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        transport: {
          mode: "van" as const,
          morningStopId: SAMPLE_STOP_ID,
          afternoonStopId: SAMPLE_STOP_ID,
        },
      },
    ],
    consents: {
      typedName: "Jane Doe",
      agreed: [
        { kind: "media_release" as const,    textVersion: "v1", textHash: SAMPLE_HASH },
        { kind: "medical" as const,          textVersion: "v1", textHash: SAMPLE_HASH },
        { kind: "transport" as const,        textVersion: "v1", textHash: SAMPLE_HASH },
        { kind: "general_liability" as const,textVersion: "v1", textHash: SAMPLE_HASH },
        { kind: "photo_release" as const,    textVersion: "v1", textHash: SAMPLE_HASH },
      ],
    },
  };
}

describe("registration schema: happy path", () => {
  it("accepts a complete valid registration", () => {
    const result = FamilyRegistrationSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });
});

describe("registration schema: phone validation", () => {
  it("accepts common phone formats", () => {
    for (const p of ["+15555550100", "(555) 555-0100", "555-555-0100", "555 555 0100"]) {
      expect(PhoneSchema.safeParse(p).success).toBe(true);
    }
  });

  it("rejects obvious nonsense", () => {
    expect(PhoneSchema.safeParse("nope").success).toBe(false);
    expect(PhoneSchema.safeParse("12").success).toBe(false);
  });
});

describe("registration schema: students", () => {
  it("rejects a student with neither dob nor age", () => {
    const input = validInput();
    input.students[0]!.dob = null;
    const result = FamilyRegistrationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "students.0.dob")).toBe(true);
    }
  });

  it("rejects van mode without a morning stop", () => {
    const input = validInput();
    input.students[0]!.transport = {
      mode: "van",
      morningStopId: null,
      afternoonStopId: SAMPLE_STOP_ID,
    };
    const result = StudentSchema.safeParse(input.students[0]);
    expect(result.success).toBe(false);
  });

  it("allows parent-only modes without stops", () => {
    const input = validInput();
    input.students[0]!.transport = {
      mode: "parent_both",
      morningStopId: null,
      afternoonStopId: null,
    };
    const result = StudentSchema.safeParse(input.students[0]);
    expect(result.success).toBe(true);
  });
});

describe("registration schema: consents", () => {
  it("requires all 5 consents", () => {
    const input = validInput();
    input.consents.agreed = input.consents.agreed.slice(0, 4);
    const result = FamilyRegistrationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("requires a typed name", () => {
    const input = validInput();
    input.consents.typedName = "";
    const result = FamilyRegistrationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a hash that isn't 64 hex chars", () => {
    const input = validInput();
    input.consents.agreed[0]!.textHash = "not-a-real-hash";
    const result = FamilyRegistrationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("registration schema: guardians", () => {
  it("requires at least one guardian", () => {
    const input = validInput();
    input.guardians = [];
    const result = FamilyRegistrationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("phone normalization", () => {
  it("normalizes 10-digit US numbers to E.164", () => {
    expect(normalizePhone("5555550100")).toBe("+15555550100");
  });

  it("normalizes 11-digit numbers starting with 1", () => {
    expect(normalizePhone("15555550100")).toBe("+15555550100");
  });

  it("strips non-digit characters before normalizing", () => {
    expect(normalizePhone("(555) 555-0100")).toBe("+15555550100");
    expect(normalizePhone("555.555.0100")).toBe("+15555550100");
    expect(normalizePhone("555 555 0100")).toBe("+15555550100");
  });

  it("handles already-formatted E.164", () => {
    expect(normalizePhone("+15555550100")).toBe("+15555550100");
  });

  it("handles international numbers by prepending +", () => {
    expect(normalizePhone("4412345678901")).toBe("+4412345678901");
  });

  it("transforms phone through the PhoneSchema", () => {
    const result = PhoneSchema.safeParse("(555) 555-0100");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("+15555550100");
    }
  });

  it("normalizes phones throughout the full registration schema", () => {
    const input = validInput();
    // Use raw formats as input (cast through unknown to bypass output types)
    const rawInput = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    (rawInput.family as Record<string, unknown>).primaryPhone = "(555) 555-0100";
    ((rawInput.guardians as Record<string, unknown>[])[0]!).phone = "555-555-0100";
    (rawInput.emergencyContact as Record<string, unknown>).phone = "555 555 0199";
    const result = FamilyRegistrationSchema.safeParse(rawInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.family.primaryPhone).toBe("+15555550100");
      expect(result.data.guardians[0]!.phone).toBe("+15555550100");
      expect(result.data.emergencyContact.phone).toBe("+15555550199");
    }
  });
});

describe("registration schema: max children", () => {
  it("rejects more than 15 children", () => {
    const input = validInput();
    const rawInput = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    (rawInput as Record<string, unknown>).students = Array.from({ length: 16 }, () =>
      JSON.parse(JSON.stringify(input.students[0]))
    );
    const result = FamilyRegistrationSchema.safeParse(rawInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("15"))).toBe(true);
    }
  });

  it("accepts exactly 15 children", () => {
    const input = validInput();
    const rawInput = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    (rawInput as Record<string, unknown>).students = Array.from({ length: 15 }, () =>
      JSON.parse(JSON.stringify(input.students[0]))
    );
    const result = FamilyRegistrationSchema.safeParse(rawInput);
    expect(result.success).toBe(true);
  });
});
