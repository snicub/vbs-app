import { describe, it, expect } from "vitest";
import { classifyStudentInsertError } from "@/lib/registration/insert-error";

describe("classifyStudentInsertError", () => {
  it("retries a wristband-code collision (constraint name in message)", () => {
    expect(
      classifyStudentInsertError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "students_wristband_code_uidx"',
        details: "Key (wristband_code)=(ABC12) already exists.",
      }),
    ).toBe("retry_wristband");
  });

  it("retries when only the details mention wristband_code (message generic)", () => {
    expect(
      classifyStudentInsertError({
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: "Key (wristband_code)=(ABC12) already exists.",
      }),
    ).toBe("retry_wristband");
  });

  it("treats the name+age dedup index (by dob) as a duplicate child", () => {
    expect(
      classifyStudentInsertError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "students_no_dup_by_dob"',
        details: "Key (family_id, lower(legal_first_name), ...)=(...) already exists.",
      }),
    ).toBe("duplicate_child");
  });

  it("treats the name+age dedup index (by age) as a duplicate child", () => {
    expect(
      classifyStudentInsertError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "students_no_dup_by_age"',
      }),
    ).toBe("duplicate_child");
  });

  it("treats any non-23505 error as fatal", () => {
    expect(classifyStudentInsertError({ code: "23502", message: "null value" })).toBe("fatal");
    expect(classifyStudentInsertError({ code: "23503", message: "fk violation" })).toBe("fatal");
  });

  it("treats a missing/unknown code as fatal", () => {
    expect(classifyStudentInsertError({})).toBe("fatal");
    expect(classifyStudentInsertError({ code: null })).toBe("fatal");
  });

  it("is case-insensitive on the constraint text", () => {
    expect(
      classifyStudentInsertError({
        code: "23505",
        message: 'violates unique constraint "STUDENTS_WRISTBAND_CODE_UIDX"',
      }),
    ).toBe("retry_wristband");
  });

  it("defaults an unattributable 23505 to duplicate_child (never an infinite wristband retry)", () => {
    // If neither message nor details mention wristband, we must NOT keep
    // regenerating forever — fail fast as a probable duplicate.
    expect(classifyStudentInsertError({ code: "23505" })).toBe("duplicate_child");
    expect(classifyStudentInsertError({ code: "23505", message: "", details: "" })).toBe(
      "duplicate_child",
    );
  });

  it("tolerates null message/details fields", () => {
    expect(
      classifyStudentInsertError({ code: "23505", message: null, details: null }),
    ).toBe("duplicate_child");
  });

  it("matches wristband even when the substring is mid-token (column form)", () => {
    expect(
      classifyStudentInsertError({
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: "Key (wristband_code)=(7H2KQ) already exists.",
      }),
    ).toBe("retry_wristband");
  });
});
