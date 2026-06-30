---
name: status-link-delivery
description: The parent status URL (/parent/<token>) reaches families via the confirmation SMS ONLY; the day-before family reminder cron that once looked like a backstop is now DELETED.
metadata:
  type: project
---

The confirmation SMS (`confirmation_on_register`, sent by `sendConfirmationSms` in `server-actions/registration.ts`) is the SOLE parent-facing delivery of `/parent/<token>`. The send is `await`ed (a server action's runtime can freeze the instant it returns, so fire-and-forget often never reaches Twilio) and wrapped so its failure can't fail registration — it just logs to `notifications_sent`. `signup-form.tsx` still receives `familyStatusUrl` into `success` state but never renders it.

As of 2026-06-18 the day-before FAMILY reminder cron was REMOVED entirely (route + `dayBeforeReminder` template + its test all deleted). It used to LOOK like a second delivery of the link but never worked (empty `statusUrl`). So there is now exactly ONE delivery of the status link, and no family-facing scheduled message at all.

So today there is no working second delivery of the status link. If the confirmation SMS fails (Twilio reject) or no creds (dev), the parent gets no link at all. The link still lives in `notifications_sent.body` (coordinator can recover it manually).

**Why:** caregiver-friendly signup simplification trimmed the success screen; the day-before family text was intentionally dropped in favor of a coordinator-only capacity alert (see [[project_capacity-check-cron]]).

**How to apply:** if asked to "make sure parents can always reach their status page," the fix is re-show the link on the signup success screen as the no-Twilio/failed-send fallback (registration-flow-expert owns `signup-form.tsx`). Do NOT propose reviving the day-before cron — it's gone by design. The confirmation send is intentionally unfiltered for opt-out (new family can't have opted out) — see [[project_optout-enforced-per-caller]]. Verify file/line before acting; frozen at 2026-06-18.
