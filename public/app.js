/* New validation page: pick a file, upload it, start a case, hand over to the
   case page. The service key never appears here; the server mints the upload
   slot and the browser sends the bytes straight to storage. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var chosen = null;

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function showError(message) {
    var box = $('#submit-error');
    box.textContent = message;
    box.hidden = !message;
  }

  function setBusy(busy, label) {
    $('#progress').hidden = !busy;
    $('#submit-btn').disabled = busy || !chosen;
    $('#dropzone').style.pointerEvents = busy ? 'none' : '';
    if (label) $('#progress-label').textContent = label;
  }

  function pick(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showError('That file is ' + humanSize(file.size) + '. The limit is 10 MB.');
      return;
    }
    showError('');
    chosen = file;
    $('#file-name').textContent = file.name;
    $('#file-size').textContent = humanSize(file.size);
    $('#file-chip').hidden = false;
    $('#dropzone').hidden = true;
    $('#submit-btn').disabled = false;
    if (!$('#title').value) {
      $('#title').value = file.name.replace(/\.[^.]+$/, '');
    }
  }

  function clearFile() {
    chosen = null;
    $('#file-input').value = '';
    $('#file-chip').hidden = true;
    $('#dropzone').hidden = false;
    $('#submit-btn').disabled = true;
  }

  /* Direct PUT to storage keeps big files out of the serverless function.
     Some buckets do not allow a browser origin, so fall back to the server. */
  function uploadBytes(slot, file) {
    return fetch(slot.presignedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' }
    })
      .then(function (res) {
        if (res.ok) return true;
        throw new Error('Storage refused the upload with status ' + res.status + '.');
      })
      .catch(function () {
        return ATV.fetchJson('/api/upload-proxy?to=' + encodeURIComponent(slot.presignedUrl), {
          method: 'PUT',
          body: file,
          headers: { 'x-content-type': file.type || 'application/octet-stream' }
        }).then(function () {
          return true;
        });
      });
  }

  function submit(event) {
    event.preventDefault();
    if (!chosen) return;
    showError('');
    setBusy(true, 'Requesting an upload slot');

    ATV.fetchJson('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: chosen.name })
    })
      .then(function (slot) {
        setBusy(true, 'Uploading ' + chosen.name);
        return uploadBytes(slot, chosen).then(function () {
          return slot.fileUrl;
        });
      })
      .then(function (fileUrl) {
        setBusy(true, 'Starting the validation');
        return ATV.fetchJson('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileUrl: fileUrl,
            fileName: chosen.name,
            title: $('#title').value
          })
        });
      })
      .then(function (out) {
        location.href = '/case.html?id=' + encodeURIComponent(out.caseId);
      })
      .catch(function (err) {
        setBusy(false);
        showError(err.message);
      });
  }

  function renderRecent(rows) {
    if (!rows.length) {
      // Nothing to show yet, so the block stays out of the way entirely.
      $('#recent-card').hidden = true;
      return;
    }
    $('#recent-card').hidden = false;
    var body = rows
      .slice(0, 5)
      .map(function (row) {
        return (
          '<tr>' +
          '<td data-label="Reference"><a class="row-link" href="/case.html?id=' +
          encodeURIComponent(row.caseId) +
          '">' +
          esc(row.title || row.fileName || row.caseId) +
          '</a></td>' +
          '<td data-label="Client">' +
          esc(row.clientName || '') +
          '</td>' +
          '<td data-label="Outcome">' +
          (row.status === 'COMPLETED' && row.verdict
            ? ATV.verdictPill(row.verdict)
            : ATV.statusPill(row.status)) +
          '</td>' +
          '<td class="num" data-label="Issues">' +
          (row.totalIssues === null ? '' : row.totalIssues) +
          (row.lowConfidence
            ? ' <span class="pill pill-warn"><span class="glyph">▲</span>' +
              row.lowConfidence +
              ' to verify</span>'
            : '') +
          '</td>' +
          '<td data-label="Submitted">' +
          esc(ATV.formatTime(row.createdAt)) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    $('#recent-body').innerHTML =
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>Reference</th><th>Client</th><th>Outcome</th><th class="num">Issues</th><th>Submitted</th>' +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div>';
  }

  ATV.boot(function (me) {
    var zone = $('#dropzone');
    var input = $('#file-input');

    zone.addEventListener('click', function () {
      input.click();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', function () {
      zone.classList.remove('is-over');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('is-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        pick(e.dataTransfer.files[0]);
      }
    });
    input.addEventListener('change', function () {
      pick(input.files && input.files[0]);
    });
    $('#file-clear').addEventListener('click', clearFile);
    $('#submit-form').addEventListener('submit', submit);

    if (!me.configured) {
      showError(
        'The server has no Opus service key, so runs will fail. Set OPUS_SERVICE_KEY in the project environment and redeploy.'
      );
    }

    if (me.historyEnabled) {
      ATV.fetchJson('/api/history?limit=5')
        .then(function (out) {
          renderRecent(out.rows || []);
        })
        .catch(function () {
          $('#recent-card').hidden = true;
        });
    }
  });
})();
