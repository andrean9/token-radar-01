// Token Radar dashboard: board, detail view, filters, category panel,
// methodology. All data comes from rows.js (written by main.ts); the
// page makes no network request.

(function () {
  var DATA = window.TOKEN_RADAR;
  if (!DATA) return;

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  // Escape for HTML text AND attribute values: quotes included, so a
  // name or slug carrying a double quote cannot break out of an
  // attribute.
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var params = new URLSearchParams(window.location.search);
  var state = {
    search: "",
    category: params.get("category") || "",
    chain: "",
    sort: "rank",
    detail: params.get("detail") || "",
  };

  document.getElementById("kpi-protocols").textContent = DATA.count;
  document.getElementById("kpi-watchlist").textContent = DATA.watchlist_count + " / 40";
  document.getElementById("kpi-implied").textContent = money(DATA.total_implied_usd);
  document.getElementById("kpi-median").textContent = DATA.global_median_mcap_tvl.toFixed(4);
  document.getElementById("why-mean").textContent = DATA.global_mean_mcap_tvl.toFixed(4);
  document.getElementById("why-median").textContent = DATA.global_median_mcap_tvl.toFixed(4);
  document.getElementById("why-max").textContent = DATA.global_max_ratio.toFixed(4);
  document.getElementById("why-cex-mean").textContent = DATA.cex_mean_mcap_tvl.toFixed(4);
  document.getElementById("why-cex-median").textContent = DATA.cex_median_mcap_tvl.toFixed(4);

  var catSelect = document.getElementById("category-filter");
  DATA.category_summary.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c.category;
    opt.textContent = c.category + " (" + c.protocols + ")";
    catSelect.appendChild(opt);
  });
  var chains = {};
  DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = true; }); });
  var chainSelect = document.getElementById("chain-filter");
  Object.keys(chains).sort().forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    chainSelect.appendChild(opt);
  });
  if (state.category) catSelect.value = state.category;

  function filteredRows() {
    var q = state.search.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + " " + r.slug + " " + r.category).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (state.sort === "implied") rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    else if (state.sort === "tvl") rows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === "change") rows.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else rows.sort(function (a, b) { return a.rank - b.rank; });
    return rows;
  }

  function renderBoard() {
    var rows = filteredRows();
    var body = document.getElementById("board-body");
    body.innerHTML = rows.map(function (r) {
      var chg = r.change_7d === null ? "&ndash;" :
        '<span class="' + (r.change_7d >= 0 ? "pos" : "neg") + '">' +
        (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(1) + "%</span>";
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="active"' : "") + ">" +
        "<td>" + r.rank + "</td>" +
        "<td><strong>" + esc(r.name) + "</strong>" + (r.watchlist ? ' <span class="watch">WATCHLIST</span>' : "") + "</td>" +
        "<td>" + esc(r.category) + "</td>" +
        "<td>" + esc(r.chains.slice(0, 3).join(", ")) + (r.chains.length > 3 ? " +" + (r.chains.length - 3) : "") + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + chg + "</td>" +
        '<td class="num">' + money(r.implied_value_usd) + "</td>" +
        '<td class="num">' + r.score.toFixed(1) + "</td></tr>";
    }).join("");
    document.getElementById("count").textContent = rows.length + " of " + DATA.count + " protocols";
    body.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () { showDetail(tr.getAttribute("data-slug")); });
    });
  }

  function showDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    var box = document.getElementById("detail");
    if (!r) { box.hidden = true; state.detail = ""; renderBoard(); return; }
    state.detail = slug;
    box.hidden = false;
    box.innerHTML =
      '<button class="close" type="button" id="detail-close">Close</button>' +
      "<h2>" + esc(r.name) + "</h2>" +
      '<p class="meta">Rank #' + r.rank + " &middot; " + esc(r.category) + " &middot; " +
      esc(r.chains.join(", ")) + (r.watchlist ? " &middot; on the watchlist" : "") + "</p>" +
      "<dl>" +
      "<div><dt>Implied value</dt><dd>" + money(r.implied_value_usd) + "</dd></div>" +
      "<div><dt>TVL</dt><dd>" + money(r.tvl_usd) + "</dd></div>" +
      "<div><dt>Multiple</dt><dd>" + r.multiple.toFixed(4) + " (" + esc(r.multiple_source) + ", " + r.multiple_samples + " samples)</dd></div>" +
      "<div><dt>Momentum</dt><dd>" + r.momentum_factor.toFixed(4) + "</dd></div>" +
      "<div><dt>Maturity</dt><dd>" + r.maturity_factor.toFixed(4) + "</dd></div>" +
      "<div><dt>Chains</dt><dd>" + r.chains_factor.toFixed(4) + "</dd></div>" +
      "<div><dt>Score</dt><dd>" + r.score.toFixed(1) + " / 100</dd></div>" +
      "</dl>" +
      "<h3>How to farm it</h3><ol>" +
      r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
      "</ol>";
    document.getElementById("detail-close").addEventListener("click", function () { showDetail(""); });
    renderBoard();
    box.scrollIntoView({ block: "nearest" });
  }

  function renderCategories() {
    var body = document.getElementById("category-body");
    body.innerHTML = DATA.category_summary.map(function (c) {
      return '<tr data-category="' + esc(c.category) + '"' + (state.category === c.category ? ' class="active"' : "") + ">" +
        "<td><strong>" + esc(c.category) + "</strong></td>" +
        "<td>" + c.protocols + "</td>" +
        '<td class="num">' + money(c.total_tvl_usd) + "</td>" +
        '<td class="num">' + money(c.total_implied_usd) + "</td>" +
        '<td class="num">' + (c.share_of_implied * 100).toFixed(1) + "%</td>" +
        "<td>#" + c.top_protocol_rank + " " + esc(c.top_protocol_name) + "</td></tr>";
    }).join("");
    body.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () {
        var cat = tr.getAttribute("data-category");
        state.category = state.category === cat ? "" : cat;
        catSelect.value = state.category;
        renderBoard();
        renderCategories();
      });
    });
  }

  function renderTables() {
    document.getElementById("calibration-body").innerHTML = DATA.calibration.map(function (c) {
      return "<tr><td>" + esc(c.category) + "</td><td>" + c.multiple.toFixed(4) + "</td><td>" + c.samples + "</td><td>" + esc(c.source) + "</td></tr>";
    }).join("");
    document.getElementById("sensitivity-body").innerHTML = DATA.sensitivity.map(function (s) {
      return "<tr><td><strong>" + esc(s.variant) + "</strong><br><span class=\"note\">" + esc(s.changed) + "</span></td>" +
        "<td>" + s.spearman_rank_correlation.toFixed(4) + "</td>" +
        "<td>" + s.top10_overlap + " / 10</td>" +
        "<td>" + s.median_abs_rank_move + "</td>" +
        "<td>" + s.max_abs_rank_move + "</td></tr>";
    }).join("");
  }

  document.getElementById("search").addEventListener("input", function (e) {
    state.search = e.target.value;
    renderBoard();
  });
  catSelect.addEventListener("change", function (e) {
    state.category = e.target.value;
    renderBoard();
    renderCategories();
  });
  chainSelect.addEventListener("change", function (e) {
    state.chain = e.target.value;
    renderBoard();
  });
  document.getElementById("sort").addEventListener("change", function (e) {
    state.sort = e.target.value;
    renderBoard();
  });
  document.getElementById("reset-category").addEventListener("click", function () {
    state.category = "";
    catSelect.value = "";
    renderBoard();
    renderCategories();
  });

  renderBoard();
  renderCategories();
  renderTables();
  if (state.detail) showDetail(state.detail);
  if (params.get("view") === "methodology") {
    document.getElementById("methodology").scrollIntoView();
  }
})();
