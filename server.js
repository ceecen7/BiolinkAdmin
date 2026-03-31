// Admin Panel Server — Node.js built-in only
import { createServer }       from 'node:http';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { fileURLToPath }      from 'node:url';
import { exec }               from 'node:child_process';
import { promisify }          from 'node:util';

// ── load .env manually (no dotenv dep) ──────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url));
try {
  const raw = await readFile(join(__dirname, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch { /* .env optional */ }

const execAsync  = promisify(exec);
const PORT       = Number(process.env.ADMIN_PORT)  || 4000;
const WEB_DIR    = process.env.WEB_DIR             || '/root/Web';
const CONFIG     = join(WEB_DIR, 'config.json');
const GH_TOKEN   = process.env.GITHUB_TOKEN        || '';
const GH_REPO    = process.env.GITHUB_REPO         || 'ceecen7/Biolink';
const GH_BRANCH  = process.env.GITHUB_BRANCH       || 'main';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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

  // ── POST /api/config ─────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/config') {
    try {
      const body = await readBody(req);
      if (!body.name) { json(res, 400, { error: 'Nama wajib diisi' }); return; }
      await writeFile(CONFIG, JSON.stringify(body, null, 2), 'utf8');
      json(res, 200, { ok: true, message: 'Config berhasil disimpan!' });
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
      const { stdout: pushOut } = await execAsync(`git -C "${WEB_DIR}" push origin ${GH_BRANCH}`);
      json(res, 200, { ok: true, message: `Berhasil commit & push ke GitHub! (${GH_REPO})` });
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

  // ── Static files (public/) ───────────────────────────────────
  const filePath = path === '/' || path === ''
    ? join(__dirname, 'public', 'index.html')
    : join(__dirname, 'public', path);

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
