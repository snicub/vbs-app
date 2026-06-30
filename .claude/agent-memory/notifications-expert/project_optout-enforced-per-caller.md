---
name: optout-enforced-per-caller
description: STOP/opt-out is filtered at each send CALLER, not inside sendSms — confirmation SMS deliberately does not filter
metadata:
  type: project
---

`sendSms` (`src/lib/notifications/send.ts`) does NOT check `sms_opted_out_at`. Opt-out is enforced by each *caller*: the day-before cron (`day-before-reminder/route.ts`) and `broadcastAnnouncement` (`server-actions/announcements.ts`) both filter `sms_opted_out_at IS NULL` before calling `sendSms`.

**Why:** the registration confirmation SMS (`registerFamily` → `sendConfirmationSms`) intentionally does NOT filter — a family that just submitted the form cannot already be opted out, and texting them their own confirmation + status link is expected. Pushing the filter into `sendSms` would wrongly need an exception for this path.

**How to apply:** when auditing "is STOP respected?", check each blast/broadcast caller filters opt-out — don't expect it in `sendSms`. When adding a NEW broadcast send path, the opt-out filter is YOUR responsibility at the call site. The confirmation-on-register path is the one legitimate unfiltered send.
