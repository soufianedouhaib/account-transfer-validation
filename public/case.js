/* One validation: poll our own status route, render the verdict, show the
   submitted packet. The workflow's verdict is the outcome: nobody signs it
   off afterwards.
   The browser never talks to Opus. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var caseId = new URLSearchParams(location.search).get('id') || '';
  var latest = null;
  var me = null;
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

  var STATEMENT_ORDER = ['firm', 'account_holder', 'account_number', 'account_type', 'total_value'];

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
          (shown === null ? 'Not found on the document' : ATV.escMasked(shown)) +
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
              ATV.escMasked(item.issue || '') +
              '</div><div class="todo">' +
              ATV.escMasked(item.what_to_do || '') +
              '</div></li>'
            );
          })
          .join('') +
        '</ol>'
      : '';
    var verify =
      explanation.verify_note && !hasStructuredLowConfidence
        ? '<div class="notice notice-warn" style="margin-top: 14px"><span class="glyph">▲</span> ' +
          esc(explanation.verify_note) +
          '</div>'
        : '';
    return (
      '<section class="card">' +
      '<div class="card-head"><h2>What this means</h2></div>' +
      (explanation.headline
        ? '<p style="font-size: 16px; font-weight: 500">' + ATV.escMasked(explanation.headline) + '</p>'
        : '') +
      (explanation.narrative
        ? '<p style="margin-top: 8px; color: var(--ink-2)">' + ATV.escMasked(explanation.narrative) + '</p>'
        : '') +
      (list ? '<h3 style="margin: 18px 0 4px">What to do next</h3>' + list : '') +
      verify +
      '</section>'
    );
  }

  function issuesHtml(issues) {
    /* Anything that is not a list of issues is treated as no issues. The
       shape comes from a workflow this console does not control, and a
       surprise here should cost the reader this one section rather than the
       whole page. */
    if (!Array.isArray(issues) || !issues.length) return '';

    /* The workflow does not always attach a reason code: it did on NIGO-09,
       it did not on the account master check. A column of blanks reads as a
       bug in the console, so the column is only drawn when something in this
       case actually carries one. */
    var hasCodes = issues.some(function (issue) {
      return Boolean(issue.reason_code);
    });

    var rows = issues
      .map(function (issue) {
        var label = ATV.tidy(issue.label || 'Issue');
        var detail = ATV.tidy(issue.detail || '');
        /* Some issues repeat the label word for word as the detail. Printing
           it twice reads as a rendering fault, so the second line is dropped
           when it says nothing the first did not. */
        var sameText = detail && detail.replace(/\s+/g, ' ').trim().toLowerCase() ===
          label.replace(/\s+/g, ' ').trim().toLowerCase();
        return (
          '<tr>' +
          '<td data-label="Issue"><div>' +
          '<div>' + esc(label) + '</div>' +
          (detail && !sameText
            ? '<div class="card-sub" style="margin: 2px 0 0">' + ATV.escMasked(detail) + '</div>'
            : '') +
          '</div></td>' +
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
          (hasCodes
            ? '<td class="nowrap" data-label="Code"><span class="mono">' +
              esc(issue.reason_code || '') +
              '</span></td>'
            : '') +
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
      '<th>Issue</th><th>Field</th><th>Check</th><th>Severity</th><th class="num">Confidence</th>' +
      (hasCodes ? '<th>Code</th>' : '') +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>' +
      '</section>'
    );
  }

  /* The workflow assembles this package only when it finds the packet in good
     order, and its own flag says whether it considers it sendable. */
  function packageGatePill(pkg) {
    if (pkg && pkg.ready_to_send === false) {
      return '<span class="pill pill-warn"><span class="glyph">▲</span>Not ready to send</span>';
    }
    return '<span class="pill pill-ok"><span class="glyph">✓</span>Ready to send</span>';
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
      '<div class="card-head"><h2>What would be sent to the contra firm</h2>' +
      packageGatePill(pkg) +
      '</div>' +
      pairs(copy, order, null, 'package') +
      '</section>'
    );
  }

  function lowConfidenceHtml(list) {
    if (!list || !list.length) return '';
    return (
      '<div class="notice notice-warn" style="margin-top: 16px"><span class="glyph">▲</span> Worth a second look: ' +
      list
        .map(function (item) {
          return esc(ATV.pathLabel(item.field)) + ' at ' + esc(item.confidence) + '%';
        })
        .join('; ') +
      '.</div>'
    );
  }

  /* ---------------------------- the packet ---------------------------- */

  /* While the run is in flight the page is one card and nothing else, so the
     title, the meta row and the footer are centred with it rather than being
     pinned to the left of an otherwise empty screen. */
  function setWaiting(on) {
    document.body.classList[on ? 'add' : 'remove']('is-waiting');
  }

  function documentHtml(row) {
    if (!row || !row.hasDocument) return '';
    var url = '/api/case/' + encodeURIComponent(caseId) + '/document';

    /* Opus keeps no readable copy of an uploaded file, so a run submitted
       before this console started keeping its own has nothing to show. Saying
       that plainly beats an iframe rendering the server's error as raw JSON. */
    if (!row.packetKept) {
      return (
        '<section class="card">' +
        '<div class="card-head"><h2>The submitted packet</h2>' +
        (row.fileName ? '<span class="pill"><span class="glyph">▪</span>' + esc(row.fileName) + '</span>' : '') +
        '</div>' +
        '<div class="empty"><strong>No packet was kept for this run</strong>' +
        'It was submitted before this console began keeping its own copy. Everything the ' +
        'workflow read from the documents is on this page; the file itself has to come from ' +
        'the person who sent it.</div>' +
        '</section>'
      );
    }

    var name = row.fileName || 'packet';
    var ext = (name.split('.').pop() || '').toLowerCase();
    var viewer = '';
    if (ext === 'pdf') {
      viewer = '<iframe class="doc-frame" src="' + url + '#view=FitH" title="Submitted packet"></iframe>';
    } else if (['png', 'jpg', 'jpeg'].indexOf(ext) !== -1) {
      viewer = '<img class="doc-image" src="' + url + '" alt="Submitted packet">';
    } else {
      viewer =
        '<div class="empty"><strong>No preview for this file type</strong>' +
        'Open it in a new tab to read it.</div>';
    }
    return (
      '<section class="card">' +
      '<div class="card-head"><h2>The submitted packet</h2>' +
      '<span class="pill"><span class="glyph">▪</span>' +
      esc(name) +
      '</span>' +
      '<a class="btn btn-quiet btn-small" href="' +
      url +
      '" target="_blank" rel="noopener">Open in a new tab</a>' +
      '</div>' +
      viewer +
      '</section>'
    );
  }

  /* ------------------------------ rendering --------------------------- */

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

    var raw = me && me.isAdmin
      ? '<details class="raw"><summary>Raw workflow output</summary><pre>' +
        ATV.escMasked(JSON.stringify({ result: payload.result, explanation: payload.explanation }, null, 2)) +
        '</pre></details>'
      : '';

    $('#result').innerHTML =
      head +
      statsHtml(result.audit) +
      lowConfidenceHtml(result.low_confidence_fields) +
      errorNote +
      (payload.workflowError ? supportCardHtml(payload) : '') +
      '<div style="height: 16px"></div>' +
      explanationHtml(
        payload.explanation,
        Boolean(result.low_confidence_fields && result.low_confidence_fields.length)
      ) +
      issuesHtml(result.flagged_issues) +
      (isIgo ? packageHtml(result.igo_package) : '') +
      (isIgo
        ? '<details class="raw" style="margin-top: 16px"><summary>What was read from the packet</summary><div style="padding: 0 14px 14px">' +
          extractedBody +
          '</div></details>'
        : extractedSection) +
      raw;

    $('#result').hidden = false;
    $('#running').hidden = true;
    setWaiting(false);
    $('#failed').hidden = true;
    $('#actions').hidden = false;
    afterTerminal(payload);
  }

  function supportCardHtml(payload) {
    var href = ATV.supportHref(me, {
      what: 'a run that did not finish',
      caseId: caseId,
      status: (payload && payload.status) || 'unknown'
    });
    return (
      '<section class="card" style="margin-top: 16px"><div class="support-card">' +
      ATV.icon('support') +
      '<div><h2 style="font-size: 17px; margin-bottom: 4px">Still stuck?</h2>' +
      '<p class="card-sub" style="margin: 0 0 12px">' +
      'If this keeps happening, Opus support can look at the run itself. The email opens with ' +
      'the workflow id, this case id and the run status already filled in.' +
      '</p>' +
      '<a class="btn btn-small" href="' +
      href +
      '">Contact Opus support</a></div></div></section>'
    );
  }

  function renderFailure(payload) {
    $('#failed').innerHTML =
      '<div class="verdict is-dead">' +
      '<div class="verdict-mark">!</div>' +
      '<div class="verdict-body">' +
      '<div class="verdict-title">The run did not finish</div>' +
      '<div class="verdict-sub">' +
      'The validation stopped before it reached a decision. Nothing was decided about ' +
      'this packet, so submitting it again is safe.' +
      '</div></div></div>' +
      supportCardHtml(payload);
    $('#failed').hidden = false;
    $('#running').hidden = true;
    setWaiting(false);
    $('#result').hidden = true;
    $('#actions').hidden = false;
    $('#copy-json').hidden = true;
    afterTerminal(payload);
  }

  /* The packet belongs to both endings. */
  function afterTerminal(payload) {
    $('#document-slot').innerHTML = documentHtml(payload.row);
    renderActions(payload);
  }

  /* A packet the workflow blocked needs fixing and resubmitting; one it
     cleared needs nothing further, so the next step is simply the next
     packet. */
  function renderActions(payload) {
    var copy = $('#copy-json');
    if (copy) copy.hidden = !(me && me.isAdmin) || !payload.result;

    var primary = $('#action-new');
    if (!primary || !me || !me.canSubmit) return;
    var blocked = payload.row && payload.row.verdict === 'NIGO';
    if (blocked) {
      primary.textContent = 'Resubmit this packet';
      primary.href = '/?from=' + encodeURIComponent(caseId);
    } else {
      primary.textContent = 'Validate another packet';
      primary.href = '/';
    }
  }

  function renderMeta(row, status) {
    var bits = [];
    bits.push('Case ' + esc(caseId));
    if (row && row.submittedByName && me && me.canSeeAll) {
      bits.push('Submitted by ' + esc(row.submittedByName));
    }
    if (row && row.createdAt) bits.push('Submitted ' + esc(ATV.formatTime(row.createdAt)));
    bits.push(ATV.statusPill(status));
    /* The workflow's own time, once it has one. Reported separately from the
       submitted time because it answers a different question: how long the run
       took, not how long ago it was asked for. */
    if (row && typeof row.runtimeMs === 'number') {
      bits.push(
        '<span class="run-time" title="Time the workflow itself took, ' +
          'from the first step to the last. The upload is not counted.">' +
          ATV.icon('clock') +
          'Ran in ' +
          esc(ATV.duration(row.runtimeMs)) +
          '</span>'
      );
    }
    $('#case-meta').innerHTML = bits
      .map(function (b) {
        return '<span>' + b + '</span>';
      })
      .join('');
    if (row && (row.title || row.fileName)) {
      $('#case-title').textContent = row.title || row.fileName;
    }
  }

  function poll() {
    ATV.fetchJson('/api/status/' + encodeURIComponent(caseId))
      .then(function (payload) {
        latest = payload;
        renderMeta(payload.row, payload.status);
        if (!payload.terminal) {
          $('#running').hidden = false;
          setWaiting(true);
          $('#running-note').textContent =
            'Reading the documents and running the checks. This usually takes a minute or two. ' +
            'Elapsed ' +
            Math.round((Date.now() - startedAt) / 1000) +
            's.';
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        /* Drawing the result is kept apart from fetching it. A payload this
           page cannot render is a fault in the console, not a missing case,
           and reporting it as "not found" sends somebody looking for a run
           that is sitting right there. */
        try {
          if (payload.status === 'COMPLETED' && payload.result) renderResult(payload);
          else renderFailure(payload);
        } catch (err) {
          renderUnreadable(payload, err);
        }
      })
      .catch(function (err) {
        if (ATV.onAuthLoss(err)) return;
        $('#running').hidden = true;
        setWaiting(false);
        $('#failed').hidden = false;
        $('#actions').hidden = false;
        $('#copy-json').hidden = true;

        /* Only a 404 means the case is not there. Anything else is the
           console failing to reach its own server, and saying "not found"
           would be a guess dressed up as an answer. */
        if (err.status === 404) {
          $('#case-title').textContent = 'Validation not found';
          $('#failed').innerHTML =
            '<div class="card"><div class="empty"><strong>This validation could not be found</strong>' +
            'It may belong to another colleague, or the link may be incomplete. ' +
            'Starting a new validation is the quickest way forward.' +
            '</div></div>' +
            supportCardHtml({ status: 'not found' });
        } else {
          $('#failed').innerHTML =
            '<div class="card"><div class="empty"><strong>This run could not be read</strong>' +
            'The console could not reach the server for this case. The run itself is unaffected, ' +
            'so reloading the page is usually enough.' +
            '</div><p class="notice notice-warn" style="margin: 0 14px 14px">' +
            '<span class="glyph">!</span>' +
            esc(err.message || 'Unknown error') +
            '</p></div>' +
            supportCardHtml({ status: 'could not be read' });
        }
        if (window.console && console.warn) console.warn('Case lookup failed: ' + err.message);
      });
  }

  /* The run finished and the server handed it over; this console could not
     draw it. Everything known is kept on screen, the fault is named, and an
     administrator gets the payload that caused it. */
  function renderUnreadable(payload, err) {
    $('#running').hidden = true;
    setWaiting(false);
    $('#result').hidden = true;
    $('#failed').hidden = false;
    $('#actions').hidden = false;
    $('#copy-json').hidden = true;
    $('#failed').innerHTML =
      '<div class="card"><div class="empty"><strong>This run finished, but the console could not display it</strong>' +
      'The validation itself is fine and its result is stored. This is a fault in this page, ' +
      'not in the run, so the workflow does not need running again.' +
      '</div><p class="notice notice-warn" style="margin: 0 14px 14px">' +
      '<span class="glyph">!</span>' +
      esc((err && err.message) || 'Unknown rendering error') +
      '</p></div>' +
      (me && me.isAdmin
        ? '<details class="raw"><summary>Raw workflow output</summary><pre>' +
          ATV.escMasked(JSON.stringify({ result: payload.result, explanation: payload.explanation }, null, 2)) +
          '</pre></details>'
        : '') +
      supportCardHtml({ status: 'finished but could not be displayed' });
    $('#document-slot').innerHTML = documentHtml(payload.row);
    renderActions(payload);
    if (window.console && console.error) console.error('Case render failed', err);
  }

  ATV.boot(function (user) {
    me = user;
    $('#action-new').hidden = !me.canSubmit;
    $('#action-list').textContent = me.canSeeAll ? 'All runs' : 'My runs';
    $('#action-list').href = '/history.html';

    if (!caseId) {
      $('#running').hidden = true;
      setWaiting(false);
      $('#failed').hidden = false;
      $('#failed').innerHTML =
        '<div class="card"><div class="empty"><strong>No case selected</strong>' +
        'Pick a run from the list to open it.</div></div>';
      $('#actions').hidden = false;
      $('#copy-json').hidden = true;
      return;
    }

    $('#copy-json').addEventListener('click', function () {
      if (!latest) return;
      var text = JSON.stringify({ result: latest.result, explanation: latest.explanation }, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        $('#copy-json').textContent = 'Copied';
        setTimeout(function () {
          $('#copy-json').textContent = 'Copy result JSON';
        }, 1600);
      }
    });

    /* A stored case comes back in one call. A case still in flight, or one
       this server has never stored, falls through to polling. */
    ATV.fetchJson('/api/case/' + encodeURIComponent(caseId))
      .then(function (payload) {
        latest = payload;
        renderMeta(payload.row, payload.status);
        if (payload.result) return renderResult(payload);
        if (payload.terminal) return renderFailure(payload);
        $('#running').hidden = false;
        setWaiting(true);
        poll();
      })
      .catch(function (err) {
        if (ATV.onAuthLoss(err)) return;
        $('#running').hidden = false;
        setWaiting(true);
        poll();
      });
  });

  window.addEventListener('beforeunload', function () {
    if (timer) clearTimeout(timer);
  });
})();
