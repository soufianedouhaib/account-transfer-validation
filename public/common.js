/* Shared chrome, session handling and helpers. Every page loads this first,
   then its own script. Pages render nothing until /api/me answers, so a
   signed out visitor never sees a flash of a screen they are about to lose. */

(function (global) {
  'use strict';

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* A social security number never renders in full, wherever it came from.
     The workflow quotes firm records verbatim, so the masking happens here at
     the last moment rather than being trusted to every upstream string. */
  function maskSensitive(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\b(\d{3})[-\s.](\d{2})[-\s.](\d{4})\b/g, '***\u2011**\u2011$3')
      .replace(/\b\d{5}(\d{4})\b/g, '*****$1');
  }

  function escMasked(value) {
    return esc(maskSensitive(value));
  }

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Read the body as text first. A platform error page is HTML, and res.json()
     would throw a parse error that hides the status the user needs to see. */
  function fetchJson(url, options) {
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = null;
        }
        if (!res.ok) {
          var message =
            (data && (data.error || data.message)) ||
            'Request failed with status ' + res.status + '.';
          var err = new Error(message);
          err.status = res.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  function navFor(me) {
    if (!me || !me.signedIn) return [];
    var links = [];
    if (me.canSubmit) links.push({ href: '/', label: 'New validation', match: ['/', '/index.html'] });
    if (me.canReview) {
      links.push({ href: '/review.html', label: 'Review queue', match: ['/review.html'] });
      links.push({ href: '/history.html', label: 'All runs', match: ['/history.html'] });
    } else {
      links.push({ href: '/history.html', label: 'My runs', match: ['/history.html'] });
    }
    return links;
  }

  function renderNav(me) {
    var host = $('#topbar');
    if (!host) return;
    var here = location.pathname.replace(/\/index\.html$/, '/');
    var links = navFor(me)
      .map(function (item) {
        var active = item.match.indexOf(here) !== -1;
        return (
          '<a href="' + item.href + '"' + (active ? ' aria-current="page"' : '') + '>' +
          esc(item.label) +
          '</a>'
        );
      })
      .join('');

    var account = '';
    if (me && me.signedIn) {
      account =
        '<div class="account">' +
        '<div class="account-who"><span class="account-name">' +
        esc(me.name || me.email) +
        '</span><span class="account-role">' +
        esc(me.roleLabel || '') +
        '</span></div>' +
        '<button type="button" class="btn btn-quiet btn-small" id="sign-out">Sign out</button>' +
        '</div>';
    }

    host.innerHTML =
      '<div class="topbar-inner">' +
      '<a class="brand-lockup" href="' + (me && me.canReview && !me.canSubmit ? '/review.html' : '/') + '">' +
      '<img src="/logo.png" alt="Applied AI">' +
      '<span class="brand-divider"></span>' +
      '<span class="brand-app">' +
      esc(me && me.appName ? me.appName : 'Account Transfer Validation') +
      '</span>' +
      '</a>' +
      '<nav class="nav-links">' + links + '</nav>' +
      account +
      '</div>';

    var out = $('#sign-out');
    if (out) {
      out.addEventListener('click', function () {
        fetchJson('/api/logout', { method: 'POST' })
          .catch(function () {})
          .then(function () {
            location.href = me && me.canReview && !me.canSubmit ? '/review-login.html' : '/login.html';
          });
      });
    }
  }

  function renderFooter(me) {
    var host = $('#footer');
    if (!host) return;
    var bits = ['Applied AI, Account Transfer Validation'];
    if (me && me.signedIn && !me.configured) bits.push('Server not configured');
    if (me && me.signedIn && !me.historyEnabled) bits.push('History not configured');
    host.innerHTML = bits
      .map(function (b) {
        return '<span>' + esc(b) + '</span>';
      })
      .join('');
  }

  /**
   * One call for the shared chrome and the session gate.
   *   ATV.boot(fn)                      a signed in user of any role
   *   ATV.boot(fn, { need: 'reviewer' } ) reviewers and the admin only
   *   ATV.boot(fn, { need: 'public' })  sign in pages
   */
  function boot(onReady, options) {
    var need = (options && options.need) || 'user';
    fetchJson('/api/me')
      .then(function (me) {
        if (need !== 'public' && !me.signedIn) {
          location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
          return;
        }
        if (need === 'reviewer' && !me.canReview) {
          location.replace('/');
          return;
        }
        if (need === 'public' && me.signedIn) {
          location.replace(me.canReview && !me.canSubmit ? '/review.html' : '/');
          return;
        }
        renderNav(need === 'public' ? null : me);
        renderFooter(need === 'public' ? null : me);
        var main = $('#main');
        if (main) main.hidden = false;
        onReady(me);
      })
      .catch(function (err) {
        renderNav(null);
        var main = $('#main');
        if (main) {
          main.hidden = false;
          main.innerHTML =
            '<div class="card"><div class="notice notice-bad">This console could not reach its own API: ' +
            esc(err.message) +
            '</div></div>';
        }
      });
  }

  /** A 401 mid session means the cookie expired. Send them back to sign in. */
  function onAuthLoss(err) {
    if (err && err.status === 401) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return true;
    }
    return false;
  }

  var STATUS_TEXT = {
    PENDING: 'Queued',
    IN_PROGRESS: 'Running',
    WAITING: 'Waiting',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    TIMED_OUT: 'Timed out',
    UNKNOWN: 'Unknown'
  };

  function statusPill(status) {
    var label = STATUS_TEXT[status] || status || 'Unknown';
    var cls = 'pill';
    var glyph = '•';
    if (status === 'COMPLETED') {
      glyph = '▪';
      label = 'Run finished';
    } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      cls = 'pill pill-stop';
      glyph = '⊘';
      label = 'Did not finish';
    } else if (status === 'IN_PROGRESS' || status === 'PENDING' || status === 'WAITING') {
      glyph = '◷';
    }
    return '<span class="' + cls + '"><span class="glyph">' + glyph + '</span>' + esc(label) + '</span>';
  }

  function verdictPill(verdict) {
    if (verdict === 'IGO') {
      return '<span class="pill pill-ok"><span class="glyph">✓</span>In good order</span>';
    }
    if (verdict === 'NIGO') {
      return '<span class="pill pill-bad"><span class="glyph">!</span>Not in good order</span>';
    }
    return '<span class="pill">Not determined</span>';
  }

  var REVIEW_TEXT = {
    approved: { label: 'Approved', cls: 'pill pill-ok', glyph: '✓' },
    rejected: { label: 'Rejected', cls: 'pill pill-bad', glyph: '✕' },
    returned: { label: 'Sent back', cls: 'pill pill-warn', glyph: '↩' },
    pending: { label: 'Awaiting review', cls: 'pill', glyph: '◷' }
  };

  function reviewPill(state) {
    var spec = REVIEW_TEXT[state] || REVIEW_TEXT.pending;
    return '<span class="' + spec.cls + '"><span class="glyph">' + spec.glyph + '</span>' + spec.label + '</span>';
  }

  function reviewLabel(state) {
    return (REVIEW_TEXT[state] || REVIEW_TEXT.pending).label;
  }

  function severityPill(severity) {
    var s = (severity || '').toLowerCase();
    if (s === 'high') return '<span class="pill pill-bad"><span class="glyph">!</span>High</span>';
    if (s === 'medium') return '<span class="pill pill-warn"><span class="glyph">▲</span>Medium</span>';
    if (s === 'low') return '<span class="pill"><span class="glyph">▪</span>Low</span>';
    return '<span class="pill">Unrated</span>';
  }

  /* Field ids are internal. Advisors read words. */
  var FIELD_LABELS = {
    client_name: 'Client name',
    ssn: 'SSN',
    dob: 'Date of birth',
    address: 'Address',
    contra_firm: 'Contra firm',
    contra_account_number: 'Contra account number',
    nana: 'NANA code',
    registration: 'Registration',
    account_type: 'Account type',
    transfer_type: 'Transfer election',
    transfer_election: 'Transfer election',
    value: 'Account value',
    form_id: 'Form id',
    signature: 'Signature',
    signature_present: 'Signature present',
    signature_date: 'Signature date',
    medallion: 'Medallion guarantee',
    medallion_present: 'Medallion guarantee',
    firm: 'Firm',
    account_holder: 'Account holder',
    account_number: 'Account number',
    total_value: 'Total value',
    scope: 'Transfer scope'
  };

  var SECTION_LABELS = {
    consistency: 'Consistency',
    completeness: 'Completeness',
    contra_fit: 'Contra firm fit',
    consolidator: 'System'
  };

  function fieldLabel(key) {
    if (!key) return 'General';
    if (FIELD_LABELS[key]) return FIELD_LABELS[key];
    return String(key)
      .replace(/[_.]/g, ' ')
      .replace(/^./, function (c) {
        return c.toUpperCase();
      });
  }

  function sectionLabel(key) {
    return SECTION_LABELS[key] || fieldLabel(key);
  }

  /* Election tokens are workflow vocabulary. Advisors read words. */
  var TOKENS = {
    in_kind: 'In kind',
    liquidate: 'Liquidate',
    full: 'Full',
    partial: 'Partial',
    IN_GOOD_ORDER: 'In good order'
  };

  function formatValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') {
      var on = Object.keys(value).filter(function (k) {
        return value[k] === true;
      });
      if (!on.length) return null;
      var RANK = { in_kind: 0, liquidate: 1, full: 2, partial: 3 };
      return on
        .sort(function (a, b) {
          return (RANK[a] === undefined ? 9 : RANK[a]) - (RANK[b] === undefined ? 9 : RANK[b]);
        })
        .map(function (k) {
          return TOKENS[k] || fieldLabel(k);
        })
        .join(', ');
    }
    if (TOKENS[value]) return TOKENS[value];
    return String(value);
  }

  /* "form.ssn" reads as "SSN (transfer form)". Dotted paths never reach a user. */
  var PATH_PREFIX = { form: 'transfer form', statement: 'firm statement' };

  function pathLabel(path) {
    if (!path) return 'A field';
    var parts = String(path).split('.');
    if (parts.length < 2) return fieldLabel(parts[0]);
    var where = PATH_PREFIX[parts[0]];
    var leaf = fieldLabel(parts[parts.length - 1]);
    return where ? leaf + ' (' + where + ')' : leaf;
  }

  /* The workflow writes "3 issue(s)". Nobody should have to read that. */
  function tidy(text) {
    if (!text) return '';
    return String(text)
      .replace(/(\d+)([^.]{0,30}?)\b([a-z-]+)\(s\)/gi, function (m, n, middle, word) {
        return n + middle + word + (Number(n) === 1 ? '' : 's');
      })
      .replace(/\(s\)/g, 's')
      .replace(/^(IGO|NIGO)\s*-\s*/i, '')
      .replace(/^([a-z])/, function (c) {
        return c.toUpperCase();
      })
      .replace(/\bin ([a-z ]+), ([a-z ]+)\.$/i, 'in $1 and $2.');
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  global.ATV = {
    $: $,
    $$: $$,
    esc: esc,
    escMasked: escMasked,
    maskSensitive: maskSensitive,
    fetchJson: fetchJson,
    boot: boot,
    onAuthLoss: onAuthLoss,
    statusPill: statusPill,
    verdictPill: verdictPill,
    reviewPill: reviewPill,
    reviewLabel: reviewLabel,
    severityPill: severityPill,
    fieldLabel: fieldLabel,
    pathLabel: pathLabel,
    sectionLabel: sectionLabel,
    formatValue: formatValue,
    tidy: tidy,
    formatTime: formatTime,
    STATUS_TEXT: STATUS_TEXT
  };
})(window);
