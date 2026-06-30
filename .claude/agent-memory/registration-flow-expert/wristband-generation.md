---
name: wristband-generation
description: Wristband code generation/validation constraints — 32-char alphabet, checksum weights, DB format regex wider than alphabet
metadata:
  type: project
---

`src/lib/wristband/`:
- Alphabet (`alphabet.ts`): `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — exactly 32 chars, excludes 0/O/1/I/l. Module throws at import if length != 32 (checksum math depends on base-32). Locked.
- Code = 4 random payload chars + 1 checksum char (`generate.ts`), 5 total. Uses `crypto.getRandomValues` when available, else Math.random fallback.
- Checksum (`checksum.ts`): weighted modular sum, weights `[7,11,13,17]`, mod 32. Single-char typo flips it.
- Collision handling: NOT pre-checked. `registerFamily` retries up to 16x on DB unique-violation (23505). `students_wristband_code_uidx` is the authoritative gate.

**DB format regex is wider than the generator alphabet:** the `students_wristband_code_format` CHECK is `^[A-Z2-9]{5}$`, which permits I and O (which the alphabet excludes) and `2-9` plus all A-Z. This is harmless for app inserts (the generator only emits alphabet chars) but means the DB alone wouldn't reject a hand-crafted code containing I/O. Not a bug today; note if ever exposing manual code entry as a writer.

`validateWristbandCode` (table check-in side) upper-cases, strips whitespace/dashes, then checks length → charset (against the real 32-char alphabet) → checksum. Deliberately does NOT map O→0 or I→1 (those can't be valid).
