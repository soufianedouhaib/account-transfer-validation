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
public/            three pages, one script per page, one stylesheet
vercel.json        rewrites /api/(.*) to /api/index.js
```

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
