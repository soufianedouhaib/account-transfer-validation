# Account Transfer Validation console

A browser front end for the Opus workflow **Account Transfer Validation**
(`471f6915-8b0d-43ed-8d11-fdc226d48abc`). An advisor uploads a transfer packet,
the workflow runs, and the console shows the in good order or not in good order
decision, the reasons, the plain English explanation and what was read from the
documents.

The browser never talks to Opus. The service key lives on the server and the
server is the only thing that calls out.

## Shape

```
server.js          Express app, exports `app`. Holds the key. All /api routes.
api/index.js       module.exports = require('../server')   <- the Vercel entry point
lib/opus.js        the only file that calls Opus. Variable ids live here as constants.
lib/store.js       optional history storage, KV REST or Redis over TCP
lib/auth.js        the seven demo accounts, roles, and the signed session cookie
public/            eight pages, one script per page, one stylesheet
public/samples/    three sample packets, so a tester needs no file of their own
vercel.json        rewrites /api/(.*) to /api/index.js
```

## Who can do what

| Role | Sign in at | Can |
|---|---|---|
| Employee | `/login.html` | Submit a packet, see and open only their own runs |
| Manager | `/review-login.html` | Work the transfer requests, open any case, read the packet, approve, send back or reject with a note, filter by period, export CSV, see the report |
| Administrator | `/review-login.html` | Everything a manager can do, submit packets, and see the workflow, deployment and account settings |

Seven demo accounts, seeded in `lib/auth.js`:

| Name | Email | Role | Password |
|---|---|---|---|
| Amelia Grant | employee1@aaico.demo | Employee | Employee1-2026 |
| Daniel Osei | employee2@aaico.demo | Employee | Employee2-2026 |
| Priya Raman | employee3@aaico.demo | Employee | Employee3-2026 |
| Tomas Wexler | employee4@aaico.demo | Employee | Employee4-2026 |
| Hana Suzuki | manager1@aaico.demo | Manager | Manager1-2026 |
| Marcus Bell | manager2@aaico.demo | Manager | Manager2-2026 |
| Nadia Farouk | admin@aaico.demo | Administrator | Admin-2026 |

Each door lists its own accounts, and one click fills the email and the
password. The employee door never shows a manager or admin account.

Replace the whole set without touching code by setting `APP_USERS`:

```
APP_USERS="a@firm.com|advisor|secret|Ana Diaz, r@firm.com|reviewer|secret|Rob Lee"
```

Format is `email|role|password|display name`, comma or newline separated, role
one of advisor, reviewer, admin. Once `APP_USERS` is set the demo box disappears
by itself. Passwords are hashed with scrypt at boot and compared in constant
time; they are never written to storage.

Sessions are a signed cookie, HttpOnly, SameSite Lax, twelve hours, with no
session table to keep. Set `SESSION_SECRET` to a long random string in the
project environment: without it the app derives a key from the service key,
which works but means rotating the service key signs everyone out.

Plain HTML, CSS and ES5 flavoured JavaScript in `public/`. No bundler, no
framework, no build step.

## The workflow contract

Read from the live workflow, version 3, on 17 September 2026.

| Piece | Value |
|---|---|
| Base URL | `https://operator.opus.com/api/v1` |
| Auth header | `x-service-key` |
| Input | `workflow_input_rzn32jqyr`, type `file`, "Submitted Docs" |
| Output | `workflow_output_19c3j6l3b`, type `object`, "Assembled Result" |
| Output | `workflow_output_0pk3ch2zt`, type `json_string`, "Explanation" |
| Output | `workflow_output_2p2xhf3ys`, type `str`, "Assembled Error" |

Call sequence: `POST /file/upload/presigned` for a slot, `PUT` the bytes to the
presigned URL, `POST /case`, `POST /case/{id}/execute`, poll
`GET /case/{id}/status`, then `GET /case/{id}/results`. Results answer `202`
until the case reaches a terminal status.

All of that is in `lib/opus.js`. If the workflow changes, the variable ids at
the top of that file are the only thing to edit.

## Deploying to Vercel

1. Push these files to the repository.
2. Project settings, Environment Variables, add `OPUS_SERVICE_KEY`. Nothing else
   is required; the base URL and the workflow id have working defaults.
3. Redeploy. **Environment changes never reach an existing build.** Adding a
   variable or connecting a store does nothing at all until the next deploy.
4. Open `/api/health`. It reports which variables are missing and whether
   history storage is reachable.

### History storage, optional

Connect a KV or Upstash Redis store to the project, then redeploy. Vercel injects
the credentials with a project prefix, for example `MYSTORE_KV_REST_API_URL`, so
`lib/store.js` matches them **by suffix** and supports both the REST pair
(`*_KV_REST_API_URL` and `*_KV_REST_API_TOKEN`) and a TCP `*_REDIS_URL`.

Without a store the console still validates packets. It says history is not
switched on, and nothing is kept between visits.

### Uploads

The browser uploads straight to the presigned URL, which keeps large files out
of the serverless function. If the storage bucket refuses the page's origin, the
upload falls back through `PUT /api/upload-proxy`, which caps at 4 MB because a
serverless request body cannot carry the full 10 MB that Opus allows. Both paths
are exercised in the local harness.

## Running it locally

```bash
npm install
OPUS_SERVICE_KEY=... npm start     # http://localhost:3000
```

## What each screen does

- **New validation**, employees and the admin. Drop a packet in, or load one of
  three sample packets with one click: an unsigned IRA at $95,000, a signed
  joint account at $1,284,500, and an account in a second currency at
  AED 4,120,000.
- **Transfer requests**, managers and the admin. Every finished run, filtered by
  this month, last month, a named month or a custom range, with a CSV export
  that honours the same range.
- **All runs** and **My runs**. The same list scoped to the person looking.
- **Report**, managers and the admin. Approved against rejected amounts by month,
  with the same period controls, a legend, direct labels, a tooltip on every
  bar and the same figures as a table. Amounts are grouped by the currency they
  were printed in; adding dirhams to dollars would be a lie, so the chart shows
  one currency at a time and offers a switch when more than one is present.
- **Settings**. Theme and the support contact for everyone who can reach it;
  the workflow, deployment and account roster for the admin only.

### The chart palette

Two series, so two categorical hues: the brand blue for approved, orange for
rejected. Never green against red, which is the pair most people with colour
vision deficiency cannot separate, on a chart that is about money. The pair was
checked with the data visualisation validator and passes the lightness band,
chroma floor, colour vision separation and contrast in both light and dark. Dark
mode uses a slightly deeper blue, because the brand blue is too light to sit on
a dark card.

### Contacting Opus support

Every screen has a support link, and the failure states repeat it. The email
opens with the workflow id in the subject, and the body prefilled with the case
id, the run status and the time. Set `SUPPORT_EMAIL` to change the address; it
defaults to `support@opus.com`.

## Review and privacy behaviour

- Advisors are scoped by owner, and a case belonging to someone else answers
  `404`, never `403`, so the list cannot be used to probe for other people's
  work.
- A social security number is masked at the last moment before rendering, in
  findings text, in the advisor explanation and in the extracted fields. The
  workflow quotes firm records verbatim, so the masking cannot be left to it.
- Raw workflow output and the copy JSON button are reviewer tools and are not
  rendered for advisors.
- The submitted packet is fetched server side with the service key and streamed
  to the browser, so a reviewer never needs a sign in of their own to read it.
- A decision needs a note unless it is an approval, and a run that never
  finished is kept out of the waiting count rather than being offered for
  approval.

## Notes worth keeping

- `toRow()` in `server.js` is the single projection from a stored record to an
  API row. Every screen reads it, so every screen agrees.
- Money is stored both ways: the printed string exactly as the workflow produced
  it (`submittedValue`), plus the parsed `valueAmount` and `valueCurrency`.
  Screens display the printed string, so a non dollar currency still reads right.
- A record the caller may not see answers `404`, never `403`.
- Every Opus response is read as text and then parsed. A platform 413, 502 or
  crash returns an HTML error page, and a bare `res.json()` would throw a parse
  error that hides the status code.
- The stylesheet carries `[hidden] { display: none !important; }` on purpose.
  `[hidden]` is only `display: none` in the user agent sheet, so any author rule
  that sets `display` beats it.
- Verdict colour is never the only channel. Every verdict, severity and status
  also carries a glyph and a word.
