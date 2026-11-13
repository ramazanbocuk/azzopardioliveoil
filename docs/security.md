# Security notes

What is in place, how it is checked, and what is knowingly missing. This is a developer's review, not an independent penetration test.

## In place

| Area | Measure | Checked by |
|---|---|---|
| Passwords | Argon2id (19 MiB, 2 passes), 12-character minimum, never logged or returned | Unit + integration tests |
| Sessions | Random 256-bit tokens, stored only as SHA-256 hashes; HttpOnly, SameSite cookies, Secure in production; 30 days for customers, 12 hours for staff; expired sessions purged | Integration tests |
| Sign-in | Same error for wrong password and unknown email; equal timing; rate limits per address and per account | Integration tests |
| Password reset | Signed link, valid one hour, dies when the password changes, signs out every device; same answer for known and unknown emails | Integration tests |
| Authorization | Every customer resolver and every admin service checks the session and role on the server | Integration tests per role |
| Admin separation | Separate cookie (SameSite=Strict), separate schema and endpoint; a customer session is not an admin session | Integration + browser tests |
| Cross-site requests | API accepts only same-origin POSTs with a JSON content type; server actions are origin-checked by Next.js | Integration + browser tests |
| Injection | All queries go through Prisma or tagged raw SQL with bound parameters; no string-built SQL | Integration test with hostile input |
| XSS | React escapes output; emails escape customer text; CSV exports neutralise spreadsheet formulas | Unit + integration tests |
| Payments | Card data never reaches this server; webhook signature verified on the raw body; amount must match the order; each event applied once | Integration tests with real signature maths |
| Stock | Reserved by a conditional update, so two buyers cannot take the last bottle | Concurrent integration test |
| Rate limiting | PostgreSQL-backed counters on sign-in, registration, reset, checkout, order lookup, lot lookup, contact, newsletter | Integration tests |
| API hardening | Query depth limit, 64 KB body limit, introspection off in production, internal errors never returned | Integration tests |
| Headers | CSP (no third-party origins), HSTS, nosniff, frame denial, referrer and permissions policies; no-referrer on pages with tokens in the address; admin never cached | Unit + browser tests |
| Audit | Staff changes, exports, sign-ins, erasures and payment mismatches are recorded | Integration tests |
| GDPR | Customer can download their data and delete their account; administrators can erase on request; newsletter is double opt-in; only strictly necessary cookies | Integration tests |
| Dependencies | `npm audit --omit=dev` reports 0 known vulnerabilities (12 Nov 2026) | Manual |

A review of the whole application was done on 2026-11-19; its checklist and results are in `production-readiness.md`. It was not an independent test.

## Known gaps

1. **Two-factor sign-in is compulsory for staff in production** (see `markets.md`). It uses authenticator-app codes only: there are no hardware keys or passkeys, and no recovery codes. A lost phone is reset by an administrator, or from the server with `npm run admin:set-password`.
2. **CSP allows inline scripts.** Statically rendered pages cannot carry a per-request nonce. The policy still blocks all third-party script origins, framing and plugins.
3. **Rate limits are per IP address** as reported by the proxy header. Behind a host that does not set `x-forwarded-for` correctly they would be shared or bypassable; verify at deployment.
4. **No account lockout notification or new-device email.**
5. **Email verification is not required** to create an account.
6. **Admin sessions are not invalidated when a role changes** (only on deactivation); they expire within 12 hours.
7. **Secrets live in environment variables**; there is no rotation procedure yet (Phase 9).
8. **Backups, monitoring and alerting** do not exist yet (Phase 9).
9. **No independent penetration test, load test or legal review** has been done.
10. **Order link tokens appear in the address bar.** They are scoped to one order and protected by a no-referrer policy, but can remain in browser history.

## Reporting

There is no `security.txt` yet. Add one with a contact address before launch.
