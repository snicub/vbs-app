import "server-only";
import { env } from "./env";

export function getLocalDate(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: env.APP_TIMEZONE });
}

export function getLocalTomorrow(): string {
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
