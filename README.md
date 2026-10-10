# FLEET run diagnostics

Written by the server (DiagnosticsSyncService), not by hand.

- `runs/YYYY-MM-DD.jsonl.gz` — sanitized run export for that UTC day (same format as Diagnostics → Download), refreshed a few minutes after runs finish and every two hours.
- `summary-7d.json` — the Diagnostics page summary for the last 7 days.

No screenshots. Emails, phone numbers, long digits and URL query values are scrubbed; screen text and notification text can still appear.
