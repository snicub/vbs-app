/**
 * Bus capacity overflow detection — pure aggregation logic over the
 * morning/afternoon_van_id columns from student_day_status.
 *
 * Mirrors the math in /coordinator/vans/page.tsx and the
 * day-before-reminder capacity check.
 */
import { describe, it, expect } from "vitest";

type StatusRow = {
  student_id: string;
  morning_van_id: string | null;
  afternoon_van_id: string | null;
};

function countRiders(
  rows: StatusRow[],
): { am: Map<string, number>; pm: Map<string, number> } {
  const am = new Map<string, number>();
  const pm = new Map<string, number>();
  for (const r of rows) {
    if (r.morning_van_id) am.set(r.morning_van_id, (am.get(r.morning_van_id) ?? 0) + 1);
    if (r.afternoon_van_id) pm.set(r.afternoon_van_id, (pm.get(r.afternoon_van_id) ?? 0) + 1);
  }
  return { am, pm };
}

function findOver(
  vans: { id: string; capacity: number }[],
  am: Map<string, number>,
  pm: Map<string, number>,
): { vanId: string; direction: "AM" | "PM"; over: number }[] {
  const out: { vanId: string; direction: "AM" | "PM"; over: number }[] = [];
  for (const v of vans) {
    const amCount = am.get(v.id) ?? 0;
    const pmCount = pm.get(v.id) ?? 0;
    if (amCount > v.capacity) out.push({ vanId: v.id, direction: "AM", over: amCount - v.capacity });
    if (pmCount > v.capacity) out.push({ vanId: v.id, direction: "PM", over: pmCount - v.capacity });
  }
  return out;
}

describe("capacity overflow detection", () => {
  it("counts AM and PM separately for a kid on different vans each direction", () => {
    const { am, pm } = countRiders([
      { student_id: "s1", morning_van_id: "v1", afternoon_van_id: "v2" },
    ]);
    expect(am.get("v1")).toBe(1);
    expect(pm.get("v2")).toBe(1);
    expect(am.get("v2") ?? 0).toBe(0);
    expect(pm.get("v1") ?? 0).toBe(0);
  });

  it("counts a kid on the same van both ways as 1 AM + 1 PM", () => {
    const { am, pm } = countRiders([
      { student_id: "s1", morning_van_id: "v1", afternoon_van_id: "v1" },
    ]);
    expect(am.get("v1")).toBe(1);
    expect(pm.get("v1")).toBe(1);
  });

  it("ignores nulls (parent_both kids)", () => {
    const { am, pm } = countRiders([
      { student_id: "s1", morning_van_id: null, afternoon_van_id: null },
    ]);
    expect(am.size).toBe(0);
    expect(pm.size).toBe(0);
  });

  it("flags overcapacity vans only", () => {
    const rows: StatusRow[] = [];
    for (let i = 0; i < 16; i++) {
      rows.push({ student_id: `s${i}`, morning_van_id: "v1", afternoon_van_id: "v1" });
    }
    for (let i = 0; i < 10; i++) {
      rows.push({ student_id: `t${i}`, morning_van_id: "v2", afternoon_van_id: "v2" });
    }
    const { am, pm } = countRiders(rows);
    const over = findOver(
      [
        { id: "v1", capacity: 14 },
        { id: "v2", capacity: 14 },
      ],
      am,
      pm,
    );
    // v1 is over (16 in 14-seat) AM and PM. v2 is fine.
    expect(over).toEqual([
      { vanId: "v1", direction: "AM", over: 2 },
      { vanId: "v1", direction: "PM", over: 2 },
    ]);
  });

  it("returns empty when every van is at or under capacity", () => {
    const { am, pm } = countRiders([
      { student_id: "s1", morning_van_id: "v1", afternoon_van_id: "v1" },
    ]);
    const over = findOver([{ id: "v1", capacity: 14 }], am, pm);
    expect(over).toEqual([]);
  });

  it("treats exactly capacity as NOT over", () => {
    const rows: StatusRow[] = [];
    for (let i = 0; i < 14; i++) {
      rows.push({ student_id: `s${i}`, morning_van_id: "v1", afternoon_van_id: null });
    }
    const { am, pm } = countRiders(rows);
    const over = findOver([{ id: "v1", capacity: 14 }], am, pm);
    expect(over).toEqual([]);
  });
});
