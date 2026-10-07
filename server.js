/* ============================================================
   SPPS — Student Performance Prediction System
   Zero-dependency Node.js backend
   (HTTP API + auth/sessions + SQLite + model serving + static UI)
   Run:  npm start        ->  http://localhost:3000
   ============================================================ */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const Core = require(path.join(__dirname, "public", "js", "inference.js"));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "spps.db");
const SESSION_DAYS = 7;
const MAX_BODY = 30 * 1024 * 1024; // models can carry training data (KNN)

/* ================= DATABASE ================= */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    metrics TEXT NOT NULL,
    preprocessing TEXT NOT NULL,
    classes TEXT NOT NULL,
    model TEXT NOT NULL,
    n_rows INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model_id INTEGER,
    input TEXT NOT NULL,
    prediction TEXT NOT NULL,
    confidence REAL NOT NULL,
    probabilities TEXT NOT NULL,
    explanation TEXT,
    recommendations TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pred_user ON predictions(user_id);
  CREATE INDEX IF NOT EXISTS idx_models_user ON models(user_id);
`);

/* ================= AUTH HELPERS ================= */
const hashPassword = (password, salt) =>
  crypto.scryptSync(password, salt, 64).toString("hex");

function createAccount(name, email, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const info = db.prepare(
    "INSERT INTO users (name,email,password_hash,salt,role,created_at) VALUES (?,?,?,?,?,?)"
  ).run(name, email, hash, salt, "user", new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function verifyAccount(email, password) {
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!u) return null;
  const hash = hashPassword(password, u.salt);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(u.password_hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return u;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare("INSERT INTO sessions (token,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(token, userId, expires, new Date().toISOString());
  return { token, expires };
}

function getUser(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (!m) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(m[1]);
  if (!s || s.expires_at < Date.now()) return null;
  const u = db.prepare("SELECT id,name,email,role,created_at FROM users WHERE id = ?").get(s.user_id);
  return u || null;
}

/* Seed the local demo admin, or a separately configured production admin. */
(function seedAdmin() {
  const production = process.env.NODE_ENV === "production";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@spps.local";
  const adminPassword = process.env.ADMIN_PASSWORD || (production ? "" : "admin123");
  if (production && adminPassword.length < 12) {
    throw new Error("Set ADMIN_PASSWORD to a unique password of at least 12 characters in production.");
  }
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!exists) {
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT INTO users (name,email,password_hash,salt,role,created_at) VALUES (?,?,?,?,?,?)")
      .run("Administrator", adminEmail, hashPassword(adminPassword, salt), salt, "admin", new Date().toISOString());
    console.log(`  Seeded admin account: ${adminEmail}`);
  }
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
})();

/* ================= HTTP UTILITIES ================= */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".csv": "text/csv; charset=utf-8", ".woff2": "font/woff2"
};

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  securityHeaders(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

/* simple login rate-limiting (only FAILED attempts count; success resets) */
const attempts = new Map();
function tooManyTries(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter(t => now - t < 600000);
  attempts.set(key, a);
  return a.length >= 10;
}
function recordFail(key) {
  const a = attempts.get(key) || [];
  a.push(Date.now());
  attempts.set(key, a);
}
function clearFails(key) { attempts.delete(key); }

/* ================= ROUTING ================= */
const routes = [];
const on = (method, pattern, handler) => routes.push({ method, pattern, handler, re: compile(pattern) });
function compile(p) {
  return new RegExp("^" + p.replace(/:[a-zA-Z_]+/g, "([^/]+)") + "$");
}
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at });
const J = v => { try { return JSON.parse(v); } catch { return null; } };

/* ---------- AUTH ---------- */
on("POST", "/api/auth/register", async (req, res, m, ctx) => {
  const { name, email, password } = ctx.body;
  if (!name || String(name).trim().length < 2) return sendJSON(res, 400, { error: "Name must be at least 2 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return sendJSON(res, 400, { error: "Please enter a valid email address." });
  if (!password || password.length < 6) return sendJSON(res, 400, { error: "Password must be at least 6 characters." });
  const em = String(email).toLowerCase().trim();
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(em)) return sendJSON(res, 409, { error: "An account with this email already exists." });
  const id = createAccount(String(name).trim(), em, password);
  const s = createSession(id);
  setSessionCookie(res, s);
  const u = db.prepare("SELECT id,name,email,role,created_at FROM users WHERE id = ?").get(id);
  return sendJSON(res, 201, { user: publicUser(u), message: "Account created." });
});

on("POST", "/api/auth/login", async (req, res, m, ctx) => {
  const { email, password } = ctx.body;
  const em = String(email || "").toLowerCase().trim();
  const key = ctx.ip + "|" + em;
  if (tooManyTries(key)) return sendJSON(res, 429, { error: "Too many failed login attempts. Try again in 10 minutes." });
  const u = verifyAccount(em, String(password || ""));
  if (!u) { recordFail(key); return sendJSON(res, 401, { error: "Incorrect email or password." }); }
  clearFails(key);
  const s = createSession(u.id);
  setSessionCookie(res, s);
  return sendJSON(res, 200, { user: publicUser(u), message: `Welcome back, ${u.name}!` });
});

on("POST", "/api/auth/logout", async (req, res) => {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (m) db.prepare("DELETE FROM sessions WHERE token = ?").run(m[1]);
  res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return sendJSON(res, 200, { message: "Logged out." });
});

on("GET", "/api/auth/me", async (req, res) => {
  const u = getUser(req);
  if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  return sendJSON(res, 200, { user: publicUser(u) });
});

function setSessionCookie(res, s) {
  res.setHeader("Set-Cookie",
    `sid=${s.token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax`);
}

/* ---------- DASHBOARD ---------- */
on("GET", "/api/dashboard", async (req, res) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const total = db.prepare("SELECT COUNT(*) c FROM predictions WHERE user_id = ?").get(u.id).c;
  const models = db.prepare("SELECT COUNT(*) c FROM models WHERE user_id = ?").get(u.id).c;
  const avg = db.prepare("SELECT AVG(confidence) a FROM predictions WHERE user_id = ?").get(u.id).a || 0;
  const dist = db.prepare("SELECT prediction, COUNT(*) c FROM predictions WHERE user_id = ? GROUP BY prediction").all(u.id);
  const days = db.prepare(`SELECT substr(created_at,1,10) d, COUNT(*) c FROM predictions
                           WHERE user_id = ? AND created_at >= ? GROUP BY d ORDER BY d`)
    .all(u.id, new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10));
  const recent = db.prepare(`SELECT id, prediction, confidence, created_at FROM predictions
                             WHERE user_id = ? ORDER BY id DESC LIMIT 5`).all(u.id);
  const bestModel = db.prepare(`SELECT id, name, algorithm, metrics, target, created_at FROM models
                                WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(u.id);
  return sendJSON(res, 200, {
    totals: { predictions: total, models, avgConfidence: Math.round(avg * 10) / 10 },
    distribution: dist, daily: days, recent,
    bestModel: bestModel ? { ...bestModel, metrics: J(bestModel.metrics) } : null
  });
});

/* ---------- MODELS ---------- */
on("GET", "/api/models", async (req, res) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const rows = db.prepare(`SELECT id,name,target,algorithm,metrics,n_rows,created_at,LENGTH(model) size
                           FROM models WHERE user_id = ? ORDER BY id DESC`).all(u.id);
  return sendJSON(res, 200, { models: rows.map(r => ({ ...r, metrics: J(r.metrics) })) });
});

on("GET", "/api/models/:id", async (req, res, m, ctx, params) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const r = db.prepare("SELECT * FROM models WHERE id = ? AND user_id = ?").get(params.id, u.id);
  if (!r) return sendJSON(res, 404, { error: "Model not found" });
  return sendJSON(res, 200, {
    model: { ...r, metrics: J(r.metrics), preprocessing: J(r.preprocessing), classes: J(r.classes), model: J(r.model) }
  });
});

on("POST", "/api/models", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const b = ctx.body;
  if (!b || !b.model || !b.pre || !Array.isArray(b.classes)) return sendJSON(res, 400, { error: "Invalid model payload." });
  if (b.classes.length < 2) return sendJSON(res, 400, { error: "Model must have at least 2 classes." });
  const name = String(b.name || "Untitled model").slice(0, 80);
  const info = db.prepare(`INSERT INTO models (user_id,name,target,algorithm,metrics,preprocessing,classes,model,n_rows,created_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(u.id, name, String(b.target || "target"), String(b.algorithm || b.algorithmName || "model"),
      JSON.stringify(b.metrics || {}), JSON.stringify(b.pre), JSON.stringify(b.classes),
      JSON.stringify(b.model), Number(b.nRows || 0), new Date().toISOString());
  return sendJSON(res, 201, { id: Number(info.lastInsertRowid), message: "Model saved to server." });
});

on("GET", "/api/models/:id/export", async (req, res, m, ctx, params) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const r = db.prepare("SELECT * FROM models WHERE id = ? AND user_id = ?").get(params.id, u.id);
  if (!r) return sendJSON(res, 404, { error: "Model not found" });
  const payload = {
    format: "spps-model-v1", exportedAt: new Date().toISOString(),
    name: r.name, target: r.target, algorithm: r.algorithm,
    metrics: J(r.metrics), classes: J(r.classes), preprocessing: J(r.preprocessing),
    model: J(r.model), nRows: r.n_rows, owner: u.email
  };
  securityHeaders(res);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${r.name.replace(/[^\w.-]+/g, "_")}.spps-model.json"`
  });
  res.end(JSON.stringify(payload, null, 2));
});

on("DELETE", "/api/models/:id", async (req, res, m, ctx, params) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const info = db.prepare("DELETE FROM models WHERE id = ? AND user_id = ?").run(params.id, u.id);
  return sendJSON(res, info.changes ? 200 : 404, info.changes ? { message: "Model deleted." } : { error: "Model not found" });
});

/* ---------- PREDICT (real backend inference) ---------- */
on("POST", "/api/predict", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const { modelId, input } = ctx.body || {};
  if (!input || typeof input !== "object") return sendJSON(res, 400, { error: "Input values are required." });
  const row = db.prepare("SELECT * FROM models WHERE id = ? AND user_id = ?").get(modelId, u.id);
  if (!row) return sendJSON(res, 404, { error: "No model selected or model not found. Train a model first." });

  const pre = J(row.preprocessing), classes = J(row.classes), model = J(row.model);
  if (!pre || !classes || !model) return sendJSON(res, 500, { error: "Stored model is corrupted." });

  const out = Core.predict(pre, model, classes, input);
  const expl = Core.explain(pre, model, classes, input);
  const recs = Core.recommend(pre, classes, input, out.prediction);
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO predictions
      (user_id,model_id,input,prediction,confidence,probabilities,explanation,recommendations,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(u.id, row.id, JSON.stringify(input), out.prediction, out.confidence,
      JSON.stringify(out.probabilities), JSON.stringify(expl), JSON.stringify(recs), now);

  return sendJSON(res, 200, {
    id: Number(info.lastInsertRowid),
    model: { id: row.id, name: row.name, algorithm: row.algorithm, target: row.target },
    input,
    prediction: out.prediction, target: row.target,
    confidence: out.confidence, probabilities: out.probabilities,
    explanation: expl, recommendations: recs, createdAt: now
  });
});

/* ---------- BATCH PREDICT (CSV rows -> server inference) ---------- */
on("POST", "/api/predict/batch", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const { modelId, rows, save } = ctx.body || {};
  if (!Array.isArray(rows) || !rows.length) return sendJSON(res, 400, { error: "Provide a non-empty array of rows." });
  if (rows.length > 500) return sendJSON(res, 400, { error: "Batch limited to 500 rows per request." });
  const row = db.prepare("SELECT * FROM models WHERE id = ? AND user_id = ?").get(modelId, u.id);
  if (!row) return sendJSON(res, 404, { error: "Model not found." });
  const pre = J(row.preprocessing), classes = J(row.classes), model = J(row.model);
  if (!pre || !classes || !model) return sendJSON(res, 500, { error: "Stored model is corrupted." });

  const results = [], now = new Date().toISOString();
  for (const input of rows) {
    if (!input || typeof input !== "object") continue;
    const out = Core.predict(pre, model, classes, input);
    results.push({
      input, prediction: out.prediction, confidence: out.confidence, probabilities: out.probabilities,
      explanation: Core.explain(pre, model, classes, input),
      recommendations: Core.recommend(pre, classes, input, out.prediction)
    });
  }
  let saved = 0;
  if (save && results.length) {
    const ins = db.prepare(`INSERT INTO predictions
      (user_id,model_id,input,prediction,confidence,probabilities,explanation,recommendations,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const r of results) {
      ins.run(u.id, row.id, JSON.stringify(r.input), r.prediction, r.confidence,
        JSON.stringify(r.probabilities), JSON.stringify(r.explanation), JSON.stringify(r.recommendations), now);
      saved++;
    }
  }
  return sendJSON(res, 200, { count: results.length, saved, model: { id: row.id, name: row.name, algorithm: row.algorithm, target: row.target }, results });
});

/* ---------- HISTORY (search · filter · pagination) ---------- */
on("GET", "/api/history", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const q = ctx.url.searchParams;
  const search = (q.get("q") || "").trim().toLowerCase();
  const cls = (q.get("prediction") || "").trim();
  const page = Math.max(1, parseInt(q.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.get("limit") || "10", 10) || 10));

  let where = "WHERE p.user_id = ?", args = [u.id];
  if (cls) { where += " AND p.prediction = ?"; args.push(cls); }
  if (search) { where += " AND (LOWER(p.input) LIKE ? OR LOWER(p.prediction) LIKE ? OR LOWER(COALESCE(m.name,'')) LIKE ?)";
    const like = "%" + search + "%"; args.push(like, like, like); }

  const total = db.prepare(`SELECT COUNT(*) c FROM predictions p LEFT JOIN models m ON m.id=p.model_id ${where}`).get(...args).c;
  const pages = Math.max(1, Math.ceil(total / limit));
  const offset = (Math.min(page, pages) - 1) * limit;
  const rows = db.prepare(`SELECT p.*, m.name model_name FROM predictions p
                           LEFT JOIN models m ON m.id = p.model_id ${where}
                           ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const counts = db.prepare("SELECT prediction, COUNT(*) c FROM predictions WHERE user_id = ? GROUP BY prediction").all(u.id);

  return sendJSON(res, 200, {
    history: rows.map(r => ({
      id: r.id, modelId: r.model_id, modelName: r.model_name,
      input: J(r.input), prediction: r.prediction, confidence: r.confidence,
      probabilities: J(r.probabilities), explanation: J(r.explanation),
      recommendations: J(r.recommendations), createdAt: r.created_at
    })),
    total, page: Math.min(page, pages), pages, limit, counts
  });
});

on("DELETE", "/api/history/:id", async (req, res, m, ctx, params) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const info = db.prepare("DELETE FROM predictions WHERE id = ? AND user_id = ?").run(params.id, u.id);
  return sendJSON(res, info.changes ? 200 : 404, info.changes ? { message: "Entry deleted." } : { error: "Entry not found" });
});

on("DELETE", "/api/history", async (req, res) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  db.prepare("DELETE FROM predictions WHERE user_id = ?").run(u.id);
  return sendJSON(res, 200, { message: "History cleared." });
});

/* ---------- ACCOUNT SETTINGS ---------- */
const currentToken = req => ((req.headers.cookie || "").match(/(?:^|;\s*)sid=([a-f0-9]+)/) || [])[1] || null;

on("PUT", "/api/account", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const name = String(ctx.body.name || "").trim();
  if (name.length < 2) return sendJSON(res, 400, { error: "Name must be at least 2 characters." });
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, u.id);
  return sendJSON(res, 200, { message: "Profile updated.", user: { ...u, name } });
});

on("POST", "/api/account/password", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const { currentPassword, newPassword } = ctx.body || {};
  const full = db.prepare("SELECT * FROM users WHERE id = ?").get(u.id);
  const hash = hashPassword(String(currentPassword || ""), full.salt);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(full.password_hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return sendJSON(res, 400, { error: "Current password is incorrect." });
  if (!newPassword || String(newPassword).length < 6)
    return sendJSON(res, 400, { error: "New password must be at least 6 characters." });
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
    .run(hashPassword(String(newPassword), salt), salt, u.id);
  const tok = currentToken(req);
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(u.id, tok || "");
  return sendJSON(res, 200, { message: "Password changed. Other sessions were logged out." });
});

on("GET", "/api/account/sessions", async (req, res) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const tok = currentToken(req);
  const rows = db.prepare("SELECT token, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC").all(u.id);
  return sendJSON(res, 200, {
    sessions: rows.map(s => ({
      current: s.token === tok, id: s.token.slice(0, 8),
      createdAt: s.created_at, expiresAt: new Date(s.expires_at).toISOString()
    }))
  });
});

on("DELETE", "/api/account/sessions", async (req, res) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const tok = currentToken(req);
  const info = db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(u.id, tok || "");
  return sendJSON(res, 200, { message: `${info.changes} other session(s) logged out.` });
});

on("DELETE", "/api/account", async (req, res, m, ctx) => {
  const u = getUser(req); if (!u) return sendJSON(res, 401, { error: "Not authenticated" });
  const full = db.prepare("SELECT * FROM users WHERE id = ?").get(u.id);
  const hash = hashPassword(String(ctx.body.password || ""), full.salt);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(full.password_hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return sendJSON(res, 400, { error: "Password is incorrect — account not deleted." });
  db.prepare("DELETE FROM predictions WHERE user_id = ?").run(u.id);
  db.prepare("DELETE FROM models WHERE user_id = ?").run(u.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return sendJSON(res, 200, { message: "Account and all data deleted permanently." });
});

/* ---------- ADMIN ---------- */
function requireAdmin(req, res) {
  const u = getUser(req);
  if (!u) { sendJSON(res, 401, { error: "Not authenticated" }); return null; }
  if (u.role !== "admin") { sendJSON(res, 403, { error: "Admin access required." }); return null; }
  return u;
}

on("GET", "/api/admin/stats", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const q = s => db.prepare(s).get();
  return sendJSON(res, 200, {
    users: q("SELECT COUNT(*) c FROM users").c,
    predictions: q("SELECT COUNT(*) c FROM predictions").c,
    models: q("SELECT COUNT(*) c FROM models").c,
    today: q(`SELECT COUNT(*) c FROM predictions WHERE substr(created_at,1,10) = date('now')`).c,
    avgConfidence: Math.round((q("SELECT AVG(confidence) a FROM predictions").a || 0) * 10) / 10
  });
});

on("GET", "/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.created_at,
      (SELECT COUNT(*) FROM predictions p WHERE p.user_id=u.id) predictions,
      (SELECT COUNT(*) FROM models m WHERE m.user_id=u.id) models
      FROM users u ORDER BY u.id`).all();
  return sendJSON(res, 200, { users: rows });
});

on("DELETE", "/api/admin/users/:id", async (req, res, m, ctx, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const id = Number(params.id);
  if (id === admin.id) return sendJSON(res, 400, { error: "You cannot delete your own admin account here." });
  const target = db.prepare("SELECT id, email FROM users WHERE id = ?").get(id);
  if (!target) return sendJSON(res, 404, { error: "User not found." });
  db.prepare("DELETE FROM predictions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM models WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return sendJSON(res, 200, { message: `User ${target.email} and all their data deleted.` });
});

on("GET", "/api/admin/predictions", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare(`SELECT p.id,p.prediction,p.confidence,p.created_at,u.email,u.name
      FROM predictions p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 100`).all();
  return sendJSON(res, 200, { predictions: rows });
});

/* ================= STATIC FILES ================= */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { securityHeaders(res); res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-style fallback -> login screen handled client side
      const idx = path.join(PUBLIC, "index.html");
      return fs.readFile(idx, (e2, buf) => {
        if (e2) { securityHeaders(res); res.writeHead(404); return res.end("Not found"); }
        securityHeaders(res);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buf);
      });
    }
    const ext = path.extname(file).toLowerCase();
    securityHeaders(res);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ================= SERVER ================= */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || "?";

  if (pathname.startsWith("/api/")) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = {};
      const keys = (r.pattern.match(/:[a-zA-Z_]+/g) || []).map(k => k.slice(1));
      keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      try {
        const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
        return await r.handler(req, res, m, { body, ip, url }, params);
      } catch (e) {
        console.error("API error:", req.method, pathname, e.message);
        return sendJSON(res, 500, { error: e.message || "Server error" });
      }
    }
    return sendJSON(res, 404, { error: "API route not found" });
  }

  if (["GET", "HEAD"].includes(req.method)) return serveStatic(req, res, pathname);
  securityHeaders(res);
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log("=====================================================");
  console.log("  SPPS — Student Performance Prediction System");
  console.log(`  Running at  http://localhost:${PORT}`);
  console.log(`  Database    ${DB_PATH}`);
  console.log(`  Login       ${process.env.ADMIN_EMAIL || "admin@spps.local"}${process.env.NODE_ENV === "production" ? "" : " / admin123"}`);
  console.log("=====================================================");
});

process.on("SIGINT", () => { console.log("\nShutting down..."); db.close(); process.exit(0); });
