# SUPABASE SKILL

## Purpose

Expert knowledge for Supabase inside HeyCarbo and HeyAudit.

---

Always

- Respect Row Level Security.
- Reuse existing database structure.
- Prefer SQL migrations over manual changes.
- Keep Edge Functions small.
- Validate all inputs.
- Follow existing naming conventions.
- Optimize queries before adding indexes.
- Prefer server-side validation.
- Keep Storage organized.

---

Authentication

- Never bypass authentication.
- Always verify user permissions.
- Never expose service keys.
- Respect organization boundaries.

---

Database

Prefer

- reusable tables
- reusable views
- reusable functions

Avoid

- duplicated tables
- duplicated logic
- unnecessary joins

---

Edge Functions

Always

- return structured errors
- log meaningful events
- validate requests
- fail gracefully

---

Performance

Check

- indexes
- query execution
- pagination
- caching
- realtime usage

---

Security

Always verify

- RLS
- Policies
- Permissions
- Secrets
- Storage access

---

Before finishing

Ask

- Can this query be faster?
- Can this be reused?
- Can security be improved?
- Can maintenance be simplified?
