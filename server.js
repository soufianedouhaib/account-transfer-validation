'use strict';

const path = require('path');
const express = require('express');
const opus = require('./lib/opus');
const store = require('./lib/store');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: '5m'
  })
);

const LIST_KEY = 'atv:cases';
const RECORD_KEY = function (id) {
  return 'atv:case:' + id;
};
const HISTORY_CAP = 200;

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
    failure: rec.failure || null
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
  } catch (e) {
    // History is a convenience. A storage outage must never fail a validation.
  }
}

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({
    error: (err && err.message) || 'Unexpected error',
    retryAfter: err && err.retryAfter ? err.retryAfter : undefined
  });
}

/* ------------------------------------------------------------------ *
 * Routes                                                              *
 * ------------------------------------------------------------------ */

app.get('/api/health', async function (req, res) {
  const missing = opus.missingEnv();
  const storage = await store.ping();
  res.json({
    ok: missing.length === 0,
    missingEnv: missing,
    workflowId: opus.WORKFLOW_ID,
    baseUrl: opus.BASE,
    history: {
      configured: store.configured,
      mode: store.mode,
      reachable: storage.ok,
      reason: storage.reason || null
    }
  });
});

app.get('/api/me', function (req, res) {
  // No sign in on this build. The shape is kept so pages can gate their first
  // render on one call, and so roles can be added later without a rewrite.
  res.json({
    signedIn: true,
    role: 'advisor',
    appName: 'Account Transfer Validation',
    historyEnabled: store.configured,
    configured: opus.missingEnv().length === 0
  });
});

/** Step 1. A presigned slot. The browser uploads straight to storage. */
app.post('/api/upload-url', async function (req, res) {
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
app.post('/api/submit', async function (req, res) {
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
    const caseId = await opus.initiateCase(title, 'Submitted through the Account Transfer Validation console.');
    await opus.executeCase(caseId, fileUrl);
    const rec = {
      caseId: caseId,
      title: title,
      fileName: fileName,
      fileUrl: fileUrl,
      status: 'IN_PROGRESS',
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      explanation: null,
      workflowError: '',
      failure: null
    };
    await saveRecord(rec);
    res.json({ caseId: caseId, row: toRow(rec) });
  } catch (err) {
    sendError(res, err);
  }
});

/** Step 3. The browser polls this, never Opus. */
app.get('/api/status/:caseId', async function (req, res) {
  const caseId = String(req.params.caseId);
  const missing = opus.missingEnv();
  if (missing.length) {
    return res.status(503).json({ error: 'Server is not configured: ' + missing.join(', ') });
  }
  try {
    const status = await opus.status(caseId);
    let rec = (await loadRecord(caseId)) || {
      caseId: caseId,
      title: null,
      fileName: null,
      createdAt: null,
      completedAt: null,
      result: null,
      explanation: null,
      workflowError: '',
      failure: null
    };
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

    res.json({
      status: status,
      terminal: opus.isTerminal(status),
      row: toRow(rec),
      result: rec.result,
      explanation: rec.explanation,
      workflowError: rec.workflowError || '',
      failure: rec.failure || null,
      stored: store.configured
    });
  } catch (err) {
    sendError(res, err);
  }
});

/** A finished case, straight from storage where possible. */
app.get('/api/case/:caseId', async function (req, res) {
  const caseId = String(req.params.caseId);
  try {
    const rec = await loadRecord(caseId);
    if (!rec) {
      // Nothing known about this id. 404 rather than 403, which would confirm
      // that some other caller's case exists.
      return res.status(404).json({ error: 'No such case.' });
    }
    const finished = Boolean(rec.result) || Boolean(rec.failure);
    res.json({
      status: rec.status,
      terminal: finished,
      row: toRow(rec),
      result: rec.result || null,
      explanation: rec.explanation || null,
      workflowError: rec.workflowError || '',
      failure: rec.failure || null,
      stored: true
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/history', async function (req, res) {
  if (!store.configured) {
    return res.json({ configured: false, rows: [], note: 'History is not configured.' });
  }
  const limit = Math.min(Number(req.query.limit) || 50, HISTORY_CAP);
  try {
    const ids = await store.listIds(LIST_KEY, limit);
    const rows = [];
    for (let i = 0; i < ids.length; i++) {
      const rec = await loadRecord(ids[i]);
      if (rec) rows.push(toRow(rec));
    }
    res.json({ configured: true, rows: rows });
  } catch (err) {
    res.json({ configured: true, rows: [], note: 'History is unavailable: ' + err.message });
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
