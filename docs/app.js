(function () {
  "use strict";

  const state = {
    sheet: null,
    sheets: {},
    columns: {},
    meta: null,
    updates: [],
    refreshTimer: null,
    search: "",
    region: "",
    cuisine: "",
    price: "",
    recommender: "",
    sort: "default",
    filterOpen: false,
    page: 1,
  };

  const el = {};

  const PAGE_SIZE = 30;

  const SHEET_META = {
    探店清单: { label: "群主推荐", desc: "辉夜姬Invanta（群主）的探店合集，附 B站视频链接。" },
    群友推荐: { label: "群友推荐", desc: "群友分享的宝藏餐厅，按推荐人分类，持续更新。" },
  };

  const PRICE_OPTIONS = [
    ["", "全部价位"],
    ["0-50", "50元以下"],
    ["51-100", "50–100元"],
    ["101-150", "100–150元"],
    ["151-200", "150–200元"],
    ["200+", "200元以上"],
    ["unknown", "未知"],
  ];

  const SHANGHAI_DISTRICTS = [
    "黄浦区",
    "徐汇区",
    "长宁区",
    "静安区",
    "普陀区",
    "虹口区",
    "杨浦区",
    "闵行区",
    "宝山区",
    "嘉定区",
    "浦东新区",
    "金山区",
    "松江区",
    "青浦区",
    "奉贤区",
    "崇明区",
  ];

  const DISTRICT_CORES = [
    ["黄浦", "黄浦区"],
    ["黄埔", "黄浦区"],
    ["徐汇", "徐汇区"],
    ["长宁", "长宁区"],
    ["静安", "静安区"],
    ["普陀", "普陀区"],
    ["虹口", "虹口区"],
    ["杨浦", "杨浦区"],
    ["闵行", "闵行区"],
    ["宝山", "宝山区"],
    ["嘉定", "嘉定区"],
    ["浦东", "浦东新区"],
    ["金山", "金山区"],
    ["松江", "松江区"],
    ["青浦", "青浦区"],
    ["奉贤", "奉贤区"],
    ["崇明", "崇明区"],
  ];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    Promise.all([
      fetchJSON("data.json"),
      fetchJSON("meta.json"),
      fetchJSON("updates.json"),
    ])
      .then(([data, meta, updates]) => {
        state.sheets = data.sheets || {};
        state.columns = data.columns || {};
        state.meta = meta;
        state.updates = (updates.items || []).slice();
        state.sheet = Object.keys(state.sheets)[0] || null;
        renderHeader();
        renderTabs();
        renderFilterOptions();
        syncFilterPanelVisibility();
        render();
        startAutoRefresh();
      })
      .catch((err) => {
        renderFatal(err);
      });
  }

  function cacheElements() {
    el.tabs = document.getElementById("tabs");
    el.sheetNote = document.getElementById("sheet-note");
    el.headerMeta = document.getElementById("header-meta");
    el.searchInput = document.getElementById("search-input");
    el.searchClear = document.getElementById("search-clear");
    el.filterToggle = document.getElementById("filter-toggle");
    el.filterPanel = document.getElementById("filter-panel");
    el.filterCount = document.getElementById("filter-count");
    el.region = document.getElementById("filter-region");
    el.cuisine = document.getElementById("filter-cuisine");
    el.price = document.getElementById("filter-price");
    el.recommenderField = document.getElementById("recommender-field");
    el.recommender = document.getElementById("filter-recommender");
    el.sort = document.getElementById("sort-select");
    el.reset = document.getElementById("reset-filters");
    el.resultCount = document.getElementById("result-count");
    el.activeFilters = document.getElementById("active-filters");
    el.grid = document.getElementById("card-grid");
    el.pagination = document.getElementById("pagination");
    el.empty = document.getElementById("empty-state");
    el.emptyReset = document.getElementById("empty-reset");
    el.updatesBtn = document.getElementById("updates-btn");
    el.updatesDot = document.getElementById("updates-dot");
    el.drawer = document.getElementById("updates-drawer");
    el.drawerBackdrop = document.getElementById("drawer-backdrop");
    el.drawerClose = document.getElementById("drawer-close");
    el.drawerSubtitle = document.getElementById("drawer-subtitle");
    el.updatesList = document.getElementById("updates-list");
  }

  function bindEvents() {
    el.searchInput.addEventListener("input", (e) => {
      state.search = e.target.value.trim();
      state.page = 1;
      el.searchClear.classList.toggle("hidden", !state.search);
      render();
    });
    el.searchClear.addEventListener("click", () => {
      el.searchInput.value = "";
      state.search = "";
      state.page = 1;
      el.searchClear.classList.add("hidden");
      render();
    });

    [el.region, el.cuisine, el.price, el.recommender].forEach((select) => {
      select.addEventListener("change", () => {
        syncFiltersFromUI();
        state.page = 1;
        render();
      });
    });

    el.sort.addEventListener("change", () => {
      state.sort = el.sort.value;
      state.page = 1;
      render();
    });

    el.reset.addEventListener("click", resetFilters);
    el.emptyReset.addEventListener("click", resetFilters);

    el.filterToggle.addEventListener("click", () => {
      state.filterOpen = !state.filterOpen;
      el.filterPanel.hidden = !state.filterOpen;
      el.filterToggle.setAttribute("aria-expanded", String(state.filterOpen));
    });

    el.updatesBtn.addEventListener("click", openDrawer);
    el.drawerClose.addEventListener("click", closeDrawer);
    el.drawerBackdrop.addEventListener("click", closeDrawer);
    window.addEventListener("resize", syncFilterPanelVisibility);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
    });
  }

  function startAutoRefresh() {
    if (state.refreshTimer) return;
    state.refreshTimer = window.setInterval(async () => {
      try {
        const meta = await fetchJSON("meta.json");
        if (!state.meta || meta.lastSyncText !== state.meta.lastSyncText) {
          const [data, updates] = await Promise.all([
            fetchJSON("data.json"),
            fetchJSON("updates.json"),
          ]);
          state.sheets = data.sheets || {};
          state.columns = data.columns || {};
          state.meta = meta;
          state.updates = (updates.items || []).slice();
          if (!state.sheets[state.sheet]) {
            state.sheet = Object.keys(state.sheets)[0] || null;
          }
          state.region = "";
          state.cuisine = "";
          state.price = "";
          state.recommender = "";
          state.page = 1;
          el.searchInput.value = "";
          state.search = "";
          renderHeader();
          renderTabs();
          renderFilterOptions();
          render();
        }
      } catch (err) {
        // Keep showing the last good data if the sync endpoint is briefly down.
      }
    }, 60000);
  }

  function syncFilterPanelVisibility() {
    const desktop = window.matchMedia("(min-width: 681px)").matches;
    if (desktop) {
      el.filterPanel.hidden = false;
      el.filterToggle.setAttribute("aria-expanded", "true");
    } else {
      el.filterPanel.hidden = !state.filterOpen;
      el.filterToggle.setAttribute("aria-expanded", String(state.filterOpen));
    }
  }

  function fetchJSON(path) {
    return fetch(path, { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      return res.json();
    });
  }

  function renderHeader() {
    if (!state.meta) return;
    const parts = [`最后同步 ${state.meta.lastSyncText}`];
    if (state.meta.sourceMtimeText) {
      parts.push(`源文档更新 ${state.meta.sourceMtimeText}`);
    }
    el.headerMeta.textContent = parts.join(" · ");
    el.drawerSubtitle.textContent = `最后同步 ${state.meta.lastSyncText} · 源文档 ${state.meta.sourceMtimeText}`;
    el.updatesDot.classList.toggle("hidden", state.updates.length === 0);
  }

  function renderTabs() {
    el.tabs.innerHTML = "";
    Object.keys(state.sheets).forEach((name) => {
      const meta = SHEET_META[name] || { label: name };
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab-btn" + (name === state.sheet ? " active" : "");
      const count = state.sheets[name].length;
      btn.innerHTML = `${escapeHTML(meta.label)} <span class="tab-count">${count}</span>`;
      btn.addEventListener("click", () => {
        if (state.sheet === name) return;
        state.sheet = name;
        state.region = "";
        state.cuisine = "";
        state.price = "";
        state.recommender = "";
        state.page = 1;
        renderTabs();
        renderFilterOptions();
        render();
      });
      el.tabs.appendChild(btn);
    });
  }

  function renderFilterOptions() {
    const rows = currentRows();
    fillSelect(el.region, SHANGHAI_DISTRICTS, "全部区域");
    fillSelect(el.cuisine, unique(rows.map((r) => r["菜系/类型"]).filter(Boolean)).sort(), "全部菜系");
    fillSelect(el.price, PRICE_OPTIONS, "全部价位");

    const recommenders = unique(rows.map((r) => r["推荐人"]).filter(Boolean)).sort();
    if (recommenders.length) {
      el.recommenderField.classList.remove("hidden");
      fillSelect(el.recommender, recommenders, "全部推荐人");
    } else {
      el.recommenderField.classList.add("hidden");
      el.recommender.innerHTML = '<option value="">全部推荐人</option>';
    }

    el.region.value = state.region;
    el.cuisine.value = state.cuisine;
    el.price.value = state.price;
    el.recommender.value = state.recommender;
  }

  function fillSelect(select, options, placeholder) {
    const current = select.value;
    const frag = document.createDocumentFragment();
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = placeholder;
    frag.appendChild(placeholderOpt);
    options.forEach((opt) => {
      if (Array.isArray(opt)) {
        const option = document.createElement("option");
        option.value = opt[0];
        option.textContent = opt[1];
        frag.appendChild(option);
      } else {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        frag.appendChild(option);
      }
    });
    select.replaceChildren(frag);
    if (current && options.some((o) => (Array.isArray(o) ? o[0] : o) === current)) {
      select.value = current;
    }
  }

  function syncFiltersFromUI() {
    state.region = el.region.value;
    state.cuisine = el.cuisine.value;
    state.price = el.price.value;
    state.recommender = el.recommender.value;
  }

  function currentRows() {
    return state.sheet ? state.sheets[state.sheet] : [];
  }

  function render() {
    const rows = filterRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    renderSheetNote();
    renderResultBar(rows.length, pageRows.length, totalPages);
    renderGrid(pageRows);
    renderPagination(totalPages);
    renderActiveFilters();
    updateFilterBadge();
  }

  function renderSheetNote() {
    const meta = SHEET_META[state.sheet] || { desc: "" };
    el.sheetNote.textContent = meta.desc;
  }

  function filterRows() {
    let rows = currentRows();
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter((r) =>
        ["餐厅名称", "推荐菜品", "备注", "区域", "详细地址", "菜系/类型", "推荐人"].some((k) =>
          (r[k] || "").toLowerCase().includes(q)
        )
      );
    }
    if (state.region) {
      rows = rows.filter((r) => {
        const region = normalizeRegion(r);
        return region.name === state.region || region.everywhere;
      });
    }
    if (state.cuisine) rows = rows.filter((r) => r["菜系/类型"] === state.cuisine);
    if (state.price) rows = rows.filter((r) => priceBucket(r["人均消费"]) === state.price);
    if (state.recommender) rows = rows.filter((r) => r["推荐人"] === state.recommender);

    const sorted = rows.slice();
    if (state.sort === "price-asc") {
      sorted.sort((a, b) => {
        const pa = parsePrice(a["人均消费"]);
        const pb = parsePrice(b["人均消费"]);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa - pb;
      });
    } else if (state.sort === "price-desc") {
      sorted.sort((a, b) => {
        const pa = parsePrice(a["人均消费"]);
        const pb = parsePrice(b["人均消费"]);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pb - pa;
      });
    } else if (state.sort === "name") {
      sorted.sort((a, b) => (a["餐厅名称"] || "").localeCompare(b["餐厅名称"] || "", "zh"));
    } else {
      sorted.sort((a, b) => (b._monthlyNew ? 1 : 0) - (a._monthlyNew ? 1 : 0));
    }
    return sorted;
  }

  function renderGrid(rows) {
    el.grid.innerHTML = "";
    el.empty.classList.toggle("hidden", rows.length > 0);
    rows.forEach((r) => el.grid.appendChild(buildCard(r)));
  }

  function buildCard(r) {
    const card = document.createElement("article");
    card.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";
    const name = document.createElement("h3");
    name.className = "card-name";
    name.textContent = r["餐厅名称"] || "未命名";
    top.appendChild(name);

    const priceText = r["人均消费"] ? `¥${r["人均消费"]}` : "人均未知";
    const price = document.createElement("span");
    price.className = "price-chip";
    price.textContent = priceText;
    top.appendChild(price);
    card.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "meta-row";
    if (r._monthlyNew) meta.appendChild(badge("每月新增", "monthly"));
    if (r["菜系/类型"]) meta.appendChild(badge(r["菜系/类型"], "cuisine"));
    if (r["区域"]) {
      const region = normalizeRegion(r);
      meta.appendChild(badge(region.name, ""));
    }
    if (r["推荐人"]) meta.appendChild(badge(r["推荐人"], "recommender"));
    if (meta.children.length) card.appendChild(meta);

    if (r["推荐菜品"]) {
      const dish = document.createElement("p");
      dish.className = "card-body";
      dish.innerHTML = `<strong>推荐</strong>　${escapeHTML(r["推荐菜品"])}`;
      card.appendChild(dish);
    }

    if (r["备注"]) {
      const note = document.createElement("p");
      note.className = "card-body note";
      note.textContent = r["备注"];
      card.appendChild(note);
    }

    const address = document.createElement("a");
    address.className = "address-link";
    address.href = mapUrl(r);
    address.target = "_blank";
    address.rel = "noopener";
    address.innerHTML =
      pinIcon() + `<span>${escapeHTML(r["详细地址"] || "在地图中打开 " + (r["餐厅名称"] || ""))}</span>` + externalIcon();
    card.appendChild(address);

    if (r["视频链接"]) {
      const video = document.createElement("a");
      video.className = "video-link";
      video.href = r["视频链接"];
      video.target = "_blank";
      video.rel = "noopener";
      video.innerHTML = playIcon() + "<span>观看探店视频</span>";
      card.appendChild(video);
    }

    return card;
  }

  function badge(text, cls) {
    const span = document.createElement("span");
    span.className = "meta-badge" + (cls ? " " + cls : "");
    span.textContent = text;
    span.title = text;
    return span;
  }

  function renderResultBar(totalRows, shownRows, totalPages) {
    const total = currentRows().length;
    el.resultCount.textContent = `共 ${total} 家 · 第 ${state.page}/${totalPages} 页 · 本页 ${shownRows} 家`;
  }

  function renderPagination(totalPages) {
    el.pagination.innerHTML = "";
    el.pagination.classList.toggle("hidden", totalPages <= 1);
    if (totalPages <= 1) return;

    const prev = pageButton("上一页", state.page - 1, state.page === 1);
    el.pagination.appendChild(prev);

    pageList(totalPages, state.page).forEach((item) => {
      if (item === "...") {
        const span = document.createElement("span");
        span.className = "page-ellipsis";
        span.textContent = "…";
        el.pagination.appendChild(span);
      } else {
        const btn = pageButton(String(item), item, false);
        if (item === state.page) btn.classList.add("current");
        el.pagination.appendChild(btn);
      }
    });

    const next = pageButton("下一页", state.page + 1, state.page === totalPages);
    el.pagination.appendChild(next);
  }

  function pageButton(label, target, disabled) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn";
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener("click", () => goToPage(target));
    return btn;
  }

  function goToPage(page) {
    if (page < 1 || !page) return;
    state.page = page;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pageList(total, current) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const wanted = [1, total, current - 2, current - 1, current, current + 1, current + 2]
      .filter((n) => n >= 1 && n <= total)
      .sort((a, b) => a - b);
    const unique = Array.from(new Set(wanted));
    const out = [];
    let prev = 0;
    for (const n of unique) {
      if (prev && n - prev > 1) out.push("...");
      out.push(n);
      prev = n;
    }
    return out;
  }

  function renderActiveFilters() {
    const labels = [];
    if (state.region) labels.push(state.region);
    if (state.cuisine) labels.push(state.cuisine);
    if (state.price) labels.push(priceLabel(state.price));
    if (state.recommender) labels.push(state.recommender);
    if (state.search) labels.push(`“${state.search}”`);
    el.activeFilters.textContent = labels.length ? "筛选：" + labels.join("、") : "";
  }

  function updateFilterBadge() {
    const n = [state.region, state.cuisine, state.price, state.recommender].filter(Boolean).length;
    el.filterCount.classList.toggle("hidden", n === 0);
    el.filterCount.textContent = String(n);
  }

  function resetFilters() {
    state.search = "";
    state.region = "";
    state.cuisine = "";
    state.price = "";
    state.recommender = "";
    state.sort = "default";
      state.page = 1;
    el.searchInput.value = "";
    el.searchClear.classList.add("hidden");
    el.region.value = "";
    el.cuisine.value = "";
    el.price.value = "";
    el.recommender.value = "";
    el.sort.value = "default";
    render();
  }

  function openDrawer() {
    renderUpdates();
    el.drawer.classList.add("open");
    el.drawerBackdrop.classList.remove("hidden");
    requestAnimationFrame(() => el.drawerBackdrop.classList.add("show"));
    el.drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    el.drawer.classList.remove("open");
    el.drawerBackdrop.classList.remove("show");
    el.drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    window.setTimeout(() => el.drawerBackdrop.classList.add("hidden"), 220);
  }

  function renderUpdates() {
    el.updatesList.innerHTML = "";
    if (!state.updates.length) {
      const p = document.createElement("p");
      p.className = "update-summary";
      p.textContent = "暂无更新记录";
      el.updatesList.appendChild(p);
      return;
    }
    state.updates.forEach((item) => {
      const wrap = document.createElement("div");
      wrap.className = "update-item";

      const time = document.createElement("div");
      time.className = "update-time";
      time.innerHTML = clockIcon() + `<span>${escapeHTML(item.time || "")}</span>`;
      wrap.appendChild(time);

      const summary = document.createElement("p");
      summary.className = "update-summary";
      const mapped = Object.keys(SHEET_META).reduce((acc, key) => {
        const label = SHEET_META[key].label;
        return acc.split(key).join(label);
      }, item.summary || "");
      summary.textContent = mapped;
      wrap.appendChild(summary);

      if (item.details && item.details.length) {
        const list = document.createElement("ul");
        list.className = "update-details";
        item.details.forEach((detail) => {
          const li = document.createElement("li");
          li.innerHTML = opChip(detail) + `<span>${escapeHTML(detail)}</span>`;
          list.appendChild(li);
        });
        wrap.appendChild(list);
      }
      el.updatesList.appendChild(wrap);
    });
  }

  function opChip(detail) {
    let cls = "edit";
    let label = "改";
    if (detail.indexOf("新增") === 0) {
      cls = "add";
      label = "增";
    } else if (detail.indexOf("删除") === 0) {
      cls = "del";
      label = "删";
    }
    return `<span class="op-chip ${cls}">${label}</span>`;
  }

  function parsePrice(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    const nums = v.match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return null;
    const arr = nums.map(Number);
    if (arr.length >= 2) return (arr[0] + arr[1]) / 2;
    return arr[0];
  }

  function normalizeRegion(r) {
    const raw = String(r["区域"] || "").trim();
    const address = String(r["详细地址"] || "").trim();
    if (/大众点评|多家门店|搜索|哪儿都有|美团|连锁|点评/.test(raw)) {
      return { name: "全部区域", everywhere: true };
    }
    const source = raw || address;
    if (!source) {
      return { name: "全部区域", everywhere: true };
    }
    for (const [core, name] of DISTRICT_CORES) {
      if (source.indexOf(core) !== -1) {
        return { name, everywhere: false };
      }
    }
    return { name: "全部区域", everywhere: true };
  }

  function priceBucket(value) {
    const avg = parsePrice(value);
    if (avg === null) return "unknown";
    if (avg <= 50) return "0-50";
    if (avg <= 100) return "51-100";
    if (avg <= 150) return "101-150";
    if (avg <= 200) return "151-200";
    return "200+";
  }

  function priceLabel(key) {
    const found = PRICE_OPTIONS.find((o) => o[0] === key);
    return found ? found[1] : key;
  }

  function mapUrl(r) {
    const name = (r["餐厅名称"] || "").trim();
    const addr = (r["详细地址"] || "").trim();
    const keyword = /大众点评|多家门店|美团|搜索|点评|前往/.test(addr) ? name : `${name} ${addr}`.trim();
    return "https://uri.amap.com/search?keyword=" + encodeURIComponent(keyword || name);
  }

  function unique(arr) {
    return Array.from(new Set(arr));
  }

  function escapeHTML(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderFatal(err) {
    el.headerMeta.textContent = "数据加载失败";
    el.grid.innerHTML = "";
    el.empty.classList.remove("hidden");
    el.empty.querySelector("p").textContent = "数据加载失败：" + err.message;
  }

  function pinIcon() {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  }

  function externalIcon() {
    return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  }

  function playIcon() {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>';
  }

  function clockIcon() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  }
})();
