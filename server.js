'use strict';

const path = require('path');
const express = require('express');
const opus = require('./lib/opus');
const store = require('./lib/store');
const auth = require('./lib/auth');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(auth.attach);
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: '5m'
  })
);

const LIST_KEY = 'atv:cases';
const OWNER_KEY = function (email) {
  return 'atv:cases:' + String(email).toLowerCase();
};
const RECORD_KEY = function (id) {
  return 'atv:case:' + id;
};
const HISTORY_CAP = 300;
const BOOTED_AT = new Date().toISOString();

/* ------------------------------------------------------------------ *
 * Projection. Every screen agrees because they all read this one map. *
 * ------------------------------------------------------------------ */

function parseMoney(printed) {
  if (printed === null || printed === undefined) return { amount: null, currency: null };
  if (typeof printed === 'number') return { amount: printed, currency: null };
  const text = String(printed).trim();
  if (!text) return { amount: null, currency: null };
  const symbol = (text.match(/^[^\d\-.,\s]+|[A-Z]{3}$/) || [null])[0];
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  const amount = cleaned === '' || isNaN(Number(cleaned)) ? null : Number(cleaned);
  return { amount: amount, currency: symbol ? String(symbol).trim() : null };
}

/**
 * The stored record for one case. Both the printed money string and its parts
 * are kept: pulling "$95,000.00" apart in the browser is guesswork the moment a
 * currency prints differently.
 */
function toRow(rec) {
  if (!rec) return null;
  const result = rec.result || {};
  const form = (result.extracted && result.extracted.form) || {};
  const audit = result.audit || {};
  const money = parseMoney(form.value);
  const review = rec.review || null;
  return {
    caseId: rec.caseId,
    title: rec.title || null,
    fileName: rec.fileName || null,
    status: rec.status || 'PENDING',
    verdict: result.status || null,
    isIgo: typeof result.is_igo === 'boolean' ? result.is_igo : null,
    decisionSummary: result.decision_summary || null,
    clientName: form.client_name || null,
    contraFirm: form.contra_firm || null,
    accountType: form.account_type || null,
    submittedValue: form.value === undefined ? null : form.value,
    valueAmount: money.amount,
    valueCurrency: money.currency,
    totalIssues: typeof audit.total_issues === 'number' ? audit.total_issues : null,
    lowConfidence: typeof audit.low_confidence === 'number' ? audit.low_confidence : null,
    createdAt: rec.createdAt || null,
    completedAt: rec.completedAt || null,
    failure: rec.failure || null,
    submittedBy: (rec.owner && rec.owner.email) || null,
    submittedByName: (rec.owner && rec.owner.name) || null,
    hasDocument: Boolean(rec.fileUrl),
    reviewState: review ? review.decision : 'pending',
    reviewNote: review ? review.note || null : null,
    reviewedBy: review ? review.by || null : null,
    reviewedByName: review ? review.byName || review.by || null : null,
    reviewedAt: review ? review.at || null : null
  };
}

function safeParseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/^﻿/, '');
  if (!text) return null;
  const fenced = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  if (start > 0) text = text.slice(start);
  const end = text.lastIndexOf('}');
  if (end !== -1 && end < text.length - 1) text = text.slice(0, end + 1);
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function shapeResults(results) {
  const out = { result: null, explanation: null, workflowError: '' };
  if (!results) return out;
  const pick = function (key) {
    const entry = results[key];
    return entry && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : null;
  };
  out.result = safeParseJson(pick(opus.OUTPUT_RESULT));
  out.explanation = safeParseJson(pick(opus.OUTPUT_EXPLANATION));
  const err = pick(opus.OUTPUT_ERROR);
  out.workflowError = typeof err === 'string' ? err : '';
  return out;
}

async function loadRecord(caseId) {
  try {
    return await store.getJson(RECORD_KEY(caseId));
  } catch (e) {
    return null;
  }
}

async function saveRecord(rec) {
  try {
    await store.setJson(RECORD_KEY(rec.caseId), rec);
    await store.pushId(LIST_KEY, rec.caseId, HISTORY_CAP);
    if (rec.owner && rec.owner.email) {
      await store.pushId(OWNER_KEY(rec.owner.email), rec.caseId, HISTORY_CAP);
    }
  } catch (e) {
    // History is a convenience. A storage outage must never fail a validation.
  }
}

/** Advisors see their own work. Reviewers and the admin see all of it. */
function maySee(user, rec) {
  if (!user || !rec) return false;
  if (auth.canReview(user)) return true;
  return Boolean(rec.owner && rec.owner.email === user.email);
}

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({
    error: (err && err.message) || 'Unexpected error',
    retryAfter: err && err.retryAfter ? err.retryAfter : undefined
  });
}

/* ------------------------------------------------------------------ *
 * Session                                                             *
 * ------------------------------------------------------------------ */

app.post('/api/login', function (req, res) {
  const body = req.body || {};
  const user = auth.authenticate(body.email, body.password);
  if (!user) {
    return res.status(401).json({ error: 'That email and password do not match an account.' });
  }
  // The reviewer page asks for a reviewer. An advisor who lands there is sent
  // to the right door rather than silently signed in to a screen they cannot use.
  if (body.expect === 'reviewer' && !auth.canReview(user)) {
    return res.status(403).json({
      error: 'That account is an advisor account. Use the advisor sign in.',
      redirect: '/login.html'
    });
  }
  if (body.expect === 'advisor' && auth.canReview(user) && user.role !== 'admin') {
    return res.status(403).json({
      error: 'That account is a reviewer account. Use the reviewer sign in.',
      redirect: '/review-login.html'
    });
  }
  auth.setCookie(req, res, auth.issue(user));
  res.json({
    signedIn: true,
    email: user.email,
    role: user.role,
    name: user.name,
    home: auth.canReview(user) ? '/review.html' : '/'
  });
});

app.post('/api/logout', function (req, res) {
  auth.clearCookie(req, res);
  res.json({ signedIn: false });
});

app.get('/api/me', function (req, res) {
  const user = req.user;
  res.json({
    signedIn: Boolean(user),
    email: user ? user.email : null,
    role: user ? user.role : null,
    roleLabel: user ? auth.ROLE_LABEL[user.role] || user.role : null,
    name: user ? user.name : null,
    canReview: auth.canReview(user),
    canSubmit: Boolean(user) && (user.role === 'advisor' || user.role === 'admin'),
    appName: 'Account Transfer Validation',
    historyEnabled: store.configured,
    configured: opus.missingEnv().length === 0,
    demoAccounts: auth.usingDefaultAccounts ? auth.demoAdvisors : []
  });
});

/* ------------------------------------------------------------------ *
 * Health                                                              *
 * ------------------------------------------------------------------ */

app.get('/api/health', async function (req, res) {
  const missing = opus.missingEnv();
  const storage = await store.ping();
  // Names only, never values: enough to tell a missing variable from a
  // misnamed one, or a stale build from a fresh one.
  const seenEnvNames = Object.keys(process.env)
    .filter(function (k) {
      return /OPUS|KV_REST|REDIS|UPSTASH|APP_USERS|SESSION_SECRET/i.test(k);
    })
    .sort();
  res.json({
    ok: missing.length === 0,
    missingEnv: missing,
    seenEnvNames: seenEnvNames,
    serviceKeyLength: (process.env.OPUS_SERVICE_KEY || '').length,
    workflowId: opus.WORKFLOW_ID,
    baseUrl: opus.BASE,
    accounts: {
      count: auth.accountCount,
      usingDefaults: auth.usingDefaultAccounts,
      sessionSecretSet: Boolean(process.env.SESSION_SECRET)
    },
    build: {
      target: process.env.VERCEL_ENV || 'local',
      deployment: process.env.VERCEL_URL || null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      startedAt: BOOTED_AT
    },
    history: {
      configured: store.configured,
      mode: store.mode,
      reachable: storage.ok,
      reason: storage.reason || null
    }
  });
});

/* ------------------------------------------------------------------ *
 * Submitting                                                          *
 * ------------------------------------------------------------------ */

function requireSubmitter(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (req.user.role === 'reviewer') {
    return res.status(403).json({ error: 'Reviewer accounts do not submit packets.' });
  }
  next();
}

/** Step 1. A presigned slot. The browser uploads straight to storage. */
app.post('/api/upload-url', requireSubmitter, async function (req, res) {
  const missing = opus.missingEnv();
  if (missing.length) {
    return res.status(503).json({ error: 'Server is not configured: ' + missing.join(', ') });
  }
  const name = String((req.body && req.body.fileName) || '').trim();
  if (!name) return res.status(400).json({ error: 'fileName is required.' });
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  const allowed = ['.pdf', '.docx', '.csv', '.xls', '.xlsx', '.txt', '.json', '.html', '.xml', '.jpeg', '.jpg', '.png'];
  if (allowed.indexOf(ext) === -1) {
    return res.status(400).json({ error: 'Unsupported file type: ' + (ext || 'no extension') });
  }
  try {
    const slot = await opus.uploadUrl(ext, name);
    res.json(slot);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Fallback upload. Used only when the browser cannot PUT to storage directly,
 * which happens when the storage bucket does not allow the page's origin.
 * Serverless request bodies are capped well below the 10 MB Opus limit, so this
 * path refuses anything large and says why.
 */
app.put(
  '/api/upload-proxy',
  requireSubmitter,
  express.raw({ type: '*/*', limit: '4mb' }),
  async function (req, res) {
    const target = String(req.query.to || '');
    const localOnly = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(target);
    if (!target || !(/^https:\/\//.test(target) || localOnly)) {
      return res.status(400).json({ error: 'A presigned https target is required.' });
    }
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Empty upload.' });
    }
    try {
      await opus.putFile(String(target), req.body, req.get('x-content-type') || 'application/octet-stream');
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  }
);

/** Step 2. Create the case and start it. */
app.post('/api/submit', requireSubmitter, async function (req, res) {
  const missing = opus.missingEnv();
  if (missing.length) {
    return res.status(503).json({ error: 'Server is not configured: ' + missing.join(', ') });
  }
  const body = req.body || {};
  const fileUrl = String(body.fileUrl || '').trim();
  const fileName = String(body.fileName || '').trim() || 'submitted-documents';
  const title = String(body.title || '').trim() || fileName;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl is required.' });

  try {
    const caseId = await opus.initiateCase(
      title,
      'Submitted by ' + req.user.email + ' through the Account Transfer Validation console.'
    );
    await opus.executeCase(caseId, fileUrl);
    const rec = {
      caseId: caseId,
      title: title,
      fileName: fileName,
      fileUrl: fileUrl,
      owner: { email: req.user.email, name: req.user.name },
      status: 'IN_PROGRESS',
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      explanation: null,
      workflowError: '',
      failure: null,
      review: null
    };
    await saveRecord(rec);
    res.json({ caseId: caseId, row: toRow(rec) });
  } catch (err) {
    sendError(res, err);
  }
});

/* ------------------------------------------------------------------ *
 * Reading one case                                                    *
 * ------------------------------------------------------------------ */

function casePayload(rec, user) {
  return {
    status: rec.status,
    terminal: Boolean(rec.result) || Boolean(rec.failure),
    row: toRow(rec),
    result: rec.result || null,
    explanation: rec.explanation || null,
    workflowError: rec.workflowError || '',
    failure: rec.failure || null,
    review: rec.review || null,
    canReview: auth.canReview(user),
    isOwner: Boolean(rec.owner && user && rec.owner.email === user.email),
    stored: store.configured
  };
}

/** Step 3. The browser polls this, never Opus. */
app.get('/api/status/:caseId', auth.requireUser, async function (req, res) {
  const caseId = String(req.params.caseId);
  const missing = opus.missingEnv();
  if (missing.length) {
    return res.status(503).json({ error: 'Server is not configured: ' + missing.join(', ') });
  }
  try {
    let rec = await loadRecord(caseId);
    // A stored case belonging to somebody else is a 404, never a 403: a 403
    // would confirm that the case exists.
    if (rec && !maySee(req.user, rec)) {
      return res.status(404).json({ error: 'No such case.' });
    }
    const status = await opus.status(caseId);
    if (!rec) {
      rec = {
        caseId: caseId,
        title: null,
        fileName: null,
        owner: { email: req.user.email, name: req.user.name },
        createdAt: null,
        completedAt: null,
        result: null,
        explanation: null,
        workflowError: '',
        failure: null,
        review: null
      };
    }
    rec.status = status;

    if (opus.isTerminal(status)) {
      if (status === 'COMPLETED') {
        const results = await opus.results(caseId);
        if (results) {
          const shaped = shapeResults(results);
          rec.result = shaped.result;
          rec.explanation = shaped.explanation;
          rec.workflowError = shaped.workflowError;
        }
      } else {
        rec.failure = 'The run ended with status ' + status + '.';
      }
      rec.completedAt = rec.completedAt || new Date().toISOString();
      await saveRecord(rec);
    }

    res.json(casePayload(rec, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

/** A stored case, straight from storage where possible. */
app.get('/api/case/:caseId', auth.requireUser, async function (req, res) {
  const caseId = String(req.params.caseId);
  try {
    const rec = await loadRecord(caseId);
    if (!rec || !maySee(req.user, rec)) {
      return res.status(404).json({ error: 'No such case.' });
    }
    res.json(casePayload(rec, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * The submitted packet, fetched server side so the reviewer never needs an Opus
 * session of their own. The service key is tried first; some file URLs are
 * presigned and reject an extra auth header, so a plain fetch is the fallback.
 */
app.get('/api/case/:caseId/document', auth.requireUser, async function (req, res) {
  const caseId = String(req.params.caseId);
  try {
    const rec = await loadRecord(caseId);
    if (!rec || !maySee(req.user, rec)) {
      return res.status(404).json({ error: 'No such case.' });
    }
    if (!rec.fileUrl) {
      return res.status(404).json({ error: 'No document was stored for this case.' });
    }

    let upstream = null;
    const attempts = [
      { 'x-service-key': process.env.OPUS_SERVICE_KEY || '' },
      {}
    ];
    for (let i = 0; i < attempts.length; i++) {
      try {
        const candidate = await fetch(rec.fileUrl, { headers: attempts[i] });
        if (candidate.ok) {
          upstream = candidate;
          break;
        }
        upstream = candidate;
      } catch (e) {
        upstream = null;
      }
    }
    if (!upstream || !upstream.ok) {
      return res.status(502).json({
        error:
          'The stored document could not be fetched' +
          (upstream ? ' (status ' + upstream.status + ')' : '') +
          '.',
        fileUrl: rec.fileUrl
      });
    }

    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader(
      'Content-Disposition',
      'inline; filename="' + String(rec.fileName || 'packet').replace(/[^\w.\- ]/g, '_') + '"'
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
});

/* ------------------------------------------------------------------ *
 * Lists                                                               *
 * ------------------------------------------------------------------ */

async function rowsFor(ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = await loadRecord(ids[i]);
    if (rec) rows.push(toRow(rec));
  }
  // Recording a decision rewrites the record, which would otherwise float that
  // run to the top of the index. Submission time is what "newest first" means.
  rows.sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return rows;
}

/** An advisor's own runs. A reviewer or admin sees everything. */
app.get('/api/history', auth.requireUser, async function (req, res) {
  if (!store.configured) {
    return res.json({ configured: false, rows: [], scope: 'none', note: 'History is not configured.' });
  }
  const limit = Math.min(Number(req.query.limit) || 50, HISTORY_CAP);
  const everything = auth.canReview(req.user) && req.query.scope !== 'mine';
  try {
    const ids = await store.listIds(everything ? LIST_KEY : OWNER_KEY(req.user.email), limit);
    res.json({
      configured: true,
      scope: everything ? 'all' : 'mine',
      rows: await rowsFor(ids)
    });
  } catch (err) {
    res.json({ configured: true, rows: [], note: 'History is unavailable: ' + err.message });
  }
});

/** The reviewer queue: every finished run, newest first. */
app.get('/api/queue', auth.requireReviewer, async function (req, res) {
  if (!store.configured) {
    return res.json({
      configured: false,
      rows: [],
      note: 'The queue needs run history. Connect a storage database and redeploy.'
    });
  }
  try {
    const ids = await store.listIds(LIST_KEY, HISTORY_CAP);
    const rows = (await rowsFor(ids)).filter(function (row) {
      return row.status === 'COMPLETED' || row.failure;
    });
    res.json({ configured: true, rows: rows });
  } catch (err) {
    res.json({ configured: true, rows: [], note: 'The queue is unavailable: ' + err.message });
  }
});

/** Approve, reject or send back. A note is required on anything but approval. */
app.post('/api/case/:caseId/review', auth.requireReviewer, async function (req, res) {
  const caseId = String(req.params.caseId);
  const body = req.body || {};
  const decision = String(body.decision || '').toLowerCase();
  const note = String(body.note || '').trim();

  if (['approved', 'rejected', 'returned'].indexOf(decision) === -1) {
    return res.status(400).json({ error: 'The decision must be approved, rejected or returned.' });
  }
  if (decision !== 'approved' && note.length < 3) {
    return res.status(400).json({ error: 'A note is required when rejecting or sending a packet back.' });
  }
  if (!store.configured) {
    return res.status(503).json({
      error: 'Decisions cannot be saved because run history is not configured.'
    });
  }

  try {
    const rec = await loadRecord(caseId);
    if (!rec) return res.status(404).json({ error: 'No such case.' });
    if (!rec.result && !rec.failure) {
      return res.status(409).json({ error: 'This run has not finished yet.' });
    }
    rec.review = {
      decision: decision,
      note: note || null,
      by: req.user.email,
      byName: req.user.name,
      at: new Date().toISOString()
    };
    await saveRecord(rec);
    res.json({ review: rec.review, row: toRow(rec) });
  } catch (err) {
    sendError(res, err);
  }
});

app.use('/api', function (req, res) {
  res.status(404).json({ error: 'No such endpoint: ' + req.method + ' ' + req.path });
});

module.exports = app;
module.exports.toRow = toRow;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, function () {
    // eslint-disable-next-line no-console
    console.log('Account Transfer Validation console on http://localhost:' + port);
  });
}
