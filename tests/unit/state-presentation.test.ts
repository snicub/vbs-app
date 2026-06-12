import { describe, it, expect } from "vitest";
import {
  STATE_PRESENTATION,
  TONE_CLASSES,
  ANOMALY_PRESENTATION,
  ANOMALY_TONE_CLASSES,
  MEDICAL_PRESENTATION,
  ALLERGY_PRESENTATION,
  presentationFor,
  toneFor,
} from "@/lib/state-presentation";
import { STATES } from "@/lib/events/state-machine";

const ANOMALY_KINDS = [
  "late_am",
  "boarded_but_not_arrived",
  "in_but_not_out",
  "pm_van_stuck",
] as const;

describe("state-presentation: state coverage", () => {
  it("has presentation for every DayState", () => {
    for (const state of STATES) {
      expect(STATE_PRESENTATION[state]).toBeDefined();
      expect(STATE_PRESENTATION[state].label).toBeTruthy();
      expect(STATE_PRESENTATION[state].description).toBeTruthy();
      expect(STATE_PRESENTATION[state].icon).toBeDefined();
      expect(STATE_PRESENTATION[state].tone).toBeTruthy();
    }
  });

  it("every tone listed on a state has classnames defined", () => {
    for (const state of STATES) {
      const tone = STATE_PRESENTATION[state].tone;
      expect(TONE_CLASSES[tone]).toBeDefined();
      expect(TONE_CLASSES[tone].badge).toBeTruthy();
      expect(TONE_CLASSES[tone].stripe).toBeTruthy();
      expect(TONE_CLASSES[tone].dot).toBeTruthy();
      expect(TONE_CLASSES[tone].icon).toBeTruthy();
    }
  });

  it("presentationFor and toneFor agree", () => {
    for (const state of STATES) {
      expect(presentationFor(state)).toBe(STATE_PRESENTATION[state]);
      expect(toneFor(state)).toBe(STATE_PRESENTATION[state].tone);
    }
  });

  it("terminal-safe (home) uses a different tone than no-show", () => {
    expect(STATE_PRESENTATION.home.tone).not.toBe(
      STATE_PRESENTATION.marked_no_show.tone,
    );
  });

  it("the two on-van states get distinct visual tones from at-VBS", () => {
    // Drivers/aides must distinguish "on van" from "at site" at a glance.
    expect(STATE_PRESENTATION.van_boarded_am.tone).not.toBe(
      STATE_PRESENTATION.site_checked_in.tone,
    );
  });
});

describe("state-presentation: anomaly coverage", () => {
  it("has presentation for every anomaly kind", () => {
    for (const kind of ANOMALY_KINDS) {
      const p = ANOMALY_PRESENTATION[kind];
      expect(p).toBeDefined();
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.icon).toBeDefined();
      expect(["warn", "critical"]).toContain(p.tone);
    }
  });

  it("each critical anomaly has a DIFFERENT icon (so coordinators can tell them apart)", () => {
    const criticalIcons = ANOMALY_KINDS.filter(
      (k) => ANOMALY_PRESENTATION[k].tone === "critical",
    ).map((k) => ANOMALY_PRESENTATION[k].icon);
    const unique = new Set(criticalIcons);
    expect(unique.size).toBe(criticalIcons.length);
  });

  it("anomaly tone classes cover both tones", () => {
    expect(ANOMALY_TONE_CLASSES.warn.badge).toBeTruthy();
    expect(ANOMALY_TONE_CLASSES.critical.badge).toBeTruthy();
  });
});

describe("state-presentation: safety callouts", () => {
  it("medical and allergy each have label, icon, and container styling", () => {
    expect(MEDICAL_PRESENTATION.label).toBeTruthy();
    expect(MEDICAL_PRESENTATION.icon).toBeDefined();
    expect(MEDICAL_PRESENTATION.containerClass).toBeTruthy();
    expect(ALLERGY_PRESENTATION.label).toBeTruthy();
    expect(ALLERGY_PRESENTATION.icon).toBeDefined();
    expect(ALLERGY_PRESENTATION.containerClass).toBeTruthy();
  });

  it("medical and allergy use different tokens (so they're visually distinct)", () => {
    expect(MEDICAL_PRESENTATION.cssVar).not.toBe(ALLERGY_PRESENTATION.cssVar);
  });
});
