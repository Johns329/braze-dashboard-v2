/* global Plotly, Papa, Tabulator */

(function () {
  "use strict";

  var root = document.getElementById("tas-v2-root");
  if (!root) {
    return;
  }

  var cfg = window.TAS_BRAZE_V2_CONFIG || {};
  var appBaseUrl = String(cfg.appBaseUrl || ".");
  var dataBaseUrl = String(
    cfg.dataBaseUrl ||
      "https://raw.githubusercontent.com/Johns329/braze-dashboard-cloud/main/data/tables"
  );
  var dataVersion = String(cfg.dataVersion || "");
  var hideNav = Boolean(cfg.hideNav);

  var DEP_OK =
    typeof Plotly !== "undefined" &&
    typeof Papa !== "undefined" &&
    typeof Tabulator !== "undefined";

  if (!DEP_OK) {
    root.innerHTML =
      "<div style=\"font-family: Inter, system-ui, sans-serif; padding: 16px;\">" +
      "<b>Dashboard failed to load.</b> Missing required scripts (Plotly/PapaParse/Tabulator)." +
      "</div>";
    return;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toStartOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function parseBool(v) {
    if (typeof v === "boolean") return v;
    var s = String(v || "").toLowerCase().trim();
    return s === "true" || s === "1" || s === "yes";
  }

  function parseDate(v) {
    if (!v) return null;
    var t = Date.parse(v);
    if (Number.isNaN(t)) return null;
    return new Date(t);
  }

  function fmtDateYmd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "/" + m + "/" + day;
  }

  function qs(url) {
    if (!dataVersion) return url;
    var join = url.indexOf("?") >= 0 ? "&" : "?";
    return url + join + "v=" + encodeURIComponent(dataVersion);
  }

  var PERIODS = [
    "Current Week (Mon-Today)",
    "Last Week (Mon-Sun)",
    "Last 30 Days",
    "Last 60 Days",
    "Last 90 Days",
    "Last 180 Days",
    "Year to Date (YTD)",
    "Last 12 Months",
    "All Time",
  ];

  function getDateRange(period) {
    var today = toStartOfDay(new Date());
    var weekday = (today.getDay() + 6) % 7; // Monday=0
    var thisMonday = addDays(today, -weekday);

    if (period === "Current Week (Mon-Today)") {
      return { start: thisMonday, end: today };
    }

    if (period === "Last Week (Mon-Sun)") {
      var start = addDays(thisMonday, -7);
      var end = addDays(thisMonday, -1);
      return { start: start, end: end };
    }

    if (period === "Last 30 Days") {
      return { start: addDays(today, -29), end: today };
    }
    if (period === "Last 60 Days") {
      return { start: addDays(today, -59), end: today };
    }
    if (period === "Last 90 Days") {
      return { start: addDays(today, -89), end: today };
    }
    if (period === "Last 180 Days") {
      return { start: addDays(today, -179), end: today };
    }

    if (period === "Year to Date (YTD)") {
      return { start: new Date(today.getFullYear(), 0, 1), end: today };
    }

    if (period === "Last 12 Months") {
      var start12 = new Date(today.getTime());
      start12.setFullYear(start12.getFullYear() - 1);
      start12 = addDays(start12, 1);
      return { start: start12, end: today };
    }

    return null; // All Time
  }

  function chartLayout(title) {
    return {
      title: { text: title || "", font: { size: 14 }, x: 0 },
      margin: { l: 60, r: 20, t: 50, b: 50 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", color: "#0f172a" },
      xaxis: {
        gridcolor: "#e2e8f0",
        zeroline: false,
        tickfont: { color: "#475569" },
        titlefont: { color: "#475569" },
      },
      yaxis: {
        gridcolor: "#e2e8f0",
        zeroline: false,
        tickfont: { color: "#475569" },
        titlefont: { color: "#475569" },
      },
      showlegend: false,
    };
  }

  function fetchText(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) {
        throw new Error("Fetch failed: " + r.status + " " + url);
      }
      return r.text();
    });
  }

  function parseCsvText(text) {
    var res = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    if (res.errors && res.errors.length) {
      // keep going; still return whatever parsed
    }
    return res.data || [];
  }

  var state = {
    page: "overview",
    period: "All Time",
  };

  var data = {
    catalog: [],
    assets: [],
    refs: [],
    deps: [],
    blockIdToAssetId: new Map(),
    assetById: new Map(),
    catalogFieldSet: new Set(),
    refsJoined: [],
  };

  var tabulators = new Map();

  function setLoading(text) {
    var el = root.querySelector("[data-role='loading-text']");
    if (el) el.textContent = String(text || "Loading...");
  }

  function setPeriodCaption(text) {
    var el = root.querySelector("[data-role='period-caption']");
    if (el) el.textContent = String(text || "");
  }

  function setRefreshCaption(text) {
    var el = root.querySelector("[data-role='data-refresh-caption']");
    if (el) el.textContent = String(text || "");
  }

  function fmtPacificDateTime(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short",
      }).format(d);
    } catch (e) {
      // If Intl/timeZone isn't supported, fall back to raw ISO.
      return String(iso || "");
    }
  }

  function mountShell() {
    root.innerHTML =
      "" +
      (hideNav
        ? ""
        :
          "<nav class='tas-nav'>" +
          "  <div class='tas-nav-inner'>" +
          "    <a class='tas-nav-logo' href='#' onclick='return false;'>" +
          "      <span class='tas-nav-logo-icon'>T</span>" +
          "      <span>Toast Audience Studio</span>" +
          "    </a>" +
          "    <div style='display:flex; gap:10px; align-items:center;'>" +
          "      <span class='tas-badge'>Powered by Toast Data</span>" +
          "    </div>" +
          "  </div>" +
          "</nav>") +
      "<div class='tas-container'>" +
      "  <div class='tas-shell'>" +
      "    <div class='tas-shell-inner'>" +
      "      <aside class='tas-sidebar'>" +
      "        <div class='tas-loading'><span class='tas-spinner'></span><span data-role='loading-text'>Loading data...</span></div>" +
      "        <h4>Navigation</h4>" +
      "        <div class='tas-navbtns'>" +
      "          <button class='tas-navbtn' data-page='overview' type='button'>Overview</button>" +
      "          <button class='tas-navbtn' data-page='fields' type='button'>Field Intelligence</button>" +
      "          <button class='tas-navbtn' data-page='risk' type='button'>Risk Center</button>" +
      "          <button class='tas-navbtn' data-page='analytics' type='button'>Analytics</button>" +
      "        </div>" +
      "        <h4>Activity Period</h4>" +
      "        <select class='tas-select' data-role='period-select'></select>" +
      "        <div class='tas-muted' style='margin-top:8px; font-size:12px;' data-role='period-caption'></div>" +
       "        <div class='tas-muted' style='margin-top:14px; font-size:12px;'>" +
       "          Data source: <span style='font-family: JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;'>" +
       esc(dataBaseUrl) +
       "</span>" +
       "        </div>" +
       "        <div class='tas-muted' style='margin-top:8px; font-size:12px;' data-role='data-refresh-caption'></div>" +
       "      </aside>" +
       "      <main class='tas-main'>" +
      "        <div class='tas-header'>" +
      "          <div>" +
      "            <div class='tas-badge'>Governance</div>" +
      "            <h1 class='tas-title' data-role='page-title'>Governance Overview</h1>" +
      "            <p class='tas-subtitle' data-role='page-subtitle'>Real-time catalog health monitoring and governance intelligence</p>" +
      "          </div>" +
      "        </div>" +
      "        <div class='tas-grid' data-role='kpis'></div>" +
      "        <div class='tas-row' data-role='view'></div>" +
      "        <div style='margin-top:22px; text-align:center; color: var(--slate-400); font-size: 13px;'>" +
      "          Toast Audience Studio &copy; 2026 | Data refresh via ETL to GitHub tables" +
      "        </div>" +
      "      </main>" +
      "    </div>" +
      "  </div>" +
      "</div>";

    // Period options
    var sel = root.querySelector("[data-role='period-select']");
    PERIODS.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });
    sel.value = state.period;
    sel.addEventListener("change", function () {
      state.period = sel.value;
      render();
    });

    // Nav buttons
    var btns = root.querySelectorAll(".tas-navbtn");
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var page = b.getAttribute("data-page");
        state.page = page;
        render();
      });
    });
  }

  function setActiveNav() {
    var btns = root.querySelectorAll(".tas-navbtn");
    btns.forEach(function (b) {
      var page = b.getAttribute("data-page");
      b.setAttribute("data-active", page === state.page ? "true" : "false");
    });
  }

  function destroyTabulators() {
    tabulators.forEach(function (t) {
      try {
        t.destroy();
      } catch (e) {
        // ignore
      }
    });
    tabulators.clear();
  }

  function getFilteredAssetIds() {
    var range = getDateRange(state.period);
    var ids = new Set();

    if (!range) {
      data.assets.forEach(function (a) {
        if (a.last_active) ids.add(a.asset_id);
      });
      setPeriodCaption("All time");
      return ids;
    }

    var start = range.start;
    var end = range.end;
    setPeriodCaption(fmtDateYmd(start) + " - " + fmtDateYmd(end));

    data.assets.forEach(function (a) {
      if (!a.last_active) return;
      var d = toStartOfDay(a.last_active);
      if (d >= start && d <= end) ids.add(a.asset_id);
    });

    return ids;
  }

  function computeKpis(filteredAssetIds) {
    var assetsInRange = data.assets.filter(function (a) {
      return filteredAssetIds.has(a.asset_id);
    });

    var campaigns = 0;
    var canvases = 0;
    assetsInRange.forEach(function (a) {
      if (a.asset_type === "Campaign") campaigns += 1;
      if (a.asset_type === "Canvas") canvases += 1;
    });

    var usedFieldSet = new Set();
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      usedFieldSet.add(r.field_name);
    });
    var usedFields = usedFieldSet.size;
    var totalCatalog = data.catalog.length;
    var saturation = totalCatalog ? (usedFields / totalCatalog) * 100 : 0;

    return {
      campaigns: campaigns,
      canvases: canvases,
      saturation: saturation,
      catalogFields: totalCatalog,
    };
  }

  function computeInsights(filteredAssetIds) {
    var insights = [];

    var ghostSet = new Set();
    var ghostCount = 0;
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (!r.is_risk) return;
      if (r.field_name === "location_guid") return;
      ghostCount += 1;
      ghostSet.add(r.field_name);
    });

    if (ghostSet.size) {
      insights.push({
        kind: "critical",
        title: "Ghost Fields Detected",
        message:
          ghostSet.size +
          " fields are referenced but not in catalog. This can cause runtime errors.",
      });
    }

    var usedFieldSet = new Set();
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      usedFieldSet.add(r.field_name);
    });
    var totalCatalog = data.catalog.length;
    var saturation = totalCatalog ? (usedFieldSet.size / totalCatalog) * 100 : 0;

    if (totalCatalog) {
      if (saturation < 30) {
        insights.push({
          kind: "warning",
          title: "Low Catalog Utilization",
          message:
            "Only " +
            saturation.toFixed(1) +
            "% of catalog fields are in use. Consider cleaning unused fields.",
        });
      } else if (saturation > 85) {
        insights.push({
          kind: "success",
          title: "High Catalog Utilization",
          message:
            saturation.toFixed(1) +
            "% of catalog fields are actively used. Great efficiency!",
        });
      }
    }

    // Critical dependency
    var counts = new Map();
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      counts.set(r.field_name, (counts.get(r.field_name) || 0) + 1);
    });
    var topField = null;
    var topCount = 0;
    counts.forEach(function (c, f) {
      if (c > topCount) {
        topCount = c;
        topField = f;
      }
    });
    if (topField) {
      insights.push({
        kind: "info",
        title: "Critical Dependency",
        message:
          "Field '" +
          topField +
          "' is used in " +
          topCount +
          " locations. Changes require careful review.",
      });
    }

    // Stale assets (90+ days)
    var cutoff = addDays(toStartOfDay(new Date()), -90);
    var stale = 0;
    data.assets.forEach(function (a) {
      if (!filteredAssetIds.has(a.asset_id)) return;
      if (!a.last_active) return;
      var d = toStartOfDay(a.last_active);
      if (d < cutoff) stale += 1;
    });
    if (stale) {
      insights.push({
        kind: "warning",
        title: "Stale Assets",
        message: stale + " assets haven't been active in 90+ days. Review for deprecation.",
      });
    }

    if (!insights.length) {
      insights.push({
        kind: "success",
        title: "All Systems Operational",
        message: "No critical governance issues detected.",
      });
    }

    // Small debug counts used for Risk Center
    insights._ghostFieldCount = ghostSet.size;
    insights._ghostRefCount = ghostCount;
    return insights;
  }

  function renderKpis(kpis) {
    var el = root.querySelector("[data-role='kpis']");
    el.innerHTML = "";

    var cards = [
      { label: "Campaigns", value: String(kpis.campaigns) },
      { label: "Canvases", value: String(kpis.canvases) },
      { label: "Saturation", value: Math.round(kpis.saturation) + "%" },
      { label: "Catalog Fields", value: String(kpis.catalogFields) },
    ];

    cards.forEach(function (c) {
      var div = document.createElement("div");
      div.className = "tas-card";
      div.innerHTML =
        "<p class='tas-kpi-label'>" +
        esc(c.label) +
        "</p><p class='tas-kpi-value'>" +
        esc(c.value) +
        "</p>";
      el.appendChild(div);
    });
  }

  function renderOverview(filteredAssetIds) {
    var view = root.querySelector("[data-role='view']");
    var insights = computeInsights(filteredAssetIds);

    view.innerHTML =
      "<div class='tas-row-2'>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Governance Insights</div>" +
      "    <div data-role='insights'></div>" +
      "  </div>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Quick Notes</div>" +
      "    <p class='tas-muted' style='margin:0;'>This view updates based on Activity Period. For fresh data, run ETL and push updated tables to GitHub.</p>" +
      "    <div style='height:10px;'></div>" +
      "    <p class='tas-muted' style='margin:0; font-family: JetBrains Mono, ui-monospace, monospace; font-size:12px;'>" +
      esc(dataBaseUrl) +
      "</p>" +
      "  </div>" +
      "</div>";

    var host = root.querySelector("[data-role='insights']");
    insights.forEach(function (ins) {
      var div = document.createElement("div");
      div.className = "tas-alert";
      div.setAttribute("data-kind", ins.kind);
      div.innerHTML =
        "<h5>" + esc(ins.title) + "</h5><p>" + esc(ins.message) + "</p>";
      host.appendChild(div);
      host.appendChild(document.createElement("div")).style.height = "10px";
    });
  }

  function computeTopFields(filteredAssetIds, topN) {
    var counts = new Map();
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      counts.set(r.field_name, (counts.get(r.field_name) || 0) + 1);
    });
    var rows = [];
    counts.forEach(function (c, f) {
      rows.push({ field_name: f, references: c });
    });
    rows.sort(function (a, b) {
      return b.references - a.references;
    });
    return rows.slice(0, topN || 15);
  }

  function renderTopFieldsChart(containerId, rows) {
    var y = rows.map(function (r) {
      return r.field_name;
    });
    var x = rows.map(function (r) {
      return r.references;
    });

    var trace = {
      type: "bar",
      orientation: "h",
      x: x,
      y: y,
      marker: {
        color: x,
        colorscale: "Oranges",
        line: { color: "rgba(255,106,0,0.35)", width: 1 },
      },
      text: x,
      textposition: "outside",
      hovertemplate: "%{y}<br>%{x} references<extra></extra>",
    };

    var layout = chartLayout("Top 15 Most Referenced Fields");
    layout.height = 520;
    layout.margin = { l: 190, r: 30, t: 50, b: 50 };
    layout.xaxis.title = "Number of References";
    layout.yaxis.title = "";

    Plotly.newPlot(containerId, [trace], layout, { displayModeBar: false, responsive: true });
  }

  function renderHeatmap(containerId, filteredAssetIds) {
    // Count (field, asset_type)
    var map = new Map();
    var totalByField = new Map();

    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      var at = r.asset_type || "Unknown";
      var key = r.field_name + "||" + at;
      map.set(key, (map.get(key) || 0) + 1);
      totalByField.set(r.field_name, (totalByField.get(r.field_name) || 0) + 1);
    });

    var fields = [];
    totalByField.forEach(function (c, f) {
      fields.push({ field: f, total: c });
    });
    fields.sort(function (a, b) {
      return b.total - a.total;
    });
    fields = fields.slice(0, 20).map(function (r) {
      return r.field;
    });

    var types = ["Campaign", "Canvas"];
    var z = fields.map(function (f) {
      return types.map(function (t) {
        return map.get(f + "||" + t) || 0;
      });
    });

    var trace = {
      type: "heatmap",
      x: types,
      y: fields,
      z: z,
      colorscale: "Oranges",
      hovertemplate: "%{y}<br>%{x}: %{z}<extra></extra>",
    };

    var layout = chartLayout("Field Usage Heatmap (Top 20 Fields)");
    layout.height = 640;
    layout.margin = { l: 220, r: 20, t: 50, b: 50 };
    layout.xaxis.title = "Asset Type";
    layout.yaxis.title = "Field Name";
    layout.showlegend = false;

    Plotly.newPlot(containerId, [trace], layout, { displayModeBar: false, responsive: true });
  }

  function renderFieldImpactTable(containerEl, filteredAssetIds) {
    // field -> {Campaign:Set(asset_id), Canvas:Set(asset_id)}
    var agg = new Map();
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      var at = r.asset_type;
      if (at !== "Campaign" && at !== "Canvas") return;

      if (!agg.has(r.field_name)) {
        agg.set(r.field_name, { Campaign: new Set(), Canvas: new Set() });
      }
      agg.get(r.field_name)[at].add(r.asset_id);
    });

    var rows = [];
    agg.forEach(function (v, field) {
      var c = v.Campaign.size;
      var n = v.Canvas.size;
      rows.push({
        field: field,
        campaigns: c,
        canvases: n,
        total: c + n,
      });
    });
    rows.sort(function (a, b) {
      return b.total - a.total;
    });
    rows = rows.slice(0, 50);

    var t = new Tabulator(containerEl, {
      data: rows,
      layout: "fitColumns",
      height: 520,
      pagination: true,
      paginationSize: 15,
      initialSort: [{ column: "total", dir: "desc" }],
      columns: [
        { title: "Field", field: "field", widthGrow: 3 },
        { title: "Camps", field: "campaigns", hozAlign: "right" },
        { title: "Canvas", field: "canvases", hozAlign: "right" },
        { title: "Total", field: "total", hozAlign: "right" },
      ],
    });

    tabulators.set("field-impact", t);
  }

  function renderFieldIntelligence(filteredAssetIds) {
    var view = root.querySelector("[data-role='view']");
    view.innerHTML =
      "<div class='tas-row'>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Top Fields</div>" +
      "    <div id='tas-v2-top-fields' style='width:100%;'></div>" +
      "  </div>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Field Impact Analysis</div>" +
      "    <div id='tas-v2-impact-table'></div>" +
      "  </div>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Distribution</div>" +
      "    <div id='tas-v2-heatmap' style='width:100%;'></div>" +
      "  </div>" +
      "</div>";

    var top = computeTopFields(filteredAssetIds, 15);
    if (!top.length) {
      var el = document.getElementById("tas-v2-top-fields");
      el.innerHTML = "<p class='tas-muted' style='margin:0;'>No field usage data for this period.</p>";
    } else {
      renderTopFieldsChart("tas-v2-top-fields", top);
    }

    var tableHost = document.getElementById("tas-v2-impact-table");
    renderFieldImpactTable(tableHost, filteredAssetIds);

    renderHeatmap("tas-v2-heatmap", filteredAssetIds);
  }

  function renderGhostFieldsTable(containerEl, filteredAssetIds) {
    // field -> occurrences, assets
    var occ = new Map();
    var assets = new Map();

    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (!r.is_risk) return;
      if (r.field_name === "location_guid") return;

      occ.set(r.field_name, (occ.get(r.field_name) || 0) + 1);
      if (!assets.has(r.field_name)) assets.set(r.field_name, new Set());
      assets.get(r.field_name).add(r.asset_id);
    });

    var rows = [];
    occ.forEach(function (c, f) {
      rows.push({
        field: f,
        occurrences: c,
        affected_assets: assets.get(f) ? assets.get(f).size : 0,
      });
    });
    rows.sort(function (a, b) {
      return b.occurrences - a.occurrences;
    });

    var t = new Tabulator(containerEl, {
      data: rows,
      layout: "fitColumns",
      height: 620,
      pagination: true,
      paginationSize: 20,
      columns: [
        { title: "Ghost Field", field: "field", widthGrow: 3 },
        { title: "Occurrences", field: "occurrences", hozAlign: "right" },
        { title: "Affected Assets", field: "affected_assets", hozAlign: "right" },
      ],
    });
    tabulators.set("ghost-fields", t);
  }

  function renderRiskCenter(filteredAssetIds) {
    var view = root.querySelector("[data-role='view']");
    view.innerHTML =
      "<div class='tas-row'>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Ghost Fields</div>" +
      "    <p class='tas-muted' style='margin:0 0 10px 0;'>Fields referenced in templates but missing from catalog.</p>" +
      "    <div id='tas-v2-ghost-table'></div>" +
      "  </div>" +
      "</div>";

    var host = document.getElementById("tas-v2-ghost-table");
    renderGhostFieldsTable(host, filteredAssetIds);
  }

  function renderTimeline(containerId, filteredAssetIds) {
    var byMonthType = new Map();
    var months = new Set();

    data.assets.forEach(function (a) {
      if (!filteredAssetIds.has(a.asset_id)) return;
      if (!a.last_active) return;
      var d = a.last_active;
      var m = new Date(d.getFullYear(), d.getMonth(), 1);
      var key = m.toISOString().slice(0, 10) + "||" + (a.asset_type || "Unknown");
      byMonthType.set(key, (byMonthType.get(key) || 0) + 1);
      months.add(m.toISOString().slice(0, 10));
    });

    var monthList = Array.from(months);
    monthList.sort();
    var xs = monthList.map(function (s) {
      return new Date(s);
    });

    function series(assetType, color) {
      var ys = monthList.map(function (ms) {
        return byMonthType.get(ms + "||" + assetType) || 0;
      });
      return {
        type: "scatter",
        mode: "lines+markers",
        name: assetType,
        x: xs,
        y: ys,
        line: { color: color, width: 2 },
        marker: { color: color, size: 6 },
      };
    }

    var traces = [
      series("Campaign", "#ff6a00"),
      series("Canvas", "#1e293b"),
    ];

    var layout = chartLayout("Asset Activity Over Time");
    layout.height = 420;
    layout.showlegend = true;
    layout.legend = { orientation: "h", x: 0, y: 1.15 };
    layout.xaxis.title = "Month";
    layout.yaxis.title = "Active Assets";

    Plotly.newPlot(containerId, traces, layout, { displayModeBar: false, responsive: true });
  }

  function renderPareto(containerId, filteredAssetIds) {
    var counts = new Map();
    data.refsJoined.forEach(function (r) {
      if (!r.asset_id) return;
      if (!filteredAssetIds.has(r.asset_id)) return;
      if (r.is_risk) return;
      counts.set(r.field_name, (counts.get(r.field_name) || 0) + 1);
    });

    var rows = [];
    counts.forEach(function (c, f) {
      rows.push({ field: f, count: c });
    });
    rows.sort(function (a, b) {
      return b.count - a.count;
    });

    var total = rows.reduce(function (acc, r) {
      return acc + r.count;
    }, 0);
    var cum = 0;
    var x = [];
    var y = [];
    rows.forEach(function (r, idx) {
      cum += r.count;
      x.push(idx + 1);
      y.push(total ? (cum / total) * 100 : 0);
    });

    var trace = {
      type: "scatter",
      mode: "lines+markers",
      x: x,
      y: y,
      line: { color: "#ff6a00", width: 2 },
      marker: { color: "#ff6a00", size: 6 },
      hovertemplate: "Rank %{x}<br>%{y:.1f}% cumulative<extra></extra>",
    };

    var layout = chartLayout("Cumulative Field Usage (Pareto)");
    layout.height = 420;
    layout.xaxis.title = "Field Rank";
    layout.yaxis.title = "Cumulative %";
    layout.shapes = [
      {
        type: "line",
        x0: 1,
        x1: Math.max(1, x.length),
        y0: 80,
        y1: 80,
        line: { color: "#f59e0b", width: 2, dash: "dash" },
      },
    ];

    Plotly.newPlot(containerId, [trace], layout, { displayModeBar: false, responsive: true });
  }

  function renderAnalytics(filteredAssetIds) {
    var view = root.querySelector("[data-role='view']");
    view.innerHTML =
      "<div class='tas-row'>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Timeline</div>" +
      "    <div id='tas-v2-timeline'></div>" +
      "  </div>" +
      "  <div class='tas-card'>" +
      "    <div class='tas-section-title'>Usage Patterns</div>" +
      "    <div id='tas-v2-pareto'></div>" +
      "  </div>" +
      "</div>";

    renderTimeline("tas-v2-timeline", filteredAssetIds);
    renderPareto("tas-v2-pareto", filteredAssetIds);
  }

  function renderPageHeader() {
    var title = root.querySelector("[data-role='page-title']");
    var sub = root.querySelector("[data-role='page-subtitle']");
    if (!title || !sub) return;

    if (state.page === "overview") {
      title.textContent = "Governance Overview";
      sub.textContent =
        "Real-time catalog health monitoring and governance intelligence";
      return;
    }

    if (state.page === "fields") {
      title.textContent = "Field Intelligence";
      sub.textContent = "Usage hotspots, impact, and distribution by asset type";
      return;
    }

    if (state.page === "risk") {
      title.textContent = "Risk Center";
      sub.textContent = "Ghost fields and governance risks surfaced for review";
      return;
    }

    title.textContent = "Analytics";
    sub.textContent = "Trends and usage patterns over time";
  }

  function render() {
    if (!data.refsJoined.length) return;

    setActiveNav();
    renderPageHeader();
    destroyTabulators();

    var filteredAssetIds = getFilteredAssetIds();
    var kpis = computeKpis(filteredAssetIds);
    renderKpis(kpis);

    if (state.page === "overview") {
      renderOverview(filteredAssetIds);
      return;
    }

    if (state.page === "fields") {
      renderFieldIntelligence(filteredAssetIds);
      return;
    }

    if (state.page === "risk") {
      renderRiskCenter(filteredAssetIds);
      return;
    }

    renderAnalytics(filteredAssetIds);
  }

  function loadSmallCsv(name) {
    var url = qs(dataBaseUrl.replace(/\/$/, "") + "/" + name);
    return fetchText(url).then(function (text) {
      return parseCsvText(text);
    });
  }

  function loadRefreshMeta() {
    var base = dataBaseUrl.replace(/\/$/, "");
    var url = base + "/refresh_meta.json";
    // Bypass intermediate caches; tables still use dataVersion cache-busting.
    var bust = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + String(Date.now());

    return fetchText(bust)
      .then(function (text) {
        var meta = {};
        try {
          meta = JSON.parse(text || "{}");
        } catch (e) {
          meta = {};
        }

        var iso =
          (meta && (meta.refreshed_at_utc || meta.refreshedAtUtc || meta.refreshed_at || meta.refreshedAt)) ||
          "";

        if (!iso) {
          setRefreshCaption("");
          return;
        }

        var pac = fmtPacificDateTime(iso);
        if (pac) {
          setRefreshCaption("Last refresh (Pacific): " + pac);
        } else {
          setRefreshCaption("Last refresh (UTC): " + String(iso));
        }

        // Use the refresh timestamp as a stable cache buster for the CSV tables.
        dataVersion = String(iso);
      })
      .catch(function () {
        // Optional file; don't block dashboard if missing.
        setRefreshCaption("");
      });
  }

  function buildBlockIndex() {
    return new Promise(function (resolve, reject) {
      var url = qs(dataBaseUrl.replace(/\/$/, "") + "/content_blocks.csv");
      var map = new Map();

      var rows = 0;
      setLoading("Indexing content blocks...");

      Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        step: function (results) {
          var r = results.data || {};
          if (r.block_id && r.asset_id) {
            map.set(String(r.block_id), String(r.asset_id));
          }
          rows += 1;
          if (rows % 2000 === 0) {
            setLoading("Indexing content blocks... (" + rows + ")");
          }
        },
        complete: function () {
          setLoading("Indexing content blocks... done (" + rows + ")");
          resolve(map);
        },
        error: function (err) {
          reject(err);
        },
      });
    });
  }

  function normalizeData() {
    data.assetById = new Map();
    data.assets.forEach(function (a) {
      data.assetById.set(a.asset_id, a);
    });

    data.catalogFieldSet = new Set();
    data.catalog.forEach(function (c) {
      data.catalogFieldSet.add(c.field_name);
    });

    // Join refs -> asset_id via block index and attach asset fields
    data.refsJoined = data.refs.map(function (r) {
      var blockId = String(r.block_id || "");
      var assetId = data.blockIdToAssetId.get(blockId) || null;
      var asset = assetId ? data.assetById.get(assetId) : null;

      return {
        ref_id: String(r.ref_id || ""),
        block_id: blockId,
        field_name: String(r.field_name || ""),
        match_type: String(r.match_type || ""),
        context_snippet: String(r.context_snippet || ""),
        is_risk: parseBool(r.is_risk),
        asset_id: assetId,
        asset_type: asset ? String(asset.asset_type || "") : "",
        asset_name: asset ? String(asset.asset_name || "") : "",
      };
    });
  }

  function bootstrap() {
    mountShell();
    setActiveNav();

    setLoading("Loading tables...");

    loadRefreshMeta()
      .then(function () {
        return Promise.all([
          loadSmallCsv("catalog_schema.csv"),
          loadSmallCsv("asset_inventory.csv"),
          loadSmallCsv("field_references.csv"),
          loadSmallCsv("dependencies.csv"),
        ]);
      })
      .then(function (res) {
        data.catalog = res[0].map(function (r) {
          return {
            field_name: String(r.field_name || ""),
            field_type: String(r.field_type || ""),
            is_custom: parseBool(r.is_custom),
            last_seen: r.last_seen ? String(r.last_seen) : "",
          };
        });

        data.assets = res[1].map(function (r) {
          return {
            asset_id: String(r.asset_id || ""),
            asset_name: String(r.asset_name || ""),
            asset_type: String(r.asset_type || ""),
            subtype: String(r.subtype || ""),
            status: String(r.status || ""),
            last_edited: parseDate(r.last_edited),
            last_active: parseDate(r.last_active),
            tags: r.tags ? String(r.tags) : "",
          };
        });

        data.refs = res[2].map(function (r) {
          return {
            ref_id: r.ref_id,
            block_id: r.block_id,
            field_name: r.field_name,
            match_type: r.match_type,
            context_snippet: r.context_snippet,
            is_risk: r.is_risk,
          };
        });

        data.deps = res[3].map(function (r) {
          return {
            source_asset_id: String(r.source_asset_id || ""),
            target_asset_id: String(r.target_asset_id || ""),
            dependency_type: String(r.dependency_type || ""),
          };
        });

        setLoading("Tables loaded. Building indexes...");
        return buildBlockIndex();
      })
      .then(function (blockMap) {
        data.blockIdToAssetId = blockMap;
        normalizeData();
        setLoading("Ready");
        render();
      })
      .catch(function (err) {
        root.innerHTML =
          "<div style=\"padding:16px; font-family: Inter, system-ui, sans-serif;\">" +
          "<b>Unable to load dashboard data.</b><br/>" +
          "<span style=\"color:#475569\">" +
          esc(err && err.message ? err.message : String(err)) +
          "</span>" +
          "</div>";
      });
  }

  bootstrap();
})();
