import "server-only";
import { env } from "./env";

export function getLocalDate(date: Date = new Date()): string {
  // A fixed override wins over the wall clock (run/prep a day early). See env.ts.
  if (env.APP_TODAY_OVERRIDE) return env.APP_TODAY_OVERRIDE;
  return date.toLocaleDateString("en-CA", { timeZone: env.APP_TIMEZONE });
}

export function getLocalTomorrow(): string {
  if (env.APP_TODAY_OVERRIDE) {
    const d = new Date(env.APP_TODAY_OVERRIDE + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: env.APP_TIMEZONE });
}

export function formatLocalTime(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" },
): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: env.APP_TIMEZONE,
    ...opts,
  });
}
