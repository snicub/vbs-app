/** True for a 6-digit hex color like `#1a2b3c` (what `<input type="color">` emits). */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}
