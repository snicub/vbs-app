/**
 * Classify a Postgres error from the per-student insert. Both the wristband
 * unique index (students_wristband_code_uidx) and the per-family name+age dedup
 * indexes (students_no_dup_by_dob / students_no_dup_by_age) raise 23505, but
 * they mean opposite things:
 *
 *  - wristband collision  → two signups generated the same code; REGENERATE and
 *    retry (the code is random, the conflict is transient).
 *  - name+age duplicate   → this child is already registered in the family;
 *    retrying is futile — fail fast with a clear message (don't burn 16 retries
 *    and abort mid-chain).
 *
 * We distinguish by which constraint fired, checking BOTH the message (carries
 * the constraint/index name) and the details (carries the conflicting column,
 * e.g. "Key (wristband_code)=..."), so a future index rename or a PostgREST
 * change to which field surfaces the name can't silently invert the branch.
 */

export type StudentInsertOutcome = "retry_wristband" | "duplicate_child" | "fatal";

export type DbInsertError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export function classifyStudentInsertError(error: DbInsertError): StudentInsertOutcome {
  if (error.code !== "23505") return "fatal";
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (haystack.includes("wristband")) return "retry_wristband";
  return "duplicate_child";
}
