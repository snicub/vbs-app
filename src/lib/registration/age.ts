/**
 * Whole years from a date of birth to a reference date (default: today),
 * matching the born-month/day-not-yet-reached-this-year → minus-one rule used
 * by `ageFor` in the paper failsafe. Pure so the signup form can auto-fill the
 * age field from DOB and so it can be unit-tested.
 *
 * Returns null for blank / unparseable / future DOB — the caller treats null as
 * "leave the age field alone", so a typo never silently overwrites a real age.
 */
export function ageFromDob(dobIso: string, todayIso: string): number | null {
  if (!dobIso) return null;
  const born = new Date(dobIso + "T00:00:00");
  const ref = new Date(todayIso + "T00:00:00");
  if (Number.isNaN(born.getTime()) || Number.isNaN(ref.getTime())) return null;
  if (born.getTime() > ref.getTime()) return null;
  let age = ref.getFullYear() - born.getFullYear();
  const m = ref.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Best-available age for display: the explicit registration age if stored, else
 * derived from dob as of the reference date. Returns null when neither is known.
 */
export function ageFor(
  student: { ageAtRegistration: number | null; dob: string | null },
  on: string,
): number | null {
  if (student.ageAtRegistration != null) return student.ageAtRegistration;
  if (!student.dob) return null;
  return ageFromDob(student.dob, on);
}
