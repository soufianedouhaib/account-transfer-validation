/* Both sign in pages run this. The page says which door it is with
   data-mode on the body, and the server checks that the account matches. */

(function () {
  'use strict';

  var $ = ATV.$;
  var esc = ATV.esc;
  var mode = document.body.getAttribute('data-mode') === 'reviewer' ? 'reviewer' : 'advisor';

  function showError(message, redirect) {
    var box = $('#signin-error');
    if (!message) {
      box.hidden = true;
      return;
    }
    box.innerHTML =
      '<span class="glyph">!</span> ' +
      esc(message) +
      (redirect ? ' <a href="' + esc(redirect) + '">Go to the right sign in</a>' : '');
    box.hidden = false;
  }

  function nextUrl(fallback) {
    var wanted = new URLSearchParams(location.search).get('next');
    // Only ever follow a same site path, never an absolute URL from the query.
    if (wanted && /^\/[^/\\]/.test(wanted)) return wanted;
    return fallback;
  }

  function submit(event) {
    event.preventDefault();
    showError('');
    var btn = $('#signin-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in';

    ATV.fetchJson('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('#email').value,
        password: $('#password').value,
        expect: mode
      })
    })
      .then(function (out) {
        location.href = nextUrl(out.home || '/');
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
        showError(err.message, err.body && err.body.redirect);
        $('#password').value = '';
        $('#password').focus();
      });
  }

  ATV.boot(
    function (me) {
      $('#signin-form').addEventListener('submit', submit);

      // While the built in accounts are still in use, the advisor door shows
      // the demo logins so anyone can try the console. Reviewer and admin
      // credentials are never printed on a page.
      if (mode === 'advisor' && me.demoAccounts && me.demoAccounts.length) {
        $('#demo-box').innerHTML =
          '<strong>Demo accounts for testing</strong><br>' +
          me.demoAccounts
            .map(function (a) {
              return esc(a.email) + ' with password ' + esc(a.password);
            })
            .join('<br>');
        $('#demo-box').hidden = false;
      }
      if (mode === 'reviewer' && me.demoAccounts && me.demoAccounts.length) {
        $('#demo-box').innerHTML =
          'Reviewer credentials are issued by your administrator and are not shown here.';
        $('#demo-box').hidden = false;
      }
    },
    { need: 'public' }
  );
})();
