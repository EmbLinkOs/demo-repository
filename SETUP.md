# Activate reservations and invitations

The public website is usable now. **Guest registration, real email delivery and organizer login require the services below.** They have not been activated or tested against live accounts. The code does not pretend to save reservations while unconfigured, and it does not store guest details in the browser.

Confirmed date: **28 February 2027**. Capacity, time, ceremony address, organizer contact and retention deadline are still to be supplied. Website and invitation emails support French and English.

## 1. Supabase database

1. Create a Supabase project. An EU region is a practical choice for this event.
2. In SQL Editor, run the complete [migration](supabase/migrations/202610180001_graduation.sql).
3. In Database → Extensions, enable **pg_cron**. Run [retention.sql](supabase/retention.sql) in SQL Editor. Confirm the `graduation-delete-expired-guests` job exists in Cron. It closes registrations and deletes all guest records after the configured retention deadline, checked daily. Supabase backup retention is managed separately by your project settings.
4. In Authentication settings, **disable public sign-ups**: only organizers need Supabase accounts. Guest registration does not create an account.
5. In Authentication → Users, create one password-based user for each organizer (including you and your classmate). Use strong, unique passwords. Add their user UUIDs to the private allowlist in SQL Editor:

```sql
insert into public.organizers (user_id)
values ('REPLACE_WITH_ORGANIZER_AUTH_USER_UUID');
```

Repeat for the second organizer. Knowing the login URL or having an unlisted Supabase account does not grant access to guest details. Tokens stay in page memory and are discarded on reload; use Sign out when finished.

## 2. Email sender in Resend

1. Create a Resend account and verify a domain **you control**, including its required DNS records.
2. Create an API key with sending permission. Choose an invitation sender on that domain, for example `Invitations <invitations@your-domain.fr>`.
3. The Resend sandbox sender can only deliver to its permitted test recipient. It cannot be used for invitations to your whole guest list. `github.io` is not a domain you control for sender verification.

The invitation is an HTML email styled as a card, with a plain-text fallback, date, venue, party size and reference. There is no attachment or claim of a QR entry system. The reference can be searched by an organizer to check in the whole party.

## 3. Bot protection

Create a Cloudflare **Turnstile** widget for hostname `emblinkos.github.io`. Keep its secret key private; the site key is public. The server verifies the challenge and its hostname before accepting a registration. This helps protect the public form and email sender from automated submissions.

## 4. Deploy the Edge Function

Install the Supabase CLI using its supported installation method, log in, and deploy from the repository root:

```sh
supabase functions deploy reservations --project-ref YOUR_PROJECT_REF
```

The checked-in `supabase/config.toml` sets `verify_jwt = false` for the public form. Organizer actions separately validate a Supabase access token and private organizer membership. Do not remove those checks.

In **Supabase → Edge Functions → Secrets**, securely enter:

| Name                   | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `RESEND_API_KEY`       | Your private Resend sending key                                       |
| `INVITATION_FROM`      | Your verified sender, e.g. `Invitations <invitations@your-domain.fr>` |
| `TURNSTILE_SECRET_KEY` | Your private Turnstile secret                                         |
| `TURNSTILE_HOSTNAME`   | `emblinkos.github.io`                                                 |
| `ALLOWED_ORIGIN`       | `https://emblinkos.github.io` (no trailing slash or path)             |

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function automatically. The service-role key must **never** appear in public `config.js`, a commit, browser code, screenshots or chat. These secrets belong in Supabase, not in this cloud environment's proxy-secret settings.

## 5. Connect the public website

Fill in the **public values only** in [config.js](config.js):

```js
window.EVENT_CONFIG = Object.freeze({
  apiUrl: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/reservations",
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY",
  turnstileSiteKey: "YOUR_PUBLIC_TURNSTILE_SITE_KEY",
});
```

The anon/publishable key is intentionally public. Guest tables and SQL reservation functions are inaccessible to anonymous and ordinary authenticated clients. Only the server function uses the service role.

Commit and push the public configuration to `main`. GitHub Pages deploys the updated files automatically. If the domain changes, update `ALLOWED_ORIGIN`, the Turnstile allowed hostname and `TURNSTILE_HOSTNAME` too.

## 6. Configure and open registration

1. Visit the site's **Espace organisation / Organizer area** and sign in with an allowlisted organizer account.
2. Set the valid ceremony date, actual venue/address, total capacity, party size limit, contact email, and deletion deadline. Time is optional until confirmed; invitations explicitly say when the time is unconfirmed. Capacity counts **all people**, including the person making the reservation.
3. Write privacy notices in **both languages**, identifying the student organizers and contact address, why details are collected, who has access, the exact retention date, and how people can request access/correction/deletion. Obtain the school's agreement before presenting the event as official or opening it to guests. The initial public page identifies itself as a student project.
4. Test with registration briefly opened to your known test recipients. Verify a reservation in the dashboard, the received email in both languages, the correct total of places, check-in, cancellation, and an email retry. Delete test records afterward.
5. Open registration to guests only after these live checks pass. Never send real invitations with an unconfirmed capacity or placeholder venue. The database refuses to open registration without the required settings and keeps the seat allocation atomic.

## Organizer operations

- One reservation per email. Repeated submissions do not consume extra places or trigger repeated invitations. Public duplicate responses do not disclose existing guest details.
- A party cannot reserve more places than the configured party limit or remaining capacity.
- Cancelling a reservation releases all its places; a cancelled reservation cannot check in. The original email remains in the record, so reactivation/changes should go through the organizers rather than repeated public submissions.
- Check-in applies to **the entire party**, not individual guests.
- If Resend fails, the reservation remains saved and the visitor receives a reference. The dashboard shows the failed/pending invitation; use **Retry email** after fixing delivery. Email retries use an atomic claim and Resend idempotency key. Only pending/failed invitations can be retried; sent invitations are not resent by the UI.
- Cancellation does not send another email automatically. Tell the affected guest when appropriate.
- Search by name, email or reference. Export CSV for your working list; treat exports as personal data and delete them by the retention deadline. Spreadsheet formula characters are neutralized in exports.
- Use **Delete** to remove a guest's reservation and personal details on request. This cannot recall an email already delivered or delete downloaded CSV files. Provider logs/backups have their own retention settings.

## Verified development checks

Static HTML checks (same image as the existing repository workflow):

```sh
docker run --rm -v "$PWD:/github/workspace:ro" -e INPUT_DIRECTORY=/github/workspace anishathalye/proof-html:1.1.0
```

Function type check and unit/HTTP tests (provider responses simulated; no real email sent):

```sh
deno check supabase/functions/reservations/index.ts
deno test --allow-env tests/core_test.ts tests/handler_test.ts
```

Database integration tests **only against a disposable local container**, never your Supabase production project:

```sh
docker run --detach --rm --name polytech-db-check -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
# Wait until: docker exec polytech-db-check pg_isready -U postgres
python3 tests/database.py
docker stop polytech-db-check
```

No database port is published; trust authentication is only for this disposable local test. Each test run needs a fresh container.

Browser interaction checks with Playwright Core and Chromium (install tools outside the checkout if preferred):

```sh
npm install --prefix /tmp/polytech-tools --package-lock=false playwright-core
# Start the local website server in a second terminal.
PLAYWRIGHT_MODULE=/tmp/polytech-tools/node_modules/playwright-core/index.mjs node tests/browser.mjs
```

`CHROMIUM_PATH` and `TEST_BASE_URL` can override the browser path and local server address. These checks exercise language switching, personalized previews, closed registration, mobile navigation and overflow, and organizer login configuration. Real Supabase/Resend delivery remains a separate activation check.
