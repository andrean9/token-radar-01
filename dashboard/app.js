// Token Radar dashboard: renders the board written by main.ts.
// No network: every byte the page needs is in rows.js beside it.
(function () {
  const data = window.RADAR_DATA;
  const rows = data.rows;
  const totalImplied = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtUsd(value) {
    if (value >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
    if (value >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
    if (value >= 1e3) return "$" + (value / 1e3).toFixed(1) + "K";
    return "$" + value;
  }

  function fmtPct(value) {
    return (value * 100).toFixed(1) + "%";
  }

  function fmtChange(value) {
    if (value === null || value === undefined) return "—";
    const sign = value > 0 ? "+" : "";
    const cls = value > 0 ? "pos" : value < 0 ? "neg" : "";
    return '<span class="' + cls + '">' + sign + value.toFixed(2) + "%</span>";
  }

  const state = { search: "", category: "", chain: "", sort: "rank", selected: null };

  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (state.category && (r.category || "") !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
      return true;
    });
    const by = {
      rank: (a, b) => a.rank - b.rank,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
      change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
      name: (a, b) => (a.name < b.name ? -1 : 1),
    }[state.sort] || ((a, b) => a.rank - b.rank);
    return list.sort(by);
  }

  function renderBoard() {
    const list = filteredRows();
    const body = document.getElementById("boardBody");
    body.innerHTML = list
      .map((r) => {
        const share = r.implied_value_usd / totalImplied;
        return (
          "<tr data-slug=\"" + esc(r.slug) + "\"" + (state.selected === r.slug ? " class=\"selected\"" : "") + ">" +
          "<td class=\"num\">" + r.rank + "</td>" +
          "<td>" + esc(r.name) + (r.watchlist ? "<span class=\"badge\">watchlist</span>" : "") + "</td>" +
          "<td>" + esc(r.category || "—") + "</td>" +
          "<td class=\"num\">" + fmtUsd(r.tvl_usd) + "</td>" +
          "<td class=\"num\">" + fmtChange(r.change_7d) + "</td>" +
          "<td class=\"num\">" + fmtUsd(r.implied_value_usd) + "</td>" +
          "<td class=\"num\">" + fmtPct(share) + "</td>" +
          "<td class=\"num\">" + r.score.toFixed(1) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    document.getElementById("resultCount").textContent =
      list.length + " of " + rows.length + " protocols";
    body.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => showDetail(tr.getAttribute("data-slug")));
    });
  }

  function showDetail(slug) {
    const r = rows.find((row) => row.slug === slug);
    if (!r) return;
    state.selected = slug;
    const box = document.getElementById("detail");
    const share = r.implied_value_usd / totalImplied;
    box.hidden = false;
    box.innerHTML =
      "<button class=\"close\" type=\"button\">Close</button>" +
      "<h2>" + esc(r.name) + (r.watchlist ? "<span class=\"badge\">watchlist</span>" : "") + "</h2>" +
      "<p class=\"muted\">Rank " + r.rank + " &middot; " + esc(r.category || "no category") +
      " &middot; " + esc(r.chains.join(", ")) + " &middot; listed " + esc(r.listed_at || "unknown") + "</p>" +
      "<div class=\"facts\">" +
      "<span>Implied value <b>" + fmtUsd(r.implied_value_usd) + "</b></span>" +
      "<span>Share of implied value <b>" + fmtPct(share) + "</b></span>" +
      "<span>Score <b>" + r.score.toFixed(1) + "</b></span>" +
      "<span>TVL <b>" + fmtUsd(r.tvl_usd) + "</b></span>" +
      "<span>7d <b>" + (r.change_7d === null ? "—" : r.change_7d.toFixed(2) + "%") + "</b></span>" +
      "</div>" +
      "<p>Why this rank: multiple <b>" + r.multiple.toFixed(4) + "</b> from " +
      (r.multiple_source === "category" ? "its category" : "the global fallback") +
      " (" + r.multiple_samples + " samples) &times; momentum <b>" + r.momentum_factor.toFixed(4) +
      "</b> &times; maturity <b>" + r.maturity_factor.toFixed(4) +
      "</b> &times; chains <b>" + r.chains_factor.toFixed(4) + "</b>.</p>" +
      "<h3>Farm plan</h3><ol>" +
      r.farm_steps.map((s) => "<li>" + esc(s) + "</li>").join("") +
      "</ol>";
    box.querySelector(".close").addEventListener("click", () => {
      box.hidden = true;
      state.selected = null;
      renderBoard();
    });
    renderBoard();
    box.scrollIntoView({ block: "nearest" });
  }

  function renderCats() {
    const body = document.getElementById("catBody");
    body.innerHTML = data.category_summary
      .map((c) => {
        return (
          "<tr data-cat=\"" + esc(c.category) + "\"" + (state.category === c.category ? " class=\"active\"" : "") + ">" +
          "<td>" + esc(c.category) + "</td>" +
          "<td class=\"num\">" + c.protocols + "</td>" +
          "<td class=\"num\">" + fmtUsd(c.total_implied_usd) + "</td>" +
          "<td class=\"num\">" + fmtPct(c.share_of_implied) + "</td>" +
          "<td>#" + c.top_protocol_rank + " " + esc(c.top_protocol_name) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    body.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const cat = tr.getAttribute("data-cat");
        state.category = state.category === cat ? "" : cat;
        document.getElementById("categoryFilter").value = state.category;
        renderCats();
        renderBoard();
      });
    });
  }

  function renderMeta() {
    document.getElementById("asOf").textContent = data.as_of;
    document.getElementById("footAsOf").textContent = data.as_of;
    document.getElementById("kpiRows").textContent = data.count;
    document.getElementById("kpiWatch").textContent = data.watchlist_count + " / " + data.watchlist_count;
    document.getElementById("kpiTotal").textContent = fmtUsd(totalImplied);
    document.getElementById("kpiMedian").textContent = data.global_median_mcap_tvl.toFixed(4);
    document.getElementById("whyMedian").textContent =
      "Among the " + data.global_median_samples + " token-bearing protocols with market-cap data, " +
      "the mean mcap/TVL ratio is " + data.global_mean_mcap_tvl.toFixed(4) + " but the median is only " +
      data.global_median_mcap_tvl.toFixed(4) + ", and the largest ratio is " +
      data.global_max_ratio.toFixed(4) + ". A handful of giants pull the mean far above the typical " +
      "protocol, so the mean would overstate most launches. The median tracks the typical protocol. " +
      "The same gap shows inside CEX: mean " + data.cex_mean_mcap_tvl.toFixed(4) + " against a median of " +
      data.cex_median_mcap_tvl.toFixed(4) + ".";
    document.getElementById("calBody").innerHTML = data.calibration
      .map((c) => "<tr><td>" + esc(c.category) + "</td><td class=\"num\">" + c.multiple.toFixed(4) +
        "</td><td class=\"num\">" + c.samples + "</td><td>" + esc(c.source) + "</td></tr>")
      .join("");
    document.getElementById("sensBody").innerHTML = data.sensitivity
      .map((s) => "<tr><td>" + esc(s.variant) + "</td><td>" + esc(s.changed) + "</td><td class=\"num\">" +
        s.spearman_rank_correlation.toFixed(4) + "</td><td class=\"num\">" + s.top10_overlap +
        "</td><td class=\"num\">" + s.median_abs_rank_move + "</td><td class=\"num\">" + s.max_abs_rank_move +
        "</td><td class=\"num\">" + s.rows_moved + "</td></tr>")
      .join("");
  }

  function fillFilters() {
    const catSel = document.getElementById("categoryFilter");
    catSel.innerHTML = "<option value=\"\">All categories</option>" +
      data.category_summary.map((c) => "<option value=\"" + esc(c.category) + "\">" + esc(c.category) + "</option>").join("");
    const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
    document.getElementById("chainFilter").innerHTML = "<option value=\"\">All chains</option>" +
      chains.map((c) => "<option value=\"" + esc(c) + "\">" + esc(c) + "</option>").join("");
    document.getElementById("search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderBoard();
    });
    catSel.addEventListener("change", (e) => {
      state.category = e.target.value;
      renderCats();
      renderBoard();
    });
    document.getElementById("chainFilter").addEventListener("change", (e) => {
      state.chain = e.target.value;
      renderBoard();
    });
    document.getElementById("sortBy").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderBoard();
    });
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        state.sort = key === "name" ? "rank" : key;
        document.getElementById("sortBy").value = state.sort;
        renderBoard();
      });
    });
    document.getElementById("clearCats").addEventListener("click", () => {
      state.category = "";
      catSel.value = "";
      renderCats();
      renderBoard();
    });
  }

  fillFilters();
  renderMeta();
  renderCats();
  renderBoard();

  // Deep links, used by the screenshots: ?detail=<slug>, ?category=<name>, ?view=methodology
  const params = new URLSearchParams(window.location.search);
  if (params.get("category")) {
    state.category = params.get("category");
    document.getElementById("categoryFilter").value = state.category;
    renderCats();
    renderBoard();
  }
  if (params.get("detail")) showDetail(params.get("detail"));
  if (params.get("view") === "methodology") {
    document.getElementById("methodology").scrollIntoView();
  }
})();
