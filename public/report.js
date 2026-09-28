/* Report: a ribbon of figures that stays put, and five chapters that slide in
   beside it.

   Two series throughout, approved and rejected, so two categorical hues: the
   brand blue and an orange. Never green against red, which is the pair most
   people with colour vision deficiency cannot separate, on a page that is
   about money. The pair was checked with the validator in both modes. Colour
   is never the only channel: every series is named in the legend, every bar
   carries its figure, and every chapter has a table or a list behind it. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var current = null;
  var chapter = 0;

  /* ------------------------------ helpers ------------------------------ */

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function fill(root, slot) {
    return root.querySelector('[data-slot="' + slot + '"]');
  }

  function money(value, currency) {
    return ATV.money(value, currency) || (currency ? ATV.money(0, currency) : '0');
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }

  function legendInto(host) {
    if (!host) return;
    host.innerHTML =
      '<span class="legend-item"><span class="swatch swatch-approved"></span>Approved</span>' +
      '<span class="legend-item"><span class="swatch swatch-rejected"></span>Rejected</span>';
  }

  function currentRange() {
    var preset = $('#filter-preset').value;
    if (preset === 'custom') return { from: $('#filter-from').value, to: $('#filter-to').value };
    return ATV.rangeFor(preset, $('#filter-month').value);
  }

  function describeRange(range) {
    if (!range.from && !range.to) return 'All time';
    if (range.from && range.to) {
      return range.from === range.to ? range.from : range.from + ' to ' + range.to;
    }
    return range.from ? 'From ' + range.from : 'Up to ' + range.to;
  }

  /* ------------------------------ the ribbon ---------------------------- */

  function renderRibbon(report) {
    var t = report.totals || {};
    var c = report.currency;
    var decided = (t.approved.amount || 0) + (t.rejected.amount || 0);
    var share = decided > 0 ? Math.round((t.approved.amount / decided) * 100) : null;

    $('#k-approved').textContent = money(t.approved.amount, c);
    $('#k-approved-sub').textContent = plural(t.approved.count, 'run');
    $('#k-rejected').textContent = money(t.rejected.amount, c);
    $('#k-rejected-sub').textContent = plural(t.rejected.count, 'run');
    $('#k-rate').textContent = share === null ? '—' : share + '%';
    $('#k-count').textContent = String(report.runs || 0);
    $('#k-count-sub').textContent = t.pending.count
      ? plural(t.pending.count, 'still waiting', 'still waiting')
      : 'all decided';

    var rt = report.runtime || {};
    $('#k-speed').textContent = typeof rt.averageMs === 'number' ? ATV.duration(rt.averageMs) : '—';
    $('#k-speed-sub').textContent = rt.runs ? plural(rt.runs, 'run') + ' timed' : 'no timed runs';
  }

  /* ---------------------------- chapter panels -------------------------- */

  function panelHeadline(report) {
    var root = $('#tpl-headline').content.cloneNode(true);
    var t = report.totals || {};
    var c = report.currency;
    var decided = (t.approved.amount || 0) + (t.rejected.amount || 0);
    var share = decided > 0 ? t.approved.amount / decided : null;

    fill(root, 'period').textContent = describeRange(report.range || {});
    fill(root, 'approved').textContent = money(t.approved.amount, c);
    fill(root, 'approved-sub').textContent = 'approved across ' + plural(t.approved.count, 'run');
    fill(root, 'rejected').textContent = money(t.rejected.amount, c);
    fill(root, 'rejected-sub').textContent = 'rejected across ' + plural(t.rejected.count, 'run');

    /* The ring is one proportion, so it is a figure rather than a chart: the
       number is written inside it and the caption says what it is of. */
    var arc = fill(root, 'arc');
    var circumference = 2 * Math.PI * 48;
    var swept = share === null ? 0 : share * circumference;
    arc.setAttribute('stroke-dasharray', swept + ' ' + (circumference - swept));
    fill(root, 'pct').textContent = share === null ? '—' : Math.round(share * 100) + '%';
    fill(root, 'ring-label').setAttribute(
      'aria-label',
      share === null
        ? 'No decided value in this period'
        : Math.round(share * 100) + ' per cent of decided value was approved'
    );
    fill(root, 'ring-note').textContent =
      share === null
        ? 'Nothing has been decided in this period yet.'
        : money(t.approved.amount, c) + ' approved of ' + money(decided, c) + ' decided';

    var facts = fill(root, 'facts');
    [
      { k: 'Sent back for a fix', v: plural(t.returned.count, 'run'), sub: money(t.returned.amount, c) },
      { k: 'Waiting for a decision', v: plural(t.pending.count, 'run'), sub: money(t.pending.amount, c) },
      { k: 'Did not finish', v: plural(t.unfinished.count, 'run'), sub: 'no decision was possible' }
    ].forEach(function (fact) {
      var box = el('div', 'fact');
      box.innerHTML =
        '<span class="fact-k">' + esc(fact.k) + '</span>' +
        '<span class="fact-v">' + esc(fact.v) + '</span>' +
        '<span class="fact-s">' + esc(fact.sub) + '</span>';
      facts.appendChild(box);
    });

    return root;
  }

  /* A grouped bar chart drawn as plain SVG, sized to the box it is given so
     one SVG unit is one CSS pixel and no label is scaled down with it. */
  function monthsChart(report, width) {
    var months = report.months || [];
    var W = Math.max(280, Math.min(width || 860, 1000));
    var narrow = W < 560;
    var H = narrow ? 290 : 320;
    var padL = narrow ? 46 : 68;
    var padR = narrow ? 10 : 16;
    var padT = 16;
    var padB = narrow ? 40 : 44;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var peak = 0;
    months.forEach(function (m) {
      peak = Math.max(peak, m.approved.amount, m.rejected.amount);
    });
    if (peak <= 0) peak = 1;
    var step = Math.pow(10, Math.floor(Math.log10(peak)));
    var top = Math.ceil(peak / step) * step;

    var slot = plotW / months.length;
    var barW = Math.min(narrow ? 24 : 42, Math.max(9, (slot - (narrow ? 12 : 18)) / 2));
    var gap = 2; // the surface gap the mark specs ask for between adjacent bars

    var y = function (v) {
      return padT + plotH - (v / top) * plotH;
    };

    var grid = [0, 0.25, 0.5, 0.75, 1]
      .map(function (f) {
        var yy = y(top * f);
        return (
          '<line class="grid-line" x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '"/>' +
          '<text class="axis-text" x="' + (padL - 10) + '" y="' + (yy + 4) + '" text-anchor="end">' +
          esc(ATV.moneyShort(top * f, report.currency)) +
          '</text>'
        );
      })
      .join('');

    var tallest = months.reduce(
      function (best, m, i) {
        var v = Math.max(m.approved.amount, m.rejected.amount);
        return v > best.v ? { v: v, i: i } : best;
      },
      { v: -1, i: -1 }
    );

    var bars = months
      .map(function (m, i) {
        var centre = padL + slot * i + slot / 2;
        var one = function (kind, x) {
          var value = m[kind].amount;
          var h = Math.max(value > 0 ? 3 : 0, padT + plotH - y(value));
          var r = h >= 4 ? 4 : h;
          return (
            '<rect class="bar-' + kind + '" x="' + x + '" y="' + (padT + plotH - h) + '" width="' + barW +
            '" height="' + h + '" rx="' + r + '"/>' +
            '<rect class="hit" x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + plotH +
            '" data-month="' + esc(m.key) + '" data-kind="' + kind + '" data-amount="' +
            esc(ATV.money(value, report.currency)) + '" data-count="' + m[kind].count + '"/>' +
            (i === tallest.i && value > 0
              ? '<text class="value-text" x="' + (x + barW / 2) + '" y="' + (padT + plotH - h - 6) +
                '" text-anchor="middle">' + esc(ATV.moneyShort(value, report.currency)) + '</text>'
              : '')
          );
        };
        return (
          one('approved', centre - barW - gap / 2) +
          one('rejected', centre + gap / 2) +
          '<text class="axis-text" x="' + centre + '" y="' + (H - 16) + '" text-anchor="middle">' +
          esc(ATV.monthLabel(m.key)) +
          '</text>'
        );
      })
      .join('');

    return (
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Approved against rejected amounts by month">' +
      grid +
      '<line class="axis-line" x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) +
      '" y2="' + (padT + plotH) + '"/>' +
      bars +
      '</svg>'
    );
  }

  function panelMonths(report) {
    var root = $('#tpl-months').content.cloneNode(true);
    var months = report.months || [];
    legendInto(fill(root, 'legend'));
    fill(root, 'title').textContent = 'Month by month, by the month it was submitted';

    if (!months.length) {
      fill(root, 'empty').hidden = false;
      return root;
    }

    /* The chart is drawn at the width it will be shown at, which is not known
       until the panel is in the page, so it is filled in a beat later. */
    var host = fill(root, 'chart');
    host.setAttribute('data-needs-chart', '1');

    var body = fill(root, 'table');
    months.forEach(function (m) {
      var tr = el('tr');
      tr.innerHTML =
        '<td>' + esc(ATV.monthLabel(m.key)) + '</td>' +
        '<td class="num">' + esc(money(m.approved.amount, report.currency)) + '</td>' +
        '<td class="num">' + esc(money(m.rejected.amount, report.currency)) + '</td>' +
        '<td class="num">' +
        (m.approved.count + m.rejected.count + m.returned.count + m.pending.count + m.unfinished.count) +
        '</td>';
      body.appendChild(tr);
    });
    return root;
  }

  /* Ranked rows: one bar per name, approved and rejected side by side in the
     same row, each row labelled with its total. Horizontal because the labels
     are names, and a name reads along a row rather than turned on its side. */
  function panelRank(report, rows, eyebrow, title, emptyNote) {
    var root = $('#tpl-rank').content.cloneNode(true);
    fill(root, 'eyebrow').textContent = eyebrow;
    fill(root, 'title').textContent = title;
    legendInto(fill(root, 'legend'));

    var shown = (rows || []).filter(function (r) {
      return r.total > 0 || r.runs > 0;
    });
    if (!shown.length) {
      fill(root, 'empty').hidden = false;
      fill(root, 'empty').innerHTML = '<strong>Nothing to rank yet</strong>' + esc(emptyNote);
      return root;
    }

    var peak = shown.reduce(function (n, r) {
      return Math.max(n, r.total);
    }, 0) || 1;

    var host = fill(root, 'rank');
    shown.slice(0, 8).forEach(function (r) {
      var row = el('div', 'rank-row');
      var approvedPct = (r.approved / peak) * 100;
      var rejectedPct = (r.rejected / peak) * 100;
      row.innerHTML =
        '<span class="rank-name" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
        '<span class="rank-track">' +
        '<span class="rank-bar rank-approved" style="width:' + approvedPct.toFixed(2) + '%"></span>' +
        '<span class="rank-bar rank-rejected" style="width:' + rejectedPct.toFixed(2) + '%"></span>' +
        '</span>' +
        '<span class="rank-value">' + esc(money(r.total, report.currency)) + '</span>' +
        '<span class="rank-runs">' + plural(r.runs, 'run') +
        (r.undecided ? ', ' + r.undecided + ' undecided' : '') +
        '</span>';
      host.appendChild(row);
    });
    return root;
  }

  function panelWaiting(report) {
    var root = $('#tpl-waiting').content.cloneNode(true);
    var waiting = report.waiting || [];
    fill(root, 'title').textContent = waiting.length
      ? plural(waiting.length, 'run') + ' waiting for a decision'
      : 'Nothing is waiting';

    if (!waiting.length) {
      fill(root, 'empty').hidden = false;
      return root;
    }

    var host = fill(root, 'list');
    waiting.forEach(function (row) {
      var item = el('a', 'waiting-row');
      item.href = '/case.html?id=' + encodeURIComponent(row.caseId);
      var age = row.waitingDays === null
        ? ''
        : row.waitingDays === 0
          ? 'today'
          : plural(row.waitingDays, 'day') + ' ago';
      item.innerHTML =
        '<span class="waiting-main">' +
        '<b>' + esc(row.title || row.clientName || 'Case ' + row.caseId) + '</b>' +
        '<span class="waiting-sub">' +
        esc([row.clientName, row.contraFirm].filter(Boolean).join(' · ')) +
        '</span></span>' +
        '<span class="waiting-meta">' +
        (row.verdict ? ATV.verdictPill(row.verdict) : '') +
        '</span>' +
        '<span class="waiting-value">' + esc(row.submittedValue || '') + '</span>' +
        '<span class="waiting-age">' +
        esc(row.submittedByName || '') +
        (age ? '<span class="waiting-when">submitted ' + esc(age) + '</span>' : '') +
        '</span>';
      host.appendChild(item);
    });
    return root;
  }

  /* ------------------------------ chapters ------------------------------ */

  var CHAPTERS = [
    {
      title: 'Headline',
      blurb: 'The period at a glance',
      build: function (report) {
        return panelHeadline(report);
      }
    },
    {
      title: 'Over time',
      blurb: 'Month by month',
      build: function (report) {
        return panelMonths(report);
      }
    },
    {
      title: 'By employee',
      blurb: 'Who submitted what',
      build: function (report) {
        return panelRank(
          report,
          report.people,
          'By employee',
          'Decided value per employee',
          'Nobody has had a run decided in this period.'
        );
      }
    },
    {
      title: 'By firm',
      blurb: 'Where transfers come from',
      build: function (report) {
        return panelRank(
          report,
          report.firms,
          'By delivering firm',
          'Decided value per delivering firm',
          'No delivering firm was read from the packets in this period.'
        );
      }
    },
    {
      title: 'Still waiting',
      blurb: 'Runs with no decision',
      build: function (report) {
        return panelWaiting(report);
      }
    }
  ];

  function renderChapterList() {
    var host = $('#chapter-list');
    host.innerHTML = '';
    CHAPTERS.forEach(function (ch, i) {
      var b = el('button', 'chapter' + (i === chapter ? ' is-current' : ''));
      b.type = 'button';
      b.setAttribute('aria-current', i === chapter ? 'true' : 'false');
      b.innerHTML =
        '<span class="chapter-num">' + (i + 1) + '</span>' +
        '<span class="chapter-text"><span class="chapter-title">' + esc(ch.title) + '</span>' +
        '<span class="chapter-blurb">' + esc(ch.blurb) + '</span></span>';
      b.addEventListener('click', function () {
        if (chapter === i) return;
        chapter = i;
        renderChapterList();
        renderChapter();
      });
      host.appendChild(b);
    });
  }

  function renderChapter() {
    var host = $('#chapter-body');
    host.innerHTML = '';
    if (!current) return;
    host.appendChild(CHAPTERS[chapter].build(current));

    /* Anything that had to know its own width is filled once it is on screen. */
    var chartHost = host.querySelector('[data-needs-chart]');
    if (chartHost) {
      chartHost.innerHTML = monthsChart(current, Math.round(chartHost.clientWidth));
      wireTooltip(host);
    }
  }

  /* ------------------------------ the hover ----------------------------- */

  function wireTooltip(scope) {
    var tip = $('#chart-tip');
    if (!tip) {
      tip = el('div', 'chart-tip');
      tip.id = 'chart-tip';
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    ATV.$$('.hit', scope).forEach(function (hit) {
      hit.addEventListener('mouseenter', function (event) {
        tip.innerHTML =
          '<b>' + esc(ATV.monthLabel(hit.getAttribute('data-month'))) + '</b>' +
          '<span>' + esc(hit.getAttribute('data-kind') === 'approved' ? 'Approved' : 'Rejected') + '</span>' +
          '<span>' + esc(hit.getAttribute('data-amount')) + '</span>' +
          '<span>' + plural(Number(hit.getAttribute('data-count')), 'run') + '</span>';
        tip.hidden = false;
        tip.style.left = event.clientX + 14 + 'px';
        tip.style.top = event.clientY - 12 + 'px';
      });
      hit.addEventListener('mousemove', function (event) {
        tip.style.left = event.clientX + 14 + 'px';
        tip.style.top = event.clientY - 12 + 'px';
      });
      hit.addEventListener('mouseleave', function () {
        tip.hidden = true;
      });
    });
  }

  /* -------------------------------- load -------------------------------- */

  function syncControls() {
    var preset = $('#filter-preset').value;
    $('#filter-month').hidden = preset !== 'month';
    $('#custom-wrap').hidden = preset !== 'custom';
    if (preset === 'month' && !$('#filter-month').value) {
      $('#filter-month').value = new Date().toISOString().slice(0, 7);
    }
    if (preset === 'custom' && !$('#filter-from').value) {
      var start = ATV.rangeFor('last-90');
      $('#filter-from').value = start.from;
      $('#filter-to').value = start.to;
    }
  }

  function load() {
    var range = currentRange();
    var query = ATV.rangeQuery(range);
    var currency = $('#filter-currency').value;
    if (currency) query += (query ? '&' : '') + 'currency=' + encodeURIComponent(currency);
    $('#export-link').href = '/api/export.csv' + (query ? '?' + query : '');

    ATV.fetchJson('/api/report' + (query ? '?' + query : ''))
      .then(function (report) {
        if (!report.configured) {
          $('#report-note').hidden = false;
          $('#report-note').textContent = report.note || 'Reporting needs run history.';
          $('#chapter-body').innerHTML = '';
          return;
        }
        $('#report-note').hidden = true;
        current = report;
        renderRibbon(report);
        renderChapterList();
        renderChapter();

        var select = $('#filter-currency');
        if (report.currencies && report.currencies.length > 1) {
          if (select.options.length !== report.currencies.length) {
            select.innerHTML = report.currencies
              .map(function (c) {
                return '<option value="' + esc(c) + '">' + esc(c) + ' amounts</option>';
              })
              .join('');
            select.value = report.currency;
          }
          select.hidden = false;
        } else {
          select.hidden = true;
        }
      })
      .catch(function (err) {
        if (ATV.onAuthLoss(err)) return;
        $('#report-note').hidden = false;
        $('#report-note').textContent = 'The report could not be read: ' + err.message;
      });
  }

  ATV.boot(
    function () {
      ['#filter-preset', '#filter-month', '#filter-from', '#filter-to', '#filter-currency'].forEach(
        function (sel) {
          $(sel).addEventListener('change', function () {
            syncControls();
            load();
          });
        }
      );
      syncControls();
      load();

      /* Redraw the month chart when its column changes width, so it is always
         drawn at the size it is shown at. Debounced: a drag across the window
         edge fires this continuously. */
      var lastWidth = 0;
      var timer = null;
      window.addEventListener('resize', function () {
        var host = document.querySelector('[data-needs-chart]');
        if (!host || !current) return;
        var width = Math.round(host.clientWidth);
        if (Math.abs(width - lastWidth) < 8) return;
        lastWidth = width;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          host.innerHTML = monthsChart(current, width);
          wireTooltip($('#chapter-body'));
        }, 120);
      });
    },
    { need: 'reviewer' }
  );
})();
