import { describe, it, expect } from "vitest";
import {
  resolveDayRecordUpdate,
  type DayPlanCurrent,
  type DayPlanPatch,
} from "@/lib/day-record-plan";

const cur = (over: Partial<DayPlanCurrent> = {}): DayPlanCurrent => ({
  state: "not_started",
  mode: "van",
  morningStopId: "a1",
  afternoonStopId: "p1",
  ...over,
});

function resolve(current: Partial<DayPlanCurrent>, patch: DayPlanPatch) {
  return resolveDayRecordUpdate(cur(current), patch);
}

describe("resolveDayRecordUpdate — attendance / no-op", () => {
  it("attending-only change touches nothing else", () => {
    const r = resolve({}, { attending: false });
    expect(r).toEqual({ ok: true, updates: { attending: false } });
  });

  it("a no-op patch (same values) yields empty updates", () => {
    const r = resolve({ mode: "van", morningStopId: "a1", afternoonStopId: "p1" }, {
      mode: "van",
      morningStopId: "a1",
      afternoonStopId: "p1",
    });
    expect(r).toEqual({ ok: true, updates: {} });
  });

  it("only changed columns appear in the update", () => {
    const r = resolve({ morningStopId: "a1" }, { morningStopId: "a2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updates).toEqual({ morning_stop_id: "a2" });
  });
});

describe("resolveDayRecordUpdate — mode↔stop consistency (clears unused legs)", () => {
  it("switching to parent_both clears BOTH stops", () => {
    const r = resolve({ mode: "van" }, { mode: "parent_both" });
    expect(r).toEqual({
      ok: true,
      updates: { mode: "parent_both", morning_stop_id: null, afternoon_stop_id: null },
    });
  });

  it("parent_pickup_only keeps the morning stop, clears the afternoon", () => {
    const r = resolve({ mode: "van" }, { mode: "parent_pickup_only" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.updates.afternoon_stop_id).toBeNull();
      expect("morning_stop_id" in r.updates).toBe(false); // unchanged ("a1")
      expect(r.updates.mode).toBe("parent_pickup_only");
    }
  });

  it("parent_dropoff_only keeps the afternoon stop, clears the morning", () => {
    const r = resolve({ mode: "van" }, { mode: "parent_dropoff_only" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.updates.morning_stop_id).toBeNull();
      expect("afternoon_stop_id" in r.updates).toBe(false);
    }
  });

  it("a caller-set stop for a leg the mode uses is honored", () => {
    const r = resolve({ mode: "parent_both", morningStopId: null, afternoonStopId: null }, {
      mode: "van",
      morningStopId: "a9",
      afternoonStopId: "p9",
    });
    expect(r).toEqual({
      ok: true,
      updates: { mode: "van", morning_stop_id: "a9", afternoon_stop_id: "p9" },
    });
  });

  it("an explicit stop for a leg the new mode does NOT use is forced to null", () => {
    // Coordinator sends parent_both but also (wrongly) a morning stop → cleared.
    const r = resolve({ mode: "van" }, { mode: "parent_both", morningStopId: "a5" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updates.morning_stop_id).toBeNull();
  });

  it("clearing a stop on a non-boarded van kid is allowed (lands in needs-routing)", () => {
    const r = resolve({ state: "not_started", mode: "van" }, { morningStopId: null });
    expect(r).toEqual({ ok: true, updates: { morning_stop_id: null } });
  });
});

describe("resolveDayRecordUpdate — boarded safety (never strip the aide's authority)", () => {
  it("rejects switching a morning-boarded kid OFF the van (mode → parent_both)", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { mode: "parent_both" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("morning");
  });

  it("rejects switching a morning-boarded kid to parent_dropoff_only (drops the AM van)", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { mode: "parent_dropoff_only" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("morning");
  });

  it("ALLOWS switching a morning-boarded kid to parent_pickup_only (still rides the AM van)", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { mode: "parent_pickup_only" });
    expect(r.ok).toBe(true); // morning stop preserved; only the PM leg is dropped
    if (r.ok) expect(r.updates.afternoon_stop_id).toBeNull();
  });

  it("rejects re-pointing the morning stop while morning-boarded", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { morningStopId: "a2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("morning");
  });

  it("allows changing the OTHER leg while morning-boarded (PM not started)", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { afternoonStopId: "p2" });
    expect(r.ok).toBe(true);
  });

  it("rejects switching an afternoon-boarded kid off the PM van", () => {
    const r = resolve({ state: "van_boarded_pm", mode: "van" }, { mode: "parent_both" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("afternoon");
  });

  it("rejects re-pointing the afternoon stop while afternoon-boarded", () => {
    const r = resolve({ state: "van_boarded_pm", mode: "van" }, { afternoonStopId: "p2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("afternoon");
  });

  it("allows a morning-stop change while afternoon-boarded (AM leg already done)", () => {
    const r = resolve({ state: "van_boarded_pm", mode: "van" }, { morningStopId: "a2" });
    expect(r.ok).toBe(true);
  });

  it("the rejection message names the leg and tells the coordinator how to recover", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { mode: "parent_both" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("morning van");
      expect(r.error.toLowerCase()).toContain("undo their boarding");
    }
  });
});

describe("resolveDayRecordUpdate — deep edge cases", () => {
  it("allows an attendance change while boarded (plan untouched)", () => {
    const r = resolve({ state: "van_boarded_am", mode: "van" }, { attending: false });
    expect(r).toEqual({ ok: true, updates: { attending: false } });
  });

  it("allows re-setting a boarded leg's stop to its SAME value (no-op, not a move)", () => {
    const r = resolve(
      { state: "van_boarded_am", mode: "van", morningStopId: "a1" },
      { morningStopId: "a1" },
    );
    expect(r).toEqual({ ok: true, updates: {} });
  });

  it("rejects a same-mode edit that still moves the boarded leg's stop", () => {
    const r = resolve(
      { state: "van_boarded_pm", mode: "van" },
      { mode: "van", afternoonStopId: "p2" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("afternoon");
  });

  it("rejects pm-boarded → parent_pickup_only (drops the PM van the kid is on)", () => {
    const r = resolve({ state: "van_boarded_pm", mode: "van" }, { mode: "parent_pickup_only" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toBe("afternoon");
  });

  it("does not write `mode` when it is unchanged but stops move", () => {
    const r = resolve({ mode: "van", morningStopId: "a1" }, { mode: "van", morningStopId: "a2" });
    expect(r).toEqual({ ok: true, updates: { morning_stop_id: "a2" } });
  });

  it("a current null mode + new van mode with stops sets everything", () => {
    const r = resolve(
      { mode: null, morningStopId: null, afternoonStopId: null },
      { mode: "van", morningStopId: "a1", afternoonStopId: "p1" },
    );
    expect(r).toEqual({
      ok: true,
      updates: { mode: "van", morning_stop_id: "a1", afternoon_stop_id: "p1" },
    });
  });

  it("a van kid with no stops yet (already needs-routing) and a mode no-op is a clean no-op", () => {
    const r = resolve(
      { mode: "van", morningStopId: null, afternoonStopId: null },
      { mode: "van" },
    );
    expect(r).toEqual({ ok: true, updates: {} });
  });

  it("re-confirming parent_both (already cleared) writes nothing", () => {
    const r = resolve(
      { mode: "parent_both", morningStopId: null, afternoonStopId: null },
      { mode: "parent_both" },
    );
    expect(r).toEqual({ ok: true, updates: {} });
  });

  it("treats an unknown mode as riding no van (clears both stops), never crashes", () => {
    const r = resolve({ mode: "van", morningStopId: "a1", afternoonStopId: "p1" }, {
      mode: "weird_mode",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.updates.morning_stop_id).toBeNull();
      expect(r.updates.afternoon_stop_id).toBeNull();
    }
  });

  it("clearing the morning stop while PM-boarded is allowed (AM leg already done)", () => {
    const r = resolve(
      { state: "van_boarded_pm", mode: "van", morningStopId: "a1" },
      { morningStopId: null },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updates.morning_stop_id).toBeNull();
  });

  it("does not strand on arrived_at_site (AM offload done) — a mode change is allowed", () => {
    const r = resolve({ state: "arrived_at_site", mode: "van" }, { mode: "parent_dropoff_only" });
    expect(r.ok).toBe(true);
  });
});
