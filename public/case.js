/* One validation: poll our own status route, then render the decision.
   The browser never talks to Opus. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var caseId = new URLSearchParams(location.search).get('id') || '';
  var latest = null;
  var timer = null;
  var startedAt = Date.now();
  var POLL_MS = 4000;

  var FORM_ORDER = [
    'client_name',
    'ssn',
    'dob',
    'address',
    'registration',
    'account_type',
    'contra_firm',
    'contra_account_number',
    'nana',
    'transfer_type',
    'value',
    'form_id',
    'signature_present',
    'signature_date',
    'medallion_present'
  ];

  var STATEMENT_ORDER = [
    'firm',
    'account_holder',
    'account_number',
    'account_type',
    'total_value'
  ];

  function confidenceFor(map, prefix, key) {
    if (!map) return null;
    var direct = map[prefix + '.' + key];
    if (typeof direct === 'number') return direct;
    var nested = Object.keys(map).filter(function (k) {
      return k.indexOf(prefix + '.' + key + '.') === 0;
    });
    if (!nested.length) return null;
    var lowest = null;
    nested.forEach(function (k) {
      if (typeof map[k] === 'number' && (lowest === null || map[k] < lowest)) lowest = map[k];
    });
    return lowest;
  }

  function pairs(obj, order, confidence, prefix) {
    var keys = order.filter(function (k) {
      return Object.prototype.hasOwnProperty.call(obj || {}, k);
    });
    Object.keys(obj || {}).forEach(function (k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
    if (!keys.length) {
      return '<div class="empty"><strong>Nothing extracted</strong>No values were read from this part of the packet.</div>';
    }
    var rows = keys
      .map(function (key) {
        var shown = ATV.formatValue(obj[key]);
        if (shown === null && (key === 'transfer_type' || key === 'scope')) {
          shown = 'No election selected';
        }
        var conf = confidenceFor(confidence, prefix, key);
        var confHtml = '';
        if (typeof conf === 'number') {
          confHtml =
            '<span class="conf' + (conf < 75 ? ' is-low' : '') + '">' + conf + '% confidence</span>';
        }
        return (
          '<div class="pair">' +
          '<span class="k">' +
          esc(ATV.fieldLabel(key)) +
          '</span>' +
          '<span class="v' +
          (shown === null ? ' is-empty' : '') +
          '">' +
          esc(shown === null ? 'Not found on the document' : shown) +
          '</span>' +
          confHtml +
          '</div>'
        );
      })
      .join('');
    return '<div class="pairs">' + rows + '</div>';
  }

  function statsHtml(audit) {
    var a = audit || {};
    var cells = [
      { n: a.total_issues, k: 'Issues in total', hit: a.total_issues > 0 },
      { n: a.consistency_issues, k: 'Consistency', hit: a.consistency_issues > 0 },
      { n: a.completeness_issues, k: 'Completeness', hit: a.completeness_issues > 0 },
      { n: a.contrafit_issues, k: 'Contra firm fit', hit: a.contrafit_issues > 0 },
      { n: a.low_confidence, k: 'Low confidence reads', warn: a.low_confidence > 0 }
    ];
    return (
      '<div class="stats">' +
      cells
        .map(function (c) {
          return (
            '<div class="stat' +
            (c.hit ? ' is-hit' : '') +
            (c.warn ? ' is-warn' : '') +
            '"><div class="n">' +
            (typeof c.n === 'number' ? c.n : '0') +
            '</div><div class="k">' +
            esc(c.k) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function explanationHtml(explanation, hasStructuredLowConfidence) {
    if (!explanation) return '';
    var items = Array.isArray(explanation.action_items) ? explanation.action_items : [];
    var list = items.length
      ? '<ol class="action-list">' +
        items
          .map(function (item) {
            return (
              '<li><div class="issue">' +
              esc(item.issue || '') +
              '</div><div class="todo">' +
              esc(item.what_to_do || '') +
              '</div></li>'
            );
          })
          .join('') +
        '</ol>'
      : '';
    var verify = explanation.verify_note && !hasStructuredLowConfidence
      ? '<div class="notice notice-warn" style="margin-top: 14px">' +
        esc(explanation.verify_note) +
        '</div>'
      : '';
    return (
      '<section class="card">' +
      '<div class="card-head"><h2>What this means</h2></div>' +
      (explanation.headline
        ? '<p style="font-size: 16px; font-weight: 500">' + esc(explanation.headline) + '</p>'
        : '') +
      (explanation.narrative
        ? '<p style="margin-top: 8px; color: var(--ink-2)">' + esc(explanation.narrative) + '</p>'
        : '') +
      (list ? '<h3 style="margin: 18px 0 4px">What to do next</h3>' + list : '') +
      verify +
      '</section>'
    );
  }

  function issuesHtml(issues) {
    if (!issues || !issues.length) return '';
    var rows = issues
      .map(function (issue) {
        return (
          '<tr>' +
          '<td data-label="Issue"><div>' +
          '<div>' +
          esc(issue.label || 'Issue') +
          '</div>' +
          '<div class="card-sub" style="margin: 2px 0 0">' +
          esc(issue.detail || '') +
          '</div></div></td>' +
          '<td data-label="Field">' +
          esc(ATV.fieldLabel(issue.field)) +
          '</td>' +
          '<td data-label="Check">' +
          esc(ATV.sectionLabel(issue.section)) +
          '</td>' +
          '<td data-label="Severity">' +
          ATV.severityPill(issue.severity) +
          '</td>' +
          '<td class="num" data-label="Confidence">' +
          (typeof issue.confidence === 'number' ? issue.confidence + '%' : '') +
          '</td>' +
          '<td class="nowrap" data-label="Code"><span class="mono">' +
          esc(issue.reason_code || '') +
          '</span></td>' +
          '</tr>'
        );
      })
      .join('');
    return (
      '<section class="card">' +
      '<div class="card-head"><h2>Flagged issues</h2><span class="pill pill-bad">' +
      issues.length +
      ' to resolve</span></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>Issue</th><th>Field</th><th>Check</th><th>Severity</th><th class="num">Confidence</th><th>Code</th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>' +
      '</section>'
    );
  }

  function packageHtml(pkg) {
    if (!pkg) return '';
    var order = [
      'client_name',
      'registration',
      'account_type',
      'contra_firm',
      'contra_account_number',
      'nana',
      'transfer_type',
      'scope',
      'value',
      'form_id'
    ];
    var copy = {};
    order.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(pkg, k)) copy[k] = pkg[k];
    });
    return (
      '<section class="card">' +
      '<div class="card-head"><h2>Ready to send to the contra firm</h2>' +
      (pkg.ready_to_send
        ? '<span class="pill pill-ok"><span class="glyph">✓</span>Ready</span>'
        : '') +
      '</div>' +
      pairs(copy, order, null, 'package') +
      '</section>'
    );
  }

  function lowConfidenceHtml(list) {
    if (!list || !list.length) return '';
    return (
      '<div class="notice notice-warn" style="margin-top: 16px">Worth a second look: ' +
      list
        .map(function (item) {
          return esc(ATV.pathLabel(item.field)) + ' at ' + esc(item.confidence) + '%';
        })
        .join('; ') +
      '.</div>'
    );
  }

  function renderResult(payload) {
    var result = payload.result || {};
    var isIgo = result.status === 'IGO';
    var extracted = result.extracted || {};
    var verdictClass = result.status ? (isIgo ? 'is-ok' : 'is-bad') : 'is-dead';

    var head =
      '<div class="verdict ' +
      verdictClass +
      '">' +
      '<div class="verdict-mark">' +
      (isIgo ? '✓' : '!') +
      '</div>' +
      '<div class="verdict-body">' +
      '<div class="verdict-title">' +
      (isIgo ? 'In good order' : 'Not in good order') +
      '</div>' +
      '<div class="verdict-sub">' +
      esc(ATV.tidy(result.decision_summary)) +
      '</div>' +
      '</div></div>';

    var errorNote = payload.workflowError
      ? '<div class="notice notice-bad" style="margin-top: 16px">The workflow reported a problem while assembling the result: ' +
        esc(payload.workflowError) +
        '</div>'
      : '';

    var extractedBody =
      '<div class="grid-2">' +
      '<div><h3 style="margin-bottom: 8px">Transfer form</h3>' +
      pairs(extracted.form || {}, FORM_ORDER, result.field_confidence, 'form') +
      '</div>' +
      '<div><h3 style="margin-bottom: 8px">Delivering firm statement</h3>' +
      pairs(extracted.statement || {}, STATEMENT_ORDER, result.field_confidence, 'statement') +
      '</div>' +
      '</div>';

    var extractedSection =
      '<section class="card">' +
      '<div class="card-head"><h2>What was read from the packet</h2></div>' +
      extractedBody +
      '</section>';

    var raw =
      '<details class="raw"><summary>Raw workflow output</summary><pre>' +
      esc(JSON.stringify({ result: payload.result, explanation: payload.explanation }, null, 2)) +
      '</pre></details>';

    $('#result').innerHTML =
      head +
      statsHtml(result.audit) +
      lowConfidenceHtml(result.low_confidence_fields) +
      errorNote +
      '<div style="height: 16px"></div>' +
      explanationHtml(
        payload.explanation,
        Boolean(result.low_confidence_fields && result.low_confidence_fields.length)
      ) +
      issuesHtml(result.flagged_issues) +
      (isIgo ? packageHtml(result.igo_package) : '') +
      (isIgo
        ? '<details class="raw" style="margin-top: 16px"><summary>Everything read from the packet</summary><div style="padding: 0 14px 14px">' +
          extractedBody +
          '</div></details>'
        : extractedSection) +
      raw;

    $('#result').hidden = false;
    $('#running').hidden = true;
    $('#failed').hidden = true;
    $('#actions').hidden = false;
  }

  function renderFailure(payload) {
    var label = ATV.STATUS_TEXT[payload.status] || payload.status || 'Unknown';
    $('#failed').innerHTML =
      '<div class="verdict is-dead">' +
      '<div class="verdict-mark">!</div>' +
      '<div class="verdict-body">' +
      '<div class="verdict-title">The run did not finish</div>' +
      '<div class="verdict-sub">' +
      'The validation stopped before it reached a decision. Nothing was decided about ' +
      'this packet, so submitting it again is safe.' +
      '</div></div></div>';
    $('#failed').hidden = false;
    $('#running').hidden = true;
    $('#result').hidden = true;
    $('#actions').hidden = false;
    $('#copy-json').hidden = true;
  }

  function renderMeta(row, status) {
    var bits = [];
    if (row && row.fileName) bits.push('File: ' + esc(row.fileName));
    bits.push('Case ' + esc(caseId));
    if (row && row.createdAt) bits.push('Submitted ' + esc(ATV.formatTime(row.createdAt)));
    bits.push(ATV.statusPill(status));
    $('#case-meta').innerHTML = bits
      .map(function (b) {
        return '<span>' + b + '</span>';
      })
      .join('');
    if (row && (row.title || row.fileName)) {
      $('#case-title').textContent = row.title || row.fileName;
    }
  }

  function tick(payload) {
    $('#running-note').textContent =
      'Extracting the documents and running the checks. Elapsed ' +
      Math.round((Date.now() - startedAt) / 1000) +
      's.';
    renderMeta(payload && payload.row, (payload && payload.status) || 'IN_PROGRESS');
  }

  function poll() {
    ATV.fetchJson('/api/status/' + encodeURIComponent(caseId))
      .then(function (payload) {
        latest = payload;
        renderMeta(payload.row, payload.status);
        if (!payload.terminal) {
          $('#running').hidden = false;
          tick(payload);
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        if (payload.status === 'COMPLETED' && payload.result) {
          renderResult(payload);
        } else if (payload.status === 'COMPLETED') {
          renderFailure({
            status: 'COMPLETED',
            failure: 'The run completed but returned no result to display.'
          });
        } else {
          renderFailure(payload);
        }
      })
      .catch(function (err) {
        $('#running').hidden = true;
        $('#failed').hidden = false;
        $('#actions').hidden = false;
        $('#copy-json').hidden = true;
        $('#failed').innerHTML =
          '<div class="card"><div class="empty"><strong>This validation could not be found</strong>' +
          'It may have been run from another workspace, or the link may be incomplete. ' +
          'Starting a new validation is the quickest way forward.' +
          '</div></div>';
        if (window.console && console.warn) console.warn('Case lookup failed: ' + err.message);
      });
  }

  ATV.boot(function () {
    if (!caseId) {
      $('#running').hidden = true;
      $('#failed').hidden = false;
      $('#failed').innerHTML =
        '<div class="card"><div class="empty"><strong>No case selected</strong>Start from the new validation page.</div></div>';
      $('#actions').hidden = false;
      return;
    }

    $('#copy-json').addEventListener('click', function () {
      if (!latest) return;
      var text = JSON.stringify(
        { result: latest.result, explanation: latest.explanation },
        null,
        2
      );
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        $('#copy-json').textContent = 'Copied';
        setTimeout(function () {
          $('#copy-json').textContent = 'Copy result JSON';
        }, 1600);
      }
    });

    /* A finished case comes back from storage in one call. A case still in
       flight, or one this server has never stored, falls through to polling. */
    ATV.fetchJson('/api/case/' + encodeURIComponent(caseId))
      .then(function (payload) {
        latest = payload;
        renderMeta(payload.row, payload.status);
        if (payload.result) return renderResult(payload);
        if (payload.terminal) return renderFailure(payload);
        $('#running').hidden = false;
        poll();
      })
      .catch(function () {
        $('#running').hidden = false;
        poll();
      });
  });

  window.addEventListener('beforeunload', function () {
    if (timer) clearTimeout(timer);
  });
})();
