/**
 * Group van riders by street, then house number, so kids on the same road (and
 * same house — siblings) sit together on the driver's live list: a natural
 * door-to-door pickup order. Parses the street portion (before the first comma)
 * of a home address into a lowercased street name + its leading house number.
 * Riders with no address sort last.
 */
export type StreetKey = { street: string; houseNumber: number };

export function streetSortKey(address: string | null | undefined): StreetKey {
  if (!address || !address.trim()) {
    return { street: "￿", houseNumber: Number.POSITIVE_INFINITY };
  }
  const line = address.split(",")[0]!.trim().toLowerCase();
  const tokens = line.split(/\s+/);
  const first = tokens[0] ?? "";
  // First token is a house number if it starts with a digit or "#".
  const isNumberToken = /^[#\d]/.test(first);
  const digits = first.match(/\d+/);
  const houseNumber = isNumberToken && digits ? Number(digits[0]) : Number.POSITIVE_INFINITY;
  const street = (isNumberToken ? tokens.slice(1).join(" ") : line).trim() || line;
  return { street, houseNumber };
}

/** Comparator: same street clusters together, ordered by house number. */
export function compareByStreet(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ka = streetSortKey(a);
  const kb = streetSortKey(b);
  if (ka.street !== kb.street) return ka.street.localeCompare(kb.street);
  return ka.houseNumber - kb.houseNumber;
}
