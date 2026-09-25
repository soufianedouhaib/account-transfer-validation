/* The run list. An advisor sees their own runs. A reviewer or the admin sees
   everyone's, and can narrow to their own with the scope control. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var rows = [];
  var canReview = false;


  /* The period controls are shared with the report, so they behave the same
     way wherever they appear. */
  function currentRange() {
    var preset = $('#filter-preset').value;
    if (preset === 'custom') return { from: $('#filter-from').value, to: $('#filter-to').value };
    return ATV.rangeFor(preset, $('#filter-month').value);
  }

  function syncPeriodControls() {
    var preset = $('#filter-preset').value;
    $('#filter-month').hidden = preset !== 'month';
    $('#custom-wrap').hidden = preset !== 'custom';
    if (preset === 'month' && !$('#filter-month').value) {
      $('#filter-month').value = new Date().toISOString().slice(0, 7);
    }
    if (preset === 'custom' && !$('#filter-from').value) {
      var start = ATV.rangeFor('this-month');
      $('#filter-from').value = start.from;
      $('#filter-to').value = start.to;
    }
  }

  function matches(row) {
    /* Read every optional control defensively. These pages are deployed as
       separate files, and a script that is a version ahead of its markup
       should narrow nothing rather than take the whole screen down on a null. */
    var whoBox = $('#filter-who');
    var who = whoBox ? whoBox.value : '';
    if (who && row.submittedBy !== who) return false;

    var outcome = $('#filter-outcome').value;
    if (outcome === 'IGO' && row.verdict !== 'IGO') return false;
    if (outcome === 'NIGO' && row.verdict !== 'NIGO') return false;
    if (outcome === 'UNFINISHED' && row.status === 'COMPLETED') return false;

    var text = $('#filter-text').value.trim().toLowerCase();
    if (!text) return true;
    return (
      /* Search reads the employee's name as well as their email: a manager
         looking for Daniel's runs types "Daniel", not the address. */
      [
        row.title,
        row.fileName,
        row.clientName,
        row.contraFirm,
        row.submittedByName,
        row.submittedBy,
        row.caseId
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .indexOf(text) !== -1
    );
  }


  /* The people who have actually submitted something in this period, so the
     list is never a roster of names with nothing behind them. Built from the
     rows on screen and rebuilt whenever they change, with the current choice
     kept if that person is still in the list. */
  function fillWhoFilter() {
    var select = $('#filter-who');
    if (!select || select.hidden) return;
    var seen = {};
    rows.forEach(function (row) {
      if (!row.submittedBy) return;
      if (!seen[row.submittedBy]) seen[row.submittedBy] = row.submittedByName || row.submittedBy;
    });
    var emails = Object.keys(seen).sort(function (a, b) {
      return seen[a].localeCompare(seen[b]);
    });
    var chosen = select.value;
    select.innerHTML =
      '<option value="">Anyone</option>' +
      emails
        .map(function (email) {
          return '<option value="' + esc(email) + '">' + esc(seen[email]) + '</option>';
        })
        .join('');
    select.value = emails.indexOf(chosen) === -1 ? '' : chosen;
  }

  function render() {
    var visible = rows.filter(matches);
    $('#count-pill').textContent = visible.length + (visible.length === 1 ? ' run' : ' runs');

    if (!rows.length) {
      $('#history-body').innerHTML =
        '<div class="empty"><strong>No runs yet</strong>' +
        (canReview
          ? 'Runs appear here as advisors submit packets.'
          : 'Packets you validate appear here once you submit one.') +
        '</div>';
      return;
    }
    if (!visible.length) {
      $('#history-body').innerHTML =
        '<div class="empty"><strong>Nothing matches those filters</strong>' +
        'Clear the search or pick another outcome.</div>';
      return;
    }

    var body = visible
      .map(function (row) {
        var outcome =
          row.status === 'COMPLETED' && row.verdict
            ? ATV.verdictPill(row.verdict)
            : ATV.statusPill(row.status);
        return (
          '<tr>' +
          '<td data-label="Reference"><div><a class="row-link" href="/case.html?id=' +
          encodeURIComponent(row.caseId) +
          '">' +
          esc(row.title || row.fileName || row.caseId) +
          '</a>' +
          '<div class="card-sub" style="margin: 2px 0 0">' +
          esc(row.clientName || 'Client not read') +
          (row.contraFirm ? ', ' + esc(row.contraFirm) : '') +
          '</div></div></td>' +
          '<td data-label="Client"' +
          (row.clientName ? '' : ' data-empty="1"') +
          '>' +
          esc(row.clientName || '') +
          '</td>' +
          (canReview
            ? '<td data-label="Submitted by">' + esc(row.submittedByName || row.submittedBy || '') + '</td>'
            : '<td data-label="Contra firm">' + esc(row.contraFirm || '') + '</td>') +
          '<td data-label="Workflow"><div>' +
          outcome +
          (row.lowConfidence
            ? '<div style="margin-top: 4px"><span class="pill pill-warn"><span class="glyph">▲</span>' +
              row.lowConfidence +
              ' to verify</span></div>'
            : '') +
          '</div></td>' +
          '<td class="num" data-label="Issues"' +
          (typeof row.totalIssues === 'number' ? '' : ' data-empty="1"') +
          '>' +
          (typeof row.totalIssues === 'number' ? row.totalIssues : '') +
          '</td>' +
          '<td class="num" data-label="Run time"' +
          (typeof row.runtimeMs === 'number' ? '' : ' data-empty="1"') +
          '>' +
          (typeof row.runtimeMs === 'number' ? esc(ATV.duration(row.runtimeMs)) : '') +
          '</td>' +
          '<td data-label="Review">' +
          (row.status === 'COMPLETED'
            ? ATV.reviewPill(row.reviewState)
            : '<span class="quiet">Not applicable</span>') +
          '</td>' +
          '<td data-label="Submitted">' +
          esc(ATV.formatTime(row.createdAt)) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    $('#history-body').innerHTML =
      '<div class="table-wrap"><table class="history-table data-table"><thead><tr>' +
      '<th>Reference</th><th>Client</th><th>' +
      (canReview ? 'Submitted by' : 'Contra firm') +
      '</th><th>Workflow</th>' +
      '<th class="num">Issues</th><th class="num">Run time</th><th>Review</th><th>Submitted</th>' +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div>';
  }

  /* Clearing the history keeps the three newest runs and deletes the rest,
     everywhere: the list, the queue, the exports and the report all read the
     same index. It cannot be undone, so it asks once, on the page rather than
     in a browser dialog, and the button itself never goes away or greys out:
     a control that disappears at three runs is a control people stop looking
     for. */
  function clearResult(out) {
    var note = $('#clear-note');
    if (!note) return;
    note.hidden = false;
    note.textContent = out.cleared
      ? 'Cleared ' + out.cleared + (out.cleared === 1 ? ' run' : ' runs') +
        ', keeping the ' + out.kept + ' newest.'
      : 'Nothing to clear: there were only ' + out.kept +
        (out.kept === 1 ? ' run' : ' runs') + ' to begin with.';
  }

  function showConfirm(open) {
    $('#clear-confirm').hidden = !open;
    if (open && $('#clear-note')) $('#clear-note').hidden = true;
  }

  function wireClear() {
    var button = $('#clear-runs');
    if (!button) return;
    button.hidden = false;

    button.addEventListener('click', function () {
      showConfirm(true);
    });
    $('#clear-no').addEventListener('click', function () {
      showConfirm(false);
    });
    $('#clear-yes').addEventListener('click', function () {
      var yes = $('#clear-yes');
      yes.disabled = true;
      yes.textContent = 'Clearing';
      ATV.fetchJson('/api/history/clear', { method: 'POST' })
        .then(function (out) {
          showConfirm(false);
          clearResult(out);
          load(canReview ? $('#filter-scope').value : '');
        })
        .catch(function (err) {
          if (ATV.onAuthLoss(err)) return;
          showConfirm(false);
          var note = $('#clear-note');
          if (note) {
            note.hidden = false;
            note.textContent = 'Nothing was cleared: ' + err.message;
          }
        })
        .then(function () {
          yes.disabled = false;
          yes.textContent = 'Yes, clear them';
        });
    });
  }

  function load(scope) {
    var range = currentRange();
    var query = ATV.rangeQuery(range);
    if (canReview) {
      $('#export-link').href = '/api/export.csv' + (query ? '?' + query : '');
    }
    $('#history-body').innerHTML = '<div class="skeleton">Loading</div>';
    ATV.fetchJson(
      '/api/history?limit=200' + (scope ? '&scope=' + scope : '') + (query ? '&' + query : '')
    )
      .then(function (out) {
        rows = out.rows || [];
        if (out.note) {
          $('#history-body').innerHTML = '<div class="notice notice-warn">' + esc(out.note) + '</div>';
          if (!rows.length) return;
        }
        fillWhoFilter();
        render();
      })
      .catch(function (err) {
        if (ATV.onAuthLoss(err)) return;
        $('#history-body').innerHTML =
          '<div class="notice notice-bad">History could not be read: ' + esc(err.message) + '</div>';
      });
  }

  ATV.boot(function (me) {
    canReview = Boolean(me.canReview);
    $('#filter-outcome').addEventListener('change', render);
    $('#filter-text').addEventListener('input', render);

    ['#filter-preset', '#filter-month', '#filter-from', '#filter-to'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        syncPeriodControls();
        load(canReview ? $('#filter-scope').value : '');
      });
    });
    syncPeriodControls();

    if (canReview) {
      $('#export-link').hidden = false;
      /* An employee's list is their own work only, so a "who" filter there
         would offer a choice of one. */
      if ($('#filter-who')) {
        $('#filter-who').hidden = false;
        $('#filter-who').addEventListener('change', render);
      }
      wireClear();
      $('#page-title').textContent = 'All runs';
      $('#page-sub').textContent =
        'Every packet submitted through this console, newest first, whoever submitted it.';
      $('#scope-wrap').hidden = false;
      $('#filter-scope').addEventListener('change', function () {
        load($('#filter-scope').value);
      });
    } else {
      $('#page-title').textContent = 'My runs';
      $('#page-sub').textContent = 'Every packet you have submitted, newest first.';
    }

    if (!me.historyEnabled) {
      $('#page-sub').hidden = true;
      $('#filter-outcome').disabled = true;
      $('#filter-text').disabled = true;
      $('#history-body').innerHTML =
        '<div class="empty"><strong>Run history is not switched on</strong>' +
        'Validations work as normal, they are simply not kept after you leave the page. ' +
        'Your administrator can turn history on for this workspace.</div>';
      $('#count-pill').hidden = true;
      return;
    }

    load('');
  });
})();
