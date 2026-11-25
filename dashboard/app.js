// Token Radar dashboard: board, filters, detail view, methodology.
// Data comes from rows.js (window.TOKEN_RADAR), written by main.ts.
// Fully static: no network requests. Hash routes: #detail=<slug>,
// #cat=<category>, #chain=<chain>, #methodology.
(function () {
  var D = window.TOKEN_RADAR;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function fmtUsd(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n;
  }
  function fmtChg(c) {
    if (c === null || c === undefined) return "—";
    var cls = c >= 0 ? "up" : "down";
    return '<span class="' + cls + '">' + (c >= 0 ? "+" : "") + c.toFixed(1) + "%</span>";
  }
  function $(id) { return document.getElementById(id); }

  var meta = D.meta;
  $("meta-line").textContent =
    "Snapshot " + meta.as_of + " · " + meta.count + " protocols · " +
    meta.watchlist_count + " on the watchlist · floor $" +
    (meta.floor_usd / 1e6) + "M.";
  $("why-median").textContent =
    "The mcap/TVL ratios of token-bearing protocols are wildly skewed: the global mean is " +
    meta.global_mean_mcap_tvl + " against a median of " + meta.global_median_mcap_tvl +
    ", with one protocol at " + meta.global_max_ratio +
    ". A mean multiple would price every tokenless protocol as if it were the average of a " +
    "distribution dominated by two or three outliers. The CEX category shows the same skew " +
    "inside one category: mean " + meta.cex_mean_mcap_tvl + " vs median " + meta.cex_median_mcap_tvl +
    ". So the calibration uses the median. The sensitivity table below proves the point: " +
    "swapping the median for the mean is the only variant that scrambles the ranking.";

  // Filters.
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c;
    $("cat-filter").appendChild(o);
  });
  chains.forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c;
    $("chain-filter").appendChild(o);
  });

  // Screenshot mode (?shot=detail|methodology): show only the target
  // section, so a headless capture lands on it without scrolling.
  var shot = new URLSearchParams(location.search).get("shot");
  if (shot === "detail" || shot === "methodology") {
    document.body.classList.add("shot-" + shot);
  }

  var state = { q: "", cat: "", chain: "", sort: "rank" };
  function applyHash() {
    var h = (location.hash || "").slice(1);
    var parts = {};
    h.split("&").forEach(function (kv) {
      var p = kv.split("="); if (p[0]) parts[p[0]] = decodeURIComponent(p[1] || "");
    });
    if (parts.detail) { showDetail(parts.detail); return; }
    if (parts.cat) { state.cat = parts.cat; $("cat-filter").value = parts.cat; }
    if (parts.chain) { state.chain = parts.chain; $("chain-filter").value = parts.chain; }
    render();
    if (parts.methodology) {
      var el = $("methodology");
      if (el && el.scrollIntoView) el.scrollIntoView();
    }
  }

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var s = state.sort;
    if (s === "tvl") list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s === "implied") list.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    else if (s === "change") list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function render() {
    var list = filtered();
    var tb = document.querySelector("#board tbody");
    tb.innerHTML = list.map(function (r) {
      return "<tr data-slug=\"" + r.slug + "\"><td>" + r.rank + (r.watchlist ? ' <span class="watch" title="On the watchlist">★</span>' : "") +
        "</td><td><strong>" + r.name + "</strong><br><span style=\"color:var(--mut)\">" + r.slug + "</span></td>" +
        "<td>" + r.category + "</td><td class=\"num\">" + fmtUsd(r.tvl_usd) + "</td>" +
        "<td class=\"num\">" + fmtUsd(r.implied_value_usd) + "</td><td class=\"num\">" + fmtChg(r.change_7d) + "</td>" +
        "<td class=\"num\">" + r.score.toFixed(1) + "</td></tr>";
    }).join("");
    $("count-line").textContent = list.length + " of " + rows.length + " protocols";
    tb.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () { location.hash = "detail=" + tr.getAttribute("data-slug"); });
    });
    document.querySelectorAll("#cat-table tbody tr").forEach(function (tr) {
      tr.classList.toggle("active", tr.getAttribute("data-cat") === state.cat);
    });
  }

  // Category summary panel; clicking a row filters the board.
  var ctb = document.querySelector("#cat-table tbody");
  ctb.innerHTML = D.category_summary.map(function (c) {
    return "<tr data-cat=\"" + c.category.replace(/"/g, "&quot;") + "\"><td>" + c.category + "</td>" +
      "<td class=\"num\">" + c.protocols + "</td><td class=\"num\">" + fmtUsd(c.total_tvl_usd) + "</td>" +
      "<td class=\"num\">" + fmtUsd(c.total_implied_usd) + "</td><td class=\"num\">" + (c.share_of_implied * 100).toFixed(1) + "%</td>" +
      "<td>#" + c.top_protocol_rank + " " + c.top_protocol_name + "</td></tr>";
  }).join("");
  ctb.querySelectorAll("tr").forEach(function (tr) {
    tr.addEventListener("click", function () {
      var cat = tr.getAttribute("data-cat");
      state.cat = state.cat === cat ? "" : cat;
      $("cat-filter").value = state.cat;
      render();
    });
  });

  // Calibration + sensitivity tables.
  document.querySelector("#cal-table tbody").innerHTML =
    D.calibration.map(function (c) {
      return "<tr><td>" + c.category + "</td><td class=\"num\">" + c.multiple.toFixed(4) +
        "</td><td class=\"num\">" + c.samples + "</td></tr>";
    }).join("");
  document.querySelector("#sens-table tbody").innerHTML =
    D.sensitivity.map(function (s) {
      return "<tr><td>" + s.variant + "</td><td>" + s.changed + "</td><td class=\"num\">" +
        s.spearman_rank_correlation.toFixed(4) + "</td><td class=\"num\">" + s.top10_overlap +
        "/10</td><td class=\"num\">" + s.median_abs_rank_move + "</td><td class=\"num\">" +
        s.max_abs_rank_move + "</td><td class=\"num\">" + s.rows_moved + "</td></tr>";
    }).join("");

  function showDetail(slug) {
    var r = bySlug[slug];
    var sec = $("detail");
    if (!r) { sec.hidden = true; render(); return; }
    sec.hidden = false;
    $("detail-name").textContent = "#" + r.rank + " " + r.name + (r.watchlist ? " ★ watchlist" : "");
    $("detail-body").innerHTML = "<dl>" +
      "<dt>Category</dt><dd>" + r.category + "</dd>" +
      "<dt>Chains</dt><dd>" + r.chains.join(", ") + "</dd>" +
      "<dt>TVL</dt><dd>" + fmtUsd(r.tvl_usd) + "</dd>" +
      "<dt>Implied value</dt><dd>" + fmtUsd(r.implied_value_usd) + " (" + r.implied_value_usd.toLocaleString("en-US") + " USD)</dd>" +
      "<dt>Multiple</dt><dd>" + r.multiple.toFixed(4) + " (" + r.multiple_source + ", " + r.multiple_samples + " samples)</dd>" +
      "<dt>Momentum</dt><dd>" + r.momentum_factor.toFixed(4) + " — 7d change " + (r.change_7d === null ? "n/a" : r.change_7d + "%") + "</dd>" +
      "<dt>Maturity</dt><dd>" + r.maturity_factor.toFixed(4) + " — listed " + (r.listed_at || "n/a") + "</dd>" +
      "<dt>Chains factor</dt><dd>" + r.chains_factor.toFixed(4) + " — " + r.chains.length + " chain" + (r.chains.length > 1 ? "s" : "") + "</dd>" +
      "<dt>Score</dt><dd>" + r.score.toFixed(1) + " / 100</dd></dl>";
    $("detail-steps").innerHTML = r.farm_steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
    if (sec.scrollIntoView) sec.scrollIntoView();
  }

  $("back-link").addEventListener("click", function (e) {
    e.preventDefault();
    history.pushState("", document.title, location.pathname + location.search);
    $("detail").hidden = true;
    render();
  });
  $("search").addEventListener("input", function (e) { state.q = e.target.value; render(); });
  $("cat-filter").addEventListener("change", function (e) { state.cat = e.target.value; render(); });
  $("chain-filter").addEventListener("change", function (e) { state.chain = e.target.value; render(); });
  $("sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });
  window.addEventListener("hashchange", applyHash);

  render();
  applyHash();
})();
