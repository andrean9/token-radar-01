// Token Radar dashboard: renders window.TOKEN_RADAR (written by main.ts as
// rows.js beside this page). Static, no network requests.
(function () {
  var D = window.TOKEN_RADAR;
  var rowsEl = document.getElementById('rows');
  if (!D || !D.rows) {
    rowsEl.innerHTML = '<tr><td colspan="8">No board data loaded. Run main.ts to write rows.js beside this page.</td></tr>';
    return;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function moneyFull(v) {
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="muted">n/a</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + '%</span>';
  }
  function chainsShort(chains) {
    if (chains.length <= 2) return esc(chains.join(', '));
    return esc(chains.slice(0, 2).join(', ')) + ' +' + (chains.length - 2);
  }

  var state = { q: '', category: '', chain: '', sort: 'rank' };
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---- header, stats, filters -------------------------------------------
  document.getElementById('asof').textContent = D.as_of;
  document.getElementById('source').textContent = D.source;
  var totalImplied = D.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  document.getElementById('stats').innerHTML =
    '<div class="stat"><b>' + D.rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + D.watchlist_count + ' / ' + D.watchlist_count + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + money(totalImplied) + '</b><span>total implied value</span></div>' +
    '<div class="stat"><b>' + D.global_median_mcap_tvl + '</b><span>global median mcap/TVL (' + D.global_median_samples + ' samples)</span></div>';

  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  }
  var categories = Array.from(new Set(D.rows.map(function (r) { return r.category; }))).sort();
  var chains = Array.from(new Set(D.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
  fillSelect('category', categories);
  fillSelect('chain', chains);

  // ---- board ---------------------------------------------------------------
  function filtered() {
    var q = state.q.toLowerCase();
    var list = D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      return true;
    });
    var sorters = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); }
    };
    return list.sort(sorters[state.sort]);
  }

  function renderBoard() {
    var list = filtered();
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + D.rows.length + ' protocols';
    document.getElementById('empty').hidden = list.length > 0;
    rowsEl.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (r.watchlist ? '<span class="badge">watchlist</span>' : '') + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td>' + chainsShort(r.chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + r.score.toFixed(1) + '</td>' +
        '</tr>';
    }).join('');
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'), true);
  });

  // ---- detail ---------------------------------------------------------------
  var detailEl = document.getElementById('detail');
  function openDetail(slug, scroll) {
    var r = bySlug[slug];
    if (!r) return;
    var active = rowsEl.querySelector('tr.active');
    if (active) active.classList.remove('active');
    var tr = rowsEl.querySelector('tr[data-slug="' + slug + '"]');
    if (tr) tr.classList.add('active');
    var momNote = r.change_7d === null
      ? 'no 7-day change reported, so zero momentum'
      : '7-day change ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '% (capped at ±50%)';
    var matNote = r.listed_at === null
      ? 'no listing date reported, so neutral maturity'
      : 'listed ' + r.listed_at;
    detailEl.innerHTML =
      '<button class="close" id="closeDetail">Close</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' &middot; ' + esc(r.category) + ' &middot; ' + esc(r.chains.join(', ')) + (r.watchlist ? ' &middot; on the watchlist' : '') + '</p>' +
      '<div class="model">' +
      '<div><b>' + moneyFull(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + moneyFull(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div><b>' + r.score.toFixed(1) + ' / 100</b><span>composite score</span></div>' +
      '<div><b>' + r.multiple + '&times;</b><span>multiple (' + r.multiple_source + ', ' + r.multiple_samples + ' samples)</span></div>' +
      '<div><b>' + r.momentum_factor + '&times;</b><span>momentum &mdash; ' + esc(momNote) + '</span></div>' +
      '<div><b>' + r.maturity_factor + '&times;</b><span>maturity &mdash; ' + esc(matNote) + '</span></div>' +
      '<div><b>' + r.chains_factor + '&times;</b><span>chains &mdash; ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span></div>' +
      '</div>' +
      '<h3>How to farm it</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    detailEl.hidden = false;
    document.getElementById('closeDetail').addEventListener('click', function () {
      detailEl.hidden = true;
      if (history.replaceState) history.replaceState(null, '', location.pathname);
    });
    if (scroll) detailEl.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  // ---- methodology ------------------------------------------------------------
  document.getElementById('calibration').innerHTML = D.calibration.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.multiple + '&times;</td><td class="num">' + c.samples + '</td><td>' + c.source + '</td></tr>';
  }).join('');

  // ---- category summary (upgrade B): one row per category, ordered by ----
  // ---- total implied value; selecting a row filters the board. ---------
  function sharePct(v) { return (v * 100).toFixed(1) + '%'; }
  if (D.category_summary) {
    document.getElementById('categorySummary').innerHTML = D.category_summary.map(function (c) {
      return '<tr data-category="' + esc(c.category) + '">' +
        '<td><strong>' + esc(c.category) + '</strong></td>' +
        '<td class="num">' + c.protocols + '</td>' +
        '<td class="num">' + money(c.total_tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(c.total_implied_usd) + '</strong></td>' +
        '<td class="num">' + sharePct(c.share_of_implied) + '</td>' +
        '<td class="num">' + c.watchlist_count + '</td>' +
        '<td>#' + c.top_protocol_rank + ' ' + esc(c.top_protocol_name) + '</td>' +
        '</tr>';
    }).join('');
    document.getElementById('categorySummary').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-category]');
      if (!tr) return;
      state.category = tr.getAttribute('data-category');
      document.getElementById('category').value = state.category;
      renderBoard();
      document.querySelector('.board').scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }

  // ---- sensitivity (upgrade C): one changed choice per variant. -----------
  if (D.sensitivity) {
    document.getElementById('sensitivity').innerHTML = D.sensitivity.map(function (s) {
      return '<tr><td><strong>' + esc(s.variant) + '</strong></td>' +
        '<td>' + esc(s.changed) + '</td>' +
        '<td class="num">' + s.spearman_rank_correlation.toFixed(2) + '</td>' +
        '<td class="num">' + s.top10_overlap + ' / 10</td>' +
        '<td class="num">' + s.median_abs_rank_move + '</td>' +
        '<td class="num">' + s.max_abs_rank_move + '</td>' +
        '<td class="num">' + s.rows_moved + ' / ' + D.rows.length + '</td>' +
        '</tr>';
    }).join('');
  }

  // ---- controls ---------------------------------------------------------------
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-sort');
      document.getElementById('sort').value = state.sort;
      renderBoard();
    });
  });

  // ---- deep links: #detail=slug, #category=Name, #chain=Name, #methodology ----
  function applyHash() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = {};
    hash.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    if (params.category) {
      state.category = params.category;
      document.getElementById('category').value = params.category;
    }
    if (params.chain) {
      state.chain = params.chain;
      document.getElementById('chain').value = params.chain;
    }
    if (params.q) {
      state.q = params.q;
      document.getElementById('q').value = params.q;
    }
    renderBoard();
    if (params.detail) {
      openDetail(params.detail, true);
    } else if (hash === 'methodology') {
      document.getElementById('methodology').scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  renderBoard();
  applyHash();
  window.addEventListener('hashchange', applyHash);
})();
