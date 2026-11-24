
const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname);
const PORT = process.env.PORT || 3001;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

function readCatalog(cb) {
  fs.readFile(path.join(dir, 'catalog.json'), 'utf-8', cb);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (urlPath === '/api/resources') {
    readCatalog((err, data) => {
      if (err) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'catalog not found'})); return; }
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(data);
    });
    return;
  }

  if (urlPath === '/api/stats') {
    readCatalog((err, data) => {
      if (err) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'catalog not found'})); return; }
      const catalog = JSON.parse(data);
      const categories = {};
      for (const r of catalog.records) {
        categories[r.category] = (categories[r.category] || 0) + 1;
      }
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({
        total: catalog.records.length,
        categories,
        updated_at: catalog.updated_at,
        availability_generated_at: catalog.availability_generated_at
      }));
    });
    return;
  }

  const file = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const full = path.join(dir, file);
  let realFull;
  try { realFull = fs.realpathSync(full); }
  catch (e) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
  if (!realFull.startsWith(fs.realpathSync(dir))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(realFull, (err, buffer) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
    const ext = path.extname(realFull).toLowerCase();
    res.writeHead(200, {'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(buffer);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:' + PORT);
  console.log('Endpoints: / /api/stats /api/resources');
});
