// Admin Panel Server — Node.js built-in only
import { createServer }       from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname }       from 'node:path';
import { fileURLToPath }       from 'node:url';
import { exec }                from 'node:child_process';
import { promisify }           from 'node:util';
import { createHash }          from 'node:crypto';

// ── load .env ────────────────────────────────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url));
try {
  const raw = await readFile(join(__dirname, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch { /* .env optional */ }

const execAsync    = promisify(exec);
const PORT         = Number(process.env.ADMIN_PORT) || 4000;
const WEB_DIR      = process.env.WEB_DIR            || '/root/Web';
const CONFIG       = join(WEB_DIR, 'config.json');
const GH_TOKEN     = process.env.GITHUB_TOKEN       || '';
const GH_REPO      = process.env.GITHUB_REPO        || 'ceecen7/Biolink';
const GH_BRANCH    = process.env.GITHUB_BRANCH      || 'main';
const ADMIN_USER      = process.env.ADMIN_USERNAME      || 'ceecen7';
const ADMIN_PASS_HASH = process.env.ADMIN_PASSWORD_HASH || '';

function hashPassword(plain) {
  return createHash('sha256').update(plain).digest('hex');
}

// Token session in-memory (reset saat server restart)
const activeSessions = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ── generate static index.html dari config ───────────────────────
function generateHTML(cfg) {
  const linksHTML = (cfg.links || []).map(l => `
      <a href="${escAttr(l.url)}" target="_blank" rel="noopener" class="link-btn ${escAttr(l.color)}">
        <div class="link-icon">${l.icon}</div>
        <span class="link-label">${escText(l.label)}</span>
        <span class="link-arr">›</span>
      </a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escText(cfg.name)} | ${escText(cfg.handle)}</title>
  <link rel="stylesheet" href="assets/css/style.css" />
</head>
<body>

  <canvas id="stars-canvas"></canvas>

  <div class="nebula nebula-1"></div>
  <div class="nebula nebula-2"></div>
  <div class="nebula nebula-3"></div>

  <div class="card">

    <div class="avatar-wrap">
      <div class="avatar-ring"></div>
      <div class="avatar">
        <img src="${escAttr(cfg.avatar)}" alt="${escAttr(cfg.name)}" />
      </div>
    </div>

    <div class="name">${escText(cfg.name)}</div>
    <div class="handle">${escText(cfg.handle)}</div>

    <p class="bio">${escText(cfg.bio).replace(/\n/g, '<br>')}</p>

    <div class="divider"></div>

    <div class="links">
${linksHTML}
    </div>

    <div class="footer">${escText(cfg.footer)}</div>

  </div>

  <script src="assets/js/app.js"></script>

</body>
</html>
`;
}

function escText(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

// ── helpers ──────────────────────────────────────────────────────
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── server ───────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url  = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── POST /api/login ──────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/login') {
    const body = await readBody(req);
    if (body.username === ADMIN_USER && hashPassword(body.password) === ADMIN_PASS_HASH) {
      const token = crypto.randomUUID();
      activeSessions.add(token);
      json(res, 200, { ok: true, token });
    } else {
      json(res, 401, { error: 'Username atau password salah.' });
    }
    return;
  }

  // ── POST /api/logout ─────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/logout') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    activeSessions.delete(token);
    json(res, 200, { ok: true });
    return;
  }

  // ── Auth check untuk semua /api/* ─────────────────────────────
  if (path.startsWith('/api/')) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!activeSessions.has(token)) {
      json(res, 401, { error: 'Unauthorized. Silakan login dulu.' });
      return;
    }
  }

  // ── GET /api/config ──────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/config') {
    try {
      const data = await readFile(CONFIG, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/config — simpan config + generate index.html ───
  if (req.method === 'POST' && path === '/api/config') {
    try {
      const body = await readBody(req);
      if (!body.name) { json(res, 400, { error: 'Nama wajib diisi' }); return; }

      // Simpan config.json
      await writeFile(CONFIG, JSON.stringify(body, null, 2), 'utf8');

      // Generate index.html static dari config
      const html = generateHTML(body);
      await writeFile(join(WEB_DIR, 'index.html'), html, 'utf8');

      json(res, 200, { ok: true, message: 'Disimpan! index.html sudah diperbarui.' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/commit ─────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/commit') {
    try {
      const body = await readBody(req);
      const msg  = (body.message || 'update: edit via admin panel').replace(/"/g, "'");

      if (!GH_TOKEN) { json(res, 400, { error: 'GITHUB_TOKEN tidak ditemukan di .env' }); return; }

      const remote = `https://${GH_TOKEN}@github.com/${GH_REPO}.git`;

      await execAsync(`git -C "${WEB_DIR}" config user.email "admin@biolink.local"`);
      await execAsync(`git -C "${WEB_DIR}" config user.name  "Biolink Admin"`);
      await execAsync(`git -C "${WEB_DIR}" remote set-url origin "${remote}"`);
      await execAsync(`git -C "${WEB_DIR}" add -A`);

      const { stdout: status } = await execAsync(`git -C "${WEB_DIR}" status --porcelain`);
      if (!status.trim()) {
        json(res, 200, { ok: true, message: 'Tidak ada perubahan baru.' });
        return;
      }

      await execAsync(`git -C "${WEB_DIR}" commit -m "${msg}"`);
      await execAsync(`git -C "${WEB_DIR}" push origin ${GH_BRANCH}`);
      json(res, 200, { ok: true, message: `Berhasil push ke GitHub! GitHub Pages akan update otomatis.` });
    } catch (e) {
      json(res, 500, { error: e.stderr || e.message });
    }
    return;
  }

  // ── GET /api/status ──────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/status') {
    try {
      const { stdout } = await execAsync(`git -C "${WEB_DIR}" log --oneline -5`);
      json(res, 200, { ok: true, log: stdout.trim() });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── Static files (root) ─────────────────────────────────────
  const filePath = path === '/' || path === ''
    ? join(__dirname, 'index.html')
    : join(__dirname, path);

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🌌 Biolink Admin Panel → http://localhost:${PORT}\n`);
});
