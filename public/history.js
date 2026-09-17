/* History list. Reads the same projected rows every other screen reads. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var rows = [];

  function matches(row) {
    var outcome = $('#filter-outcome').value;
    if (outcome === 'IGO' && row.verdict !== 'IGO') return false;
    if (outcome === 'NIGO' && row.verdict !== 'NIGO') return false;
    if (outcome === 'UNFINISHED' && row.status === 'COMPLETED') return false;

    var text = $('#filter-text').value.trim().toLowerCase();
    if (!text) return true;
    return [row.title, row.fileName, row.clientName, row.contraFirm, row.caseId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .indexOf(text) !== -1;
  }

  function render() {
    var visible = rows.filter(matches);
    $('#count-pill').textContent =
      visible.length + (visible.length === 1 ? ' run' : ' runs');

    if (!rows.length) {
      $('#history-body').innerHTML =
        '<div class="empty"><strong>No runs yet</strong>Validated packets appear here once you submit one.</div>';
      return;
    }
    if (!visible.length) {
      $('#history-body').innerHTML =
        '<div class="empty"><strong>Nothing matches those filters</strong>Clear the search or pick another outcome.</div>';
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
          (row.fileName && row.title !== row.fileName
            ? '<div class="card-sub" style="margin: 2px 0 0">' + esc(row.fileName) + '</div>'
            : '') +
          '</div></td>' +
          '<td data-label="Client">' +
          esc(row.clientName || '') +
          '</td>' +
          '<td data-label="Contra firm">' +
          esc(row.contraFirm || '') +
          '</td>' +
          '<td data-label="Outcome">' +
          outcome +
          '</td>' +
          '<td class="num" data-label="Issues">' +
          (typeof row.totalIssues === 'number' ? row.totalIssues : '') +
          (row.lowConfidence
            ? ' <span class="pill pill-warn"><span class="glyph">▲</span>' +
              row.lowConfidence +
              ' to verify</span>'
            : '') +
          '</td>' +
          '<td class="num" data-label="Value">' +
          esc(row.submittedValue || '') +
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
      '<th>Reference</th><th>Client</th><th>Contra firm</th><th>Outcome</th>' +
      '<th class="num">Issues</th><th class="num">Value</th><th>Submitted</th>' +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div>';
  }

  ATV.boot(function (me) {
    $('#filter-outcome').addEventListener('change', render);
    $('#filter-text').addEventListener('input', render);

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

    ATV.fetchJson('/api/history?limit=200')
      .then(function (out) {
        rows = out.rows || [];
        if (out.note) {
          $('#history-body').innerHTML =
            '<div class="notice notice-warn">' + esc(out.note) + '</div>';
          if (!rows.length) return;
        }
        render();
      })
      .catch(function (err) {
        $('#history-body').innerHTML =
          '<div class="notice notice-bad">History could not be read: ' + esc(err.message) + '</div>';
      });
  });
})();
