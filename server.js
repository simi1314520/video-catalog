const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname);
const catalogPath = path.join(dir, 'catalog.json');
const PORT = process.env.PORT || 3001;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const CATEGORY_LABELS = {
  online_video: '在线影视',
  video_app: '影视APP',
  tvbox_config: 'TVBox 配置',
  magnet_search: '磁力 BT',
  cloud_search: '网盘搜索',
  subtitles: '字幕',
  player: '播放器/空壳',
  subscription: '直播源',
  open_source: '开源项目'
};

const STATUS_ORDER = ['reachable', 'restricted', 'unreachable', 'unknown'];

// Search endpoints verified against the public sites or their current search forms.
const SEARCH_TEMPLATES = {
  kankanya: 'https://www.kankanya.me/search/-------------.html?wd={q}',
  'no-video': '__ORIGIN__/search/{q}',
  sotvla: '__ORIGIN__/search.php?q={q}',
  appmovie: '__ORIGIN__/index.php/vod/search.html?wd={q}',
  'ai-movie': '__ORIGIN__/?s={q}',
  czzymovie: 'https://www.4kcz.com/nimasile?q={q}',
  'auete-video': '__ORIGIN__/aeete5so.php?searchword={q}',
  netflixgc: '__ORIGIN__/vodsearch/{q}----------1---.html',
  nfyingshi: '__ORIGIN__/search?q={q}',
  dbku: '__ORIGIN__/vodsearch/-------------.html?wd={q}',
  'yingmao-cangku': '__ORIGIN__/search.html?wd={q}',
  'guangsu-yingshi': '__ORIGIN__/search.php?searchword={q}',
  fdzys: '__ORIGIN__/vodsearch/-------------.html?wd={q}',
  zndy: '__ORIGIN__/index.php/vod/search.html?wd={q}',
  yingshidaquan: '__ORIGIN__/search.php?q={q}',
  juzong: '__ORIGIN__/index.php/vodsearch/-------------.html?wd={q}',
  jianyunys: 'https://jisuzhuiju.com/search?keyword={q}',
  pianku: '__ORIGIN__/vodsearch/-------------.html?wd={q}',
  '66-dapianwang': '__ORIGIN__/vodsearch/-------------.html?wd={q}',
  didahd: '__ORIGIN__/search/-------------.html?wd={q}',
  zhuiying: '__ORIGIN__/index.php/vod/search.html?wd={q}',
  dhvideo: '__ORIGIN__/search/{q}',
  zip0: '__ORIGIN__/search?q={q}',
  'sa-video': '__ORIGIN__/search/{q}',
  subhd: '__ORIGIN__/search/{q}',
  'kanmovie-com-34': '__ORIGIN__/search?q={q}',
  'yingxivod-com-53': '__ORIGIN__/index.php/vod/search.html?wd={q}',
  'kuake-so-1': '__ORIGIN__/search?wd={q}',
  'ys-cxkjg-cn-39': '__ORIGIN__/search?wd={q}',
  'bt-yingshi': '__ORIGIN__/search?q={q}',
  'btshijiewang': '__ORIGIN__/?s={q}'
};

function readCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

function normalizeStatus(record) {
  const status = record.availability?.status;
  if (status === 'reachable' || status === 'restricted' || status === 'unreachable') {
    return status;
  }
  return 'unknown';
}

function originOf(record) {
  try {
    return new URL(record.url).origin;
  } catch {
    return record.url || '';
  }
}

function fallbackTemplate(record) {
  return `${originOf(record)}/?wd={q}`;
}

function templateFor(record) {
  return SEARCH_TEMPLATES[record.id] || fallbackTemplate(record);
}

function withOrigin(template, origin) {
  return String(template).replaceAll('__ORIGIN__', origin);
}

function toPublicResource(record) {
  const status = normalizeStatus(record);
  const origin = originOf(record);
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    link_url: record.link_url || null,
    category: record.category,
    category_label: CATEGORY_LABELS[record.category] || record.category,
    summary: record.summary || record.summary_short || '',
    scores: record.scores || null,
    risks: record.risks || null,
    verification: record.verification?.status || 'unknown',
    featured: Boolean(record.featured),
    featured_order: Number(record.featured_order) || 999,
    searchable: Boolean(SEARCH_TEMPLATES[record.id]),
    needs_vpn: (record.tags || []).some((tag) => /需梯子|梯子|VPN/i.test(tag)),
    status,
    http_status: record.availability?.http_status || null,
    response_ms: record.availability?.response_ms || null,
    origin,
    search_template: templateFor(record)
  };
}

function buildCatalogResponse(catalog) {
  const resources = catalog.records.map(toPublicResource);
  const counts = {
    total: resources.length,
    reachable: 0,
    restricted: 0,
    unreachable: 0,
    unknown: 0,
    searchable: resources.filter((record) => record.searchable).length
  };
  for (const record of resources) counts[record.status] += 1;

  const categoryCounts = {};
  for (const record of resources) {
    categoryCounts[record.category] = (categoryCounts[record.category] || 0) + 1;
  }

  const categories = Object.keys(CATEGORY_LABELS)
    .filter((key) => categoryCounts[key])
    .map((key) => ({ key, label: CATEGORY_LABELS[key], count: categoryCounts[key] }))
    .sort((a, b) => b.count - a.count);

  resources.sort((a, b) => {
    const featured = Number(b.featured) - Number(a.featured);
    if (featured) return featured;
    const status = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (status) return status;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return {
    generated_at: new Date().toISOString(),
    source_updated_at: catalog.updated_at || '未知',
    availability_generated_at: catalog.availability_generated_at || null,
    counts,
    categories,
    resources
  };
}

function buildTemplatesResponse(catalog) {
  const sites = {};
  for (const record of catalog.records) {
    const origin = originOf(record);
    const explicit = Boolean(SEARCH_TEMPLATES[record.id]);
    const template = templateFor(record);
    sites[record.id] = {
      name: record.name,
      origin,
      category: record.category,
      ok: explicit,
      kind: 'html',
      template,
      sample_url: withOrigin(template, origin).replace('{q}', encodeURIComponent('阿凡达')),
      error: explicit ? null : '没有已验证的站内搜索模板，将尝试通用参数'
    };
  }
  return {
    generated_at: new Date().toISOString(),
    probe_keyword: '阿凡达',
    summary: {
      total: Object.keys(sites).length,
      ok: Object.values(sites).filter((site) => site.ok).length,
      failed: Object.values(sites).filter((site) => !site.ok).length
    },
    sites
  };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value) {
  return decodeEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractResults(html, baseUrl, query, site) {
  const normalizedQuery = query.replace(/\s+/g, '').toLowerCase();
  const results = [];
  const seen = new Set();
  const seenTitles = new Set();
  const skipPath = /\/(?:login|register|user|gbook|about|privacy|dmca|rss|tag|type|vodtype|label)(?:\/|$)|\.(?:jpg|jpeg|png|webp|gif|svg|css|js|xml)(?:$|\?)/i;
  const detailPath = /(?:voddetail|vod\/detail|detail|vodplay|play|movie|tv|video|subject|drama|anime)/i;
  const genericTitles = new Set(['首页', '电影', '电视剧', '动漫', '综艺', '短剧', '综合', '热度排序', '年份排序', '搜索', '返回', '更多']);
  let baseOrigin = '';
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    baseOrigin = '';
  }

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1];
    const hrefMatch = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;

    const href = decodeEntities(hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim();
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;

    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/i.test(url.protocol)) continue;
    if (baseOrigin && url.origin === baseOrigin && url.pathname === '/') continue;
    if (skipPath.test(url.pathname) || skipPath.test(url.href)) continue;
    if (/\/search(?:\/|\.php|$)/i.test(url.pathname) && !detailPath.test(url.pathname)) continue;

    const titleAttr = attributes.match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const title = stripTags(titleAttr?.[1] || titleAttr?.[2] || titleAttr?.[3] || match[2]);
    if (genericTitles.has(title) && !detailPath.test(url.pathname)) continue;

    const haystack = title.replace(/\s+/g, '').toLowerCase();
    const titleKey = title.replace(/\s+/g, '').toLowerCase();

    if (!title || title.length < 2 || !haystack.includes(normalizedQuery)) continue;
    if (url.href === baseUrl || /[?&](?:q|wd|searchword)=/i.test(url.search) && detailPath.test(url.pathname) === false) {
      continue;
    }
    if (seen.has(url.href)) continue;
    if (seenTitles.has(titleKey)) continue;
    seen.add(url.href);
    seenTitles.add(titleKey);
    results.push({
      title: title.slice(0, 180),
      url: url.href,
      site_id: site.id,
      site_name: site.name
    });
    if (results.length >= 20) break;
  }

  return results;
}

async function searchSite(site, query) {
  const searchUrl = site.template.replace('{q}', encodeURIComponent(query));
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch(searchUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6'
      }
    });
    const html = await response.text();
    if (!response.ok) {
      return {
        site: {
          ...site,
          ok: false,
          count: 0,
          rendered: false,
          error: `HTTP ${response.status}`,
          ms: Date.now() - started,
          search_url: searchUrl
        },
        results: []
      };
    }

    const results = extractResults(html, response.url, query, site);
    const queryDisplayed = html.includes(query) ||
      html.toLowerCase().includes(encodeURIComponent(query).toLowerCase()) ||
      html.toLowerCase().includes(encodeURIComponent(query).replace(/%/g, '%25').toLowerCase());
    const rendered = results.length > 0;
    const ok = response.ok && (queryDisplayed || rendered);
    return {
      site: {
        ...site,
        ok,
        count: results.length,
        rendered,
        error: ok ? null : (html.length < 1200 ? '页面受防护或内容过短' : '没有识别到搜索结果'),
        ms: Date.now() - started,
        search_url: searchUrl
      },
      results
    };
  } catch (error) {
    return {
      site: {
        ...site,
        ok: false,
        count: 0,
        rendered: false,
        error: error.name === 'AbortError' ? '请求超时' : error.message,
        ms: Date.now() - started,
        search_url: searchUrl
      },
      results: []
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSearch(searchParams) {
  const query = (searchParams.get('q') || '').trim();
  if (!query) {
    return { statusCode: 400, body: { error: '缺少搜索关键词 q' } };
  }

  const catalog = readCatalog();
  const categories = (searchParams.get('cats') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const resources = catalog.records
    .filter((record) => SEARCH_TEMPLATES[record.id])
    .filter((record) => !categories.length || categories.includes(record.category));
  const templates = buildTemplatesResponse(catalog).sites;
  const started = Date.now();

  const outcomes = await Promise.all(resources.map((record) => {
    const site = {
      id: record.id,
      name: record.name,
      category: record.category,
      origin: originOf(record),
      template: withOrigin(SEARCH_TEMPLATES[record.id], originOf(record))
    };
    const publicSite = templates[record.id];
    site.template = withOrigin(publicSite.template, site.origin);
    return searchSite(site, query);
  }));

  return {
    statusCode: 200,
    body: {
      query,
      took_ms: Date.now() - started,
      results: outcomes.flatMap((outcome) => outcome.results),
      sites: outcomes.map((outcome) => outcome.site)
    }
  };
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = decodeURIComponent(requestUrl.pathname);

  try {
    if (urlPath === '/api/resources') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(fs.readFileSync(catalogPath));
      return;
    }

    if (urlPath === '/api/catalog') {
      sendJson(res, 200, buildCatalogResponse(readCatalog()));
      return;
    }

    if (urlPath === '/api/templates') {
      sendJson(res, 200, buildTemplatesResponse(readCatalog()));
      return;
    }

    if (urlPath === '/api/search') {
      const result = await handleSearch(requestUrl.searchParams);
      sendJson(res, result.statusCode, result.body);
      return;
    }

    if (urlPath === '/api/stats') {
      const catalog = readCatalog();
      const publicCatalog = buildCatalogResponse(catalog);
      sendJson(res, 200, {
        total: catalog.records.length,
        categories: Object.fromEntries(publicCatalog.categories.map((category) => [category.key, category.count])),
        updated_at: catalog.updated_at,
        availability_generated_at: catalog.availability_generated_at,
        searchable: publicCatalog.counts.searchable
      });
      return;
    }

    const file = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const fullPath = path.resolve(dir, file);
    if (!fullPath.startsWith(`${dir}${path.sep}`) && fullPath !== path.join(dir, 'index.html')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(fullPath, (error, buffer) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const extension = path.extname(fullPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mime[extension] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(buffer);
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log('Endpoints: / /api/catalog /api/templates /api/search /api/resources /api/stats');
});
