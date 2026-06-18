/**
 * Notification template renderers. Plain TS — easy to unit-test.
 * Each template returns a {subject, body} pair so the same template can
 * serve SMS (body only) and email (subject + body).
 */

export type TemplateContext = {
  guardianName: string;
  studentName: string;
  pickupTime?: string;
  stopName?: string;
  date?: string;
  statusUrl?: string;
};

export type Rendered = { subject: string; body: string };

export function dayBeforeReminder(ctx: TemplateContext): Rendered {
  const time = ctx.pickupTime ?? "your scheduled time";
  const stop = ctx.stopName ?? "your scheduled stop";
  return {
    subject: `Reminder: VBS tomorrow at ${time}`,
    body:
      `Hi ${ctx.guardianName} — quick reminder that ${ctx.studentName} ` +
      `will be picked up at ${stop} at ${time} tomorrow. ` +
      `Live status: ${ctx.statusUrl ?? ""}\n\nReply STOP to opt out.`,
  };
}

export function confirmationOnRegister(ctx: TemplateContext): Rendered {
  return {
    subject: "VBS registration confirmed",
    body:
      `Thanks, ${ctx.guardianName}! ${ctx.studentName} is registered for VBS. ` +
      `Watch ${ctx.statusUrl ?? ""} during the event for real-time status.` +
      `\n\nReply STOP to opt out.`,
  };
}

export function arrivedAtSite(ctx: TemplateContext): Rendered {
  return {
    subject: "Arrived at VBS",
    body: `${ctx.studentName} has arrived at VBS.`,
  };
}

export function checkedOut(ctx: TemplateContext): Rendered {
  return {
    subject: "Heading home",
    body: `${ctx.studentName} is on the way home.`,
  };
}

export function noShow(ctx: TemplateContext): Rendered {
  return {
    subject: "Marked no-show",
    body: `${ctx.studentName} was marked no-show this morning. Reply if this is wrong.`,
  };
}
