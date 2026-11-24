const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  catalog: null,
  templates: null,
  cat: '',
  navCat: '',
  loading: false,
  lastResults: [],
  favs: new Set(),
  history: []
};

const STATUS_LABEL = {
  reachable: '可访问',
  restricted: '受限',
  unreachable: '失效',
  unknown: '未检测'
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const store = {
  get(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private browsing can make localStorage unavailable.
    }
  }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function stars(value) {
  const count = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return '★'.repeat(count) + '☆'.repeat(5 - count);
}

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function loadLocal() {
  state.favs = new Set(store.get('zj_favs', []));
  state.history = store.get('zj_history', []);
}

function saveFavs() {
  store.set('zj_favs', [...state.favs]);
}

function pushHistory(query, hits) {
  state.history = [
    { q: query, ts: Date.now(), n: hits },
    ...state.history.filter((item) => item.q !== query)
  ].slice(0, 40);
  store.set('zj_history', state.history);
}

function siteTemplate(record) {
  const site = state.templates?.sites?.[record.id];
  return site?.template || record.search_template || `${record.origin}/?wd={q}`;
}

function siteSearchUrl(record, query) {
  return String(siteTemplate(record))
    .replaceAll('__ORIGIN__', record.origin || new URL(record.url).origin)
    .replaceAll('{q}', encodeURIComponent(query));
}

async function boot() {
  loadLocal();
  const [catalog, templates] = await Promise.all([
    fetch('/api/catalog').then((response) => response.json()),
    fetch('/api/templates').then((response) => response.json())
  ]);

  state.catalog = catalog;
  state.templates = templates;

  const counts = catalog.counts;
  $('#brand-sub').textContent = `${counts.total} 个资源 · ${counts.reachable} 个在线 · 数据 ${catalog.source_updated_at}`;
  $('#site-count').textContent = countSearchable();
  $('#meta').textContent = `目录生成于 ${new Date(catalog.generated_at).toLocaleString('zh-CN')}`;

  renderNavChips();
  renderNavGrid();
  renderSearchChipsCount();

  const initialQuery = new URLSearchParams(window.location.search).get('q')?.trim();
  if (initialQuery) {
    $('#q').value = initialQuery;
    doSearch();
  }
}

function countSearchable() {
  if (!state.catalog) return 0;
  return state.catalog.resources.filter((record) =>
    record.searchable && state.templates?.sites?.[record.id]?.ok
  ).length;
}

function renderSearchChipsCount() {
  const templates = state.templates?.sites || {};
  const pool = (state.catalog?.resources || []).filter(
    (record) => record.searchable && templates[record.id]?.ok
  );
  const counts = {
    '': pool.length,
    online_video: pool.filter((record) => record.category === 'online_video').length,
    cloud_search: pool.filter((record) => record.category === 'cloud_search').length,
    magnet_search: pool.filter((record) => record.category === 'magnet_search').length,
    subtitles: pool.filter((record) => record.category === 'subtitles').length
  };

  $$('#chips .chip').forEach((element) => {
    const label = element.textContent.replace(/\s*\d+\s*$/, '').trim();
    element.innerHTML = `${esc(label)}<span class="n">${counts[element.dataset.cat] || 0}</span>`;
  });
}

$('#chips').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  $$('#chips .chip').forEach((element) => element.classList.remove('active'));
  chip.classList.add('active');
  state.cat = chip.dataset.cat;
  if ($('#q').value.trim()) doSearch();
});

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  doSearch();
});

async function doSearch() {
  const query = $('#q').value.trim();
  if (!query || state.loading) return;

  const url = new URL(window.location.href);
  url.searchParams.set('q', query);
  history.replaceState(null, '', url);

  state.loading = true;
  $('#go').disabled = true;
  $('#go').textContent = '搜索中…';
  $('#empty').classList.add('hidden');
  $('#results').innerHTML = '';
  $('#statusline').classList.remove('hidden');
  $('#statusline').innerHTML = '<span class="pill">正在并发搜索各站点…</span>';

  const started = performance.now();
  try {
    const category = state.cat ? `&cats=${encodeURIComponent(state.cat)}` : '';
    const data = await fetch(`/api/search?q=${encodeURIComponent(query)}${category}`).then((response) => response.json());
    renderResults(data, Math.round(performance.now() - started));
    pushHistory(query, data.results.length);
  } catch (error) {
    $('#statusline').innerHTML = `<span class="pill" style="color:var(--bad)">搜索失败：${esc(error.message)}</span>`;
  } finally {
    state.loading = false;
    $('#go').disabled = false;
    $('#go').textContent = '搜全网';
  }
}

function renderSiteSearchLinks(query) {
  const records = (state.catalog?.resources || []).filter(
    (record) => record.category === 'online_video'
  );
  if (!records.length) return '';

  return `
    <section class="empty-site-links">
      <h3>在各站搜索“${esc(query)}”</h3>
      <div class="nav-grid">
        ${records.map((record) => `
          <a class="nav-card" href="${esc(siteSearchUrl(record, query))}" target="_blank" rel="noopener noreferrer">
            <div class="name">${esc(record.name)}</div>
            <div class="url">${esc(hostOf(record.origin || record.url))}</div>
            <div class="desc">打开站点搜索页，关键词已自动填写。</div>
            <div class="foot">
              <span class="st ${esc(record.status)}"><i></i>${STATUS_LABEL[record.status] || record.status}</span>
              <span class="tag-mini">去搜索 ↗</span>
            </div>
          </a>
        `).join('')}
      </div>
    </section>
  `;
}

function renderResults(data, elapsed) {
  const okSites = data.sites.filter((site) => site.ok);
  const totalHits = data.results.length;

  $('#statusline').innerHTML = [
    `<span class="pill"><i class="dot" style="background:var(--ok)"></i>${okSites.length} 个站点响应</span>`,
    `<span class="pill"><i class="dot" style="background:var(--accent-2)"></i>${totalHits} 条结果</span>`,
    `<span class="pill">${data.took_ms ?? elapsed} ms</span>`,
    ...data.sites
      .filter((site) => !site.ok)
      .slice(0, 4)
      .map((site) => `<span class="pill" title="${esc(site.error || '')}"><i class="dot" style="background:var(--bad)"></i>${esc(site.name)}</span>`)
  ].join('');

  if (!totalHits) {
    const failed = data.sites.length - okSites.length;
    $('#empty').classList.remove('hidden');
    $('#empty').innerHTML = `
      <div class="empty-ico">🕵️</div>
      <p>“${esc(data.query)}”暂时没有聚合结果</p>
      <p class="muted">${okSites.length} 个站点正常响应${failed ? `，${failed} 个站点请求失败` : ''}。也可以直接带着关键词去各站搜索。</p>
      ${renderSiteSearchLinks(data.query)}
    `;
    return;
  }

  const groups = new Map();
  for (const item of data.results) {
    if (!groups.has(item.site_id)) {
      groups.set(item.site_id, { name: item.site_name, items: [] });
    }
    groups.get(item.site_id).items.push(item);
  }

  let rank = 0;
  const html = [];
  for (const group of [...groups.values()].sort((a, b) => b.items.length - a.items.length)) {
    html.push(`<div class="group-title">${esc(group.name)} · ${group.items.length} 条</div>`);
    for (const item of group.items) {
      rank += 1;
      html.push(`
        <a class="result" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
          <span class="rank">${rank}</span>
          <span class="body">
            <span class="title">${esc(item.title)}</span>
            <span class="src">${esc(hostOf(item.url))}<span class="badge">${esc(item.site_name)}</span></span>
          </span>
          <span class="ext">↗</span>
        </a>
      `);
    }
  }

  $('#results').innerHTML = html.join('');
  state.lastResults = data.results;
}

function renderNavChips() {
  const categories = state.catalog.categories;
  const html = [
    `<button class="chip active" data-cat="">全部<span class="n">${state.catalog.counts.total}</span></button>`
  ];
  for (const category of categories) {
    html.push(
      `<button class="chip" data-cat="${esc(category.key)}">${esc(category.label)}<span class="n">${category.count}</span></button>`
    );
  }
  $('#nav-chips').innerHTML = html.join('');
}

$('#nav-chips').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  $$('#nav-chips .chip').forEach((element) => element.classList.remove('active'));
  chip.classList.add('active');
  state.navCat = chip.dataset.cat;
  renderNavGrid();
});

function navCard(record) {
  return `
    <a class="nav-card" href="${esc(record.url)}" target="_blank" rel="noopener noreferrer" data-id="${esc(record.id)}">
      <span class="fav-btn ${state.favs.has(record.id) ? 'on' : ''}" data-fav="${esc(record.id)}" title="收藏/取消收藏">★</span>
      <div class="name">${esc(record.name)}${record.needs_vpn ? ' <span class="tag-mini tag-vpn">需梯子</span>' : ''}</div>
      <div class="url">${esc(record.origin || record.url)}</div>
      <div class="desc">${esc(record.summary)}</div>
      <div class="foot">
        <span class="st ${esc(record.status)}"><i></i>${STATUS_LABEL[record.status] || record.status}</span>
        <span class="stars" title="推荐指数 ${record.scores?.more ?? '-'}">${stars(record.scores?.more)}</span>
      </div>
    </a>
  `;
}

function renderNavGrid() {
  const items = state.catalog.resources.filter(
    (record) => !state.navCat || record.category === state.navCat
  );
  $('#nav-grid').innerHTML = items.map(navCard).join('');
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-fav]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.fav;
  if (state.favs.has(id)) state.favs.delete(id);
  else state.favs.add(id);
  saveFavs();
  button.classList.toggle('on', state.favs.has(id));
  if ($('#view-mine').classList.contains('active')) renderFavs();
});

function renderFavs() {
  const items = state.catalog.resources.filter((record) => state.favs.has(record.id));
  if (!items.length) {
    $('#fav-list').innerHTML = '<p class="muted">还没有收藏。去“站点导航”点卡片右上角的 ★。</p>';
    return;
  }
  $('#fav-list').innerHTML = items.map(navCard).join('');
}

function renderHistory() {
  if (!state.history.length) {
    $('#history-list').innerHTML = '<p class="muted">还没有搜索记录。</p>';
    return;
  }
  $('#history-list').innerHTML = state.history.map((item) => `
    <span class="hist" data-q="${esc(item.q)}">
      ${esc(item.q)} <span class="t">${item.n} 条</span>
      <button class="del" data-del="${esc(item.q)}" title="删除">×</button>
    </span>
  `).join('');
}

$('#history-list').addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-del]');
  if (deleteButton) {
    event.stopPropagation();
    state.history = state.history.filter((item) => item.q !== deleteButton.dataset.del);
    store.set('zj_history', state.history);
    renderHistory();
    return;
  }

  const chip = event.target.closest('[data-q]');
  if (!chip) return;
  switchView('search');
  $('#q').value = chip.dataset.q;
  doSearch();
});

$('#history-clear').addEventListener('click', () => {
  state.history = [];
  store.set('zj_history', state.history);
  renderHistory();
});

async function fetchOne(keyword) {
  try {
    return await fetch(`/api/search?q=${encodeURIComponent(keyword)}`).then((response) => response.json());
  } catch {
    return { query: keyword, results: [], sites: [] };
  }
}

$('#cmp-go').addEventListener('click', runCompare);
$('#cmp-q').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runCompare();
});

async function runCompare() {
  const keywords = [
    ...new Set(
      $('#cmp-q').value
        .split(/[,，、\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ].slice(0, 5);

  if (keywords.length < 2) {
    $('#cmp-out').innerHTML = '<p class="muted" style="margin-top:14px">至少输入两个关键词，用逗号分隔。</p>';
    return;
  }

  const button = $('#cmp-go');
  button.disabled = true;
  button.textContent = '对比中…';
  $('#cmp-out').innerHTML = `<p class="muted" style="margin-top:14px">正在并行搜索 ${keywords.length} 个关键词…</p>`;

  const data = await Promise.all(keywords.map(fetchOne));
  button.disabled = false;
  button.textContent = '开始对比';

  const siteNames = new Map();
  for (const result of data) {
    for (const site of result.sites) siteNames.set(site.id, site.name);
  }

  const rows = [...siteNames.entries()].map(([id, name]) => ({
    id,
    name,
    counts: data.map((result) => result.sites.find((site) => site.id === id)?.count ?? 0)
  }));
  rows.sort((a, b) =>
    b.counts.reduce((sum, value) => sum + value, 0) -
    a.counts.reduce((sum, value) => sum + value, 0)
  );

  const totals = data.map((result) => result.results.length);
  const shown = rows.filter((row) => row.counts.some((count) => count > 0)).slice(0, 18);
  const head = `<tr><th>站点</th>${data.map((result) => `<th>${esc(result.query)}</th>`).join('')}</tr>`;
  const body = shown.map((row) =>
    `<tr><td>${esc(row.name)}</td>${row.counts.map((count) =>
      `<td class="${count === 0 ? 'zero' : count >= 5 ? 'hot' : ''}">${count || '—'}</td>`
    ).join('')}</tr>`
  ).join('');
  const total = `<tr class="total"><td>合计</td>${totals.map((count) => `<td>${count}</td>`).join('')}</tr>`;

  const titleSets = data.map((result) =>
    new Set(result.results.map((item) => item.title.replace(/\s+/g, '')))
  );
  const uniqueBoxes = data.map((result, index) => {
    const unique = result.results.filter((item) => {
      const title = item.title.replace(/\s+/g, '');
      return titleSets.every((set, setIndex) => setIndex === index || !set.has(title));
    }).slice(0, 6);
    if (!unique.length) return '';
    return `
      <div class="box">
        <h3>只在“${esc(result.query)}”出现</h3>
        <ul>${unique.map((item) =>
          `<li>${esc(item.title)} <span style="color:#4a5a75">· ${esc(item.site_name)}</span></li>`
        ).join('')}</ul>
      </div>
    `;
  }).join('');

  const best = data.reduce((a, b) => (b.results.length > a.results.length ? b : a), data[0]);
  $('#cmp-out').innerHTML = `
    <p class="muted" style="margin-top:16px">结果最多：<strong style="color:var(--ok)">${esc(best.query)}</strong>（${best.results.length} 条）</p>
    <table class="cmp-table"><thead>${head}</thead><tbody>${body}${total}</tbody></table>
    ${uniqueBoxes ? `<div class="cmp-unique">${uniqueBoxes}</div>` : ''}
  `;
}

function switchView(view) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  $$('.view').forEach((element) => element.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  if (view === 'search') $('#q').focus();
  if (view === 'mine') {
    renderHistory();
    renderFavs();
  }
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

boot().catch((error) => {
  $('#brand-sub').textContent = `加载失败：${error.message}`;
});
