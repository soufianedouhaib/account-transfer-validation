/* Report: a ribbon of figures that stays put, and five chapters that slide in
   beside it.

   Two series throughout, cleared and held back, so two categorical hues: the
   brand blue and an orange. Never green against red, which is the pair most
   people with colour vision deficiency cannot separate, on a page that is
   about money. The pair was checked with the validator in both modes. Colour
   is never the only channel: every series is named in the legend, every bar
   carries its figure, and every chapter has a table behind it.

   Every figure here is the workflow's own verdict. Nobody approves a packet
   afterwards, so there is no decided/undecided split to report: a finished
   run was either put straight through as in good order or held back as not
   in good order. */

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

  /* ---------------------------- counting up ----------------------------- */

  /* A figure that counts up says "this number just changed" without a label
     saying so, which is the whole point of putting the ribbon above the
     chapters. It is decoration, so anyone who has asked their system to stop
     moving things gets the final value written straight in. */
  var REDUCED =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* The handle lives on the node so changing the period mid count cancels the
     run in flight instead of leaving two of them fighting over one element. */
  function countTo(node, to, format, ms) {
    if (!node) return;
    if (node._anim) cancelAnimationFrame(node._anim);
    if (typeof to !== 'number' || !isFinite(to)) {
      node._value = null;
      node.textContent = format(to);
      return;
    }
    var from = typeof node._value === 'number' ? node._value : 0;
    node._value = to;
    if (REDUCED || from === to) {
      node.textContent = format(to);
      return;
    }
    var start = performance.now();
    var span = ms || 720;
    var step = function (now) {
      var t = Math.min((now - start) / span, 1);
      node.textContent = format(from + (to - from) * easeOut(t));
      node._anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    node._anim = requestAnimationFrame(step);
  }

  /* The same easing for something that is not text: the ring's sweep. */
  function tweenTo(node, to, apply, ms) {
    if (!node) return;
    if (node._anim) cancelAnimationFrame(node._anim);
    var from = typeof node._value === 'number' ? node._value : 0;
    node._value = to;
    if (REDUCED || from === to) {
      apply(to);
      return;
    }
    var start = performance.now();
    var span = ms || 720;
    var step = function (now) {
      var t = Math.min((now - start) / span, 1);
      apply(from + (to - from) * easeOut(t));
      node._anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    node._anim = requestAnimationFrame(step);
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
      '<span class="legend-item"><span class="swatch swatch-cleared"></span>Cleared, in good order</span>' +
      '<span class="legend-item"><span class="swatch swatch-blocked"></span>Held back, not in good order</span>';
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
    var st = report.straightThrough || {};

    var asMoney = function (v) {
      return money(Math.round(v), c);
    };

    /* The headline is the share of finished runs the workflow put through
       with nothing to chase. It is a share of runs, not of money: one large
       packet held back should not read as a collapse in performance. */
    countTo($('#k-rate'), typeof st.rate === 'number' ? st.rate * 100 : NaN, function (v) {
      return typeof v === 'number' && isFinite(v) ? Math.round(v) + '%' : '—';
    });
    $('#k-rate-sub').textContent = st.finished
      ? st.cleared + ' of ' + plural(st.finished, 'finished run')
      : 'no finished runs';

    countTo($('#k-cleared'), t.cleared ? t.cleared.amount || 0 : 0, asMoney);
    $('#k-cleared-sub').textContent = plural(t.cleared ? t.cleared.count : 0, 'run');
    countTo($('#k-blocked'), t.blocked ? t.blocked.amount || 0 : 0, asMoney);
    $('#k-blocked-sub').textContent = plural(t.blocked ? t.blocked.count : 0, 'run');

    countTo($('#k-count'), report.runs || 0, function (v) {
      return String(Math.round(v));
    });
    $('#k-count-sub').textContent = st.unfinished
      ? plural(st.unfinished, 'did not finish', 'did not finish')
      : 'all finished';

    var rt = report.runtime || {};
    countTo($('#k-speed'), typeof rt.averageMs === 'number' ? rt.averageMs : NaN, function (v) {
      return typeof v === 'number' && isFinite(v) ? ATV.duration(Math.round(v)) : '—';
    });
    $('#k-speed-sub').textContent = rt.runs ? plural(rt.runs, 'run') + ' timed' : 'no timed runs';
  }

  /* ---------------------------- chapter panels -------------------------- */

  function panelHeadline(report) {
    var root = $('#tpl-headline').content.cloneNode(true);
    var t = report.totals || {};
    var c = report.currency;
    var st = report.straightThrough || {};
    var share = typeof st.rate === 'number' ? st.rate : null;
    var decided = (t.cleared.amount || 0) + (t.blocked.amount || 0);

    var asMoney = function (v) {
      return money(Math.round(v), c);
    };

    fill(root, 'period').textContent = describeRange(report.range || {});
    /* The panel is built fresh every time the chapter is opened, so these
       start at zero and run up: opening the chapter is what plays them. */
    countTo(fill(root, 'cleared'), t.cleared.amount || 0, asMoney, 840);
    fill(root, 'cleared-sub').textContent =
      'cleared in good order across ' + plural(t.cleared.count, 'run');
    countTo(fill(root, 'blocked'), t.blocked.amount || 0, asMoney, 840);
    fill(root, 'blocked-sub').textContent =
      'held back as not in good order across ' + plural(t.blocked.count, 'run');

    /* The ring is one proportion, so it is a figure rather than a chart: the
       number is written inside it and the caption says what it is of. */
    var arc = fill(root, 'arc');
    var circumference = 2 * Math.PI * 48;
    /* A round cap on a zero length arc still paints a dot, which reads as a
       sliver of success where there is none. Nothing finished, nothing drawn. */
    arc.style.display = share === null ? 'none' : '';
    tweenTo(
      arc,
      share === null ? 0 : share,
      function (v) {
        var swept = v * circumference;
        arc.setAttribute('stroke-dasharray', swept + ' ' + (circumference - swept));
      },
      840
    );
    countTo(
      fill(root, 'pct'),
      share === null ? NaN : share * 100,
      function (v) {
        return typeof v === 'number' && isFinite(v) ? Math.round(v) + '%' : '—';
      },
      840
    );
    fill(root, 'ring-label').setAttribute(
      'aria-label',
      share === null
        ? 'No run finished in this period'
        : Math.round(share * 100) + ' per cent of finished runs went straight through'
    );
    fill(root, 'ring-note').textContent =
      share === null
        ? 'No run has finished in this period yet.'
        : st.cleared + ' of ' + plural(st.finished, 'finished run') + ' needed no fixing';

    var facts = fill(root, 'facts');
    [
      {
        k: 'Value the workflow saw',
        v: money(decided, c),
        sub: plural(st.finished, 'finished run')
      },
      {
        k: 'Issues raised',
        v: String((report.issues && report.issues.total) || 0),
        sub: t.blocked.count
          ? 'across ' + plural(t.blocked.count, 'packet') + ' held back'
          : 'nothing was held back'
      },
      {
        k: 'Did not finish',
        v: plural(st.unfinished || 0, 'run'),
        sub: 'no verdict was produced'
      }
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
      peak = Math.max(peak, m.cleared.amount, m.blocked.amount);
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
        var v = Math.max(m.cleared.amount, m.blocked.amount);
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
          one('cleared', centre - barW - gap / 2) +
          one('blocked', centre + gap / 2) +
          '<text class="axis-text" x="' + centre + '" y="' + (H - 16) + '" text-anchor="middle">' +
          esc(ATV.monthLabel(m.key)) +
          '</text>'
        );
      })
      .join('');

    return (
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Value cleared against value held back, by month">' +
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
    fill(root, 'title').textContent = 'Value cleared against value held back, by month submitted';

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
        '<td class="num">' + esc(money(m.cleared.amount, report.currency)) + '</td>' +
        '<td class="num">' + esc(money(m.blocked.amount, report.currency)) + '</td>' +
        '<td class="num">' + (m.cleared.count + m.blocked.count + m.unfinished.count) + '</td>';
      body.appendChild(tr);
    });
    return root;
  }

  /* Ranked rows: one bar per name, cleared and held back side by side in the
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
      var clearedPct = (r.cleared / peak) * 100;
      var blockedPct = (r.blocked / peak) * 100;
      /* Widths start at nothing and are set once the row is on screen, so the
         bars grow in with the same easing as the figures above them. */
      row.innerHTML =
        '<span class="rank-name" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
        '<span class="rank-track">' +
        '<span class="rank-bar rank-cleared" data-w="' + clearedPct.toFixed(2) + '"></span>' +
        '<span class="rank-bar rank-blocked" data-w="' + blockedPct.toFixed(2) + '"></span>' +
        '</span>' +
        '<span class="rank-value">' + esc(money(r.total, report.currency)) + '</span>' +
        '<span class="rank-runs">' + plural(r.runs, 'run') +
        (r.unfinished ? ', ' + r.unfinished + ' unfinished' : '') +
        '</span>';
      host.appendChild(row);
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
          'Value put through per employee',
          'Nobody has had a run finish in this period.'
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
          'Value put through per delivering firm',
          'No delivering firm was read from the packets in this period.'
        );
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

    growBars(host);
  }

  /* Ranked bars grow from nothing on the frame after they are placed. Setting
     the width in the same frame the row is inserted gives the browser nothing
     to transition from, so it is deliberately one frame later. */
  function growBars(host) {
    var bars = ATV.$$('.rank-bar[data-w]', host);
    if (!bars.length) return;
    var paint = function () {
      bars.forEach(function (bar) {
        bar.style.width = bar.getAttribute('data-w') + '%';
      });
    };
    if (REDUCED) paint();
    else requestAnimationFrame(function () { requestAnimationFrame(paint); });
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
          '<span>' + esc(hit.getAttribute('data-kind') === 'cleared' ? 'Cleared' : 'Held back') + '</span>' +
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

  /* The default is the dirham total across every currency, because that is
     the one number a manager is after. Pinning the report to one currency
     stays available beside it, and then the printed amounts are left alone. */
  function renderCurrency(report) {
    var select = $('#filter-currency');
    var list = report.currencies || [];
    if (!list.length) {
      select.hidden = true;
      return;
    }
    var options = ['<option value="">Total in AED</option>'].concat(
      list.map(function (c) {
        var label = c === 'unlabelled' ? 'No currency' : esc(c) + ' only';
        return '<option value="' + esc(c) + '">' + label + '</option>';
      })
    );
    var markup = options.join('');
    if (select.innerHTML !== markup) select.innerHTML = markup;
    select.value = report.converted ? '' : report.currency;
    select.hidden = false;
  }

  /* A converted total is only honest if the rate is on the page, so the rate
     used for each currency present, and the day it was taken, are printed
     under the ribbon along with anything the total could not take in. */
  function renderFxNote(report) {
    var note = $('#fx-note');
    var info = report.fx;
    if (!report.converted || !info) {
      note.hidden = true;
      note.textContent = '';
      return;
    }

    /* The server names the rate it applied to each currency it found, so the
       page never has to guess that "$" means dollars. */
    var used = (info.used || []).filter(function (r) {
      return r.code !== 'AED';
    });

    var parts = [];
    if (used.length) {
      parts.push(
        'Converted to AED at ' +
          used
            .map(function (r) {
              return '1 ' + r.code + ' = ' + r.rate + ' AED';
            })
            .join(', ') +
          (info.asOf ? ', rates of ' + info.asOf : '')
      );
    } else {
      parts.push('Every amount in this period is already in AED.');
    }
    if (info.skippedRuns) {
      parts.push(
        plural(info.skippedRuns, 'run') +
          ' left out of the total: no rate for ' +
          info.skippedCurrencies
            .map(function (c) {
              return c === 'unlabelled' ? 'amounts with no currency' : c;
            })
            .join(', ')
      );
    }
    note.textContent = parts.join(' · ');
    note.hidden = false;
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

        renderCurrency(report);
        renderFxNote(report);
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
    { need: 'admin' }
  );
})();
