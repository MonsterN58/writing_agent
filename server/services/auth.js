import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { runWithUser } from './user-context.js';

const ROOT = path.resolve(process.cwd());
const DATA_ROOT = path.join(ROOT, 'data');
const AUTH_DIR = path.join(DATA_ROOT, 'auth');
const USERS_PATH = path.join(AUTH_DIR, 'users.json');
const SESSION_SECRET_PATH = path.join(AUTH_DIR, 'session-secret');
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const ITERATIONS = 210000;
const KEYLEN = 32;
const DIGEST = 'sha256';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_DAYS || 7) * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'moshu_sid';

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(username) {
  const value = String(username || '').trim();
  if (!USERNAME_RE.test(value)) {
    throw new Error('用户名只能包含 3-32 位英文字母、数字、下划线或连字符');
  }
  return value;
}

function userIdFromUsername(username) {
  return username.toLowerCase();
}

function userPublic(user) {
  return { id: user.id, username: user.username, role: user.role || 'user' };
}

function userRuntime(user) {
  const id = user.id;
  const root = path.join(DATA_ROOT, 'users', id);
  return {
    ...userPublic(user),
    root,
    novelsRoot: path.join(root, 'novels'),
    configPath: path.join(root, 'llm-config.json'),
  };
}

async function ensureAuthDir() {
  await fsp.mkdir(AUTH_DIR, { recursive: true });
}

async function readDb() {
  try {
    const raw = await fsp.readFile(USERS_PATH, 'utf8');
    const db = JSON.parse(raw);
    return { users: Array.isArray(db?.users) ? db.users : [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { users: [] };
    throw e;
  }
}

async function writeDb(db) {
  await ensureAuthDir();
  await fsp.writeFile(USERS_PATH, JSON.stringify({ users: db.users || [] }, null, 2), 'utf8');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const raw = String(password || '');
  if (raw.length < 8) throw new Error('密码至少需要 8 位');
  const hash = crypto.pbkdf2Sync(raw, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return { salt, hash, iterations: ITERATIONS, digest: DIGEST };
}

function verifyPassword(password, record) {
  const hash = crypto.pbkdf2Sync(
    String(password || ''),
    record.salt,
    Number(record.iterations || ITERATIONS),
    KEYLEN,
    record.digest || DIGEST,
  ).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(record.passwordHash || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

async function getSessionSecret() {
  await ensureAuthDir();
  try {
    const raw = await fsp.readFile(SESSION_SECRET_PATH, 'utf8');
    const value = raw.trim();
    if (value.length >= 32) return value;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  await fsp.writeFile(SESSION_SECRET_PATH, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function cookieOptions(maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
  ];
  if (maxAgeSeconds != null) parts[0] = `${COOKIE_NAME}=__VALUE__`;
  if (maxAgeSeconds != null) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (process.env.AUTH_COOKIE_SECURE === '1') parts.push('Secure');
  return parts;
}

function setSessionCookie(res, sid, ttlMs = SESSION_TTL_MS) {
  const maxAge = Math.floor(ttlMs / 1000);
  const parts = cookieOptions(maxAge);
  parts[0] = `${COOKIE_NAME}=${encodeURIComponent(sid)}`;
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = cookieOptions(0);
  parts[0] = `${COOKIE_NAME}=`;
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function createSession(user) {
  const payload = encodeJson({
    uid: user.id,
    exp: Date.now() + SESSION_TTL_MS,
  });
  const sig = signPayload(payload, await getSessionSecret());
  return `${payload}.${sig}`;
}

async function getSession(req) {
  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!sid) return null;
  const [payload, sig] = sid.split('.');
  if (!payload || !sig) return null;
  const expected = signPayload(payload, await getSessionSecret());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = decodeJson(payload);
  } catch {
    return null;
  }
  if (!data?.uid || !Number.isFinite(Number(data.exp)) || Number(data.exp) <= Date.now()) {
    return null;
  }
  const db = await readDb();
  const user = db.users.find((u) => u.id === data.uid);
  if (!user) return null;
  await ensureUserDirs(user);
  return { sid, user: userRuntime(user), expiresAt: Number(data.exp) };
}

async function ensureUserDirs(user) {
  const runtime = userRuntime(user);
  await fsp.mkdir(runtime.novelsRoot, { recursive: true });
  return runtime;
}

export async function hasUsers() {
  const db = await readDb();
  return db.users.length > 0;
}

export async function createFirstUser({ username, password }) {
  const db = await readDb();
  if (db.users.length > 0) throw new Error('系统已完成初始化，请直接登录');
  const clean = normalizeUsername(username);
  const { salt, hash, iterations, digest } = hashPassword(password);
  const user = {
    id: userIdFromUsername(clean),
    username: clean,
    role: 'admin',
    salt,
    passwordHash: hash,
    iterations,
    digest,
    createdAt: nowIso(),
  };
  db.users.push(user);
  await writeDb(db);
  await ensureUserDirs(user);
  return user;
}

export async function authenticateUser({ username, password }) {
  const clean = String(username || '').trim();
  const db = await readDb();
  const user = db.users.find((u) => u.username === clean || u.id === clean.toLowerCase());
  if (!user || !verifyPassword(password, user)) throw new Error('用户名或密码错误');
  await ensureUserDirs(user);
  return user;
}

export async function sessionStatus(req) {
  if (process.env.AUTH_DISABLED === '1') {
    return {
      authenticated: true,
      setupRequired: false,
      user: { id: 'local', username: 'local', role: 'admin' },
    };
  }
  const setupRequired = !(await hasUsers());
  const session = await getSession(req);
  return {
    authenticated: !!session,
    setupRequired,
    user: session ? userPublic(session.user) : null,
  };
}

export function attachAuthRoutes(app) {
  app.get('/api/auth/session', async (req, res) => {
    try {
      res.json(await sessionStatus(req));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post('/api/auth/setup', async (req, res) => {
    try {
      const user = await createFirstUser(req.body || {});
      const sid = await createSession(user);
      setSessionCookie(res, sid);
      res.json({ ok: true, user: userPublic(user) });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const user = await authenticateUser(req.body || {});
      const sid = await createSession(user);
      setSessionCookie(res, sid);
      res.json({ ok: true, user: userPublic(user) });
    } catch (e) {
      res.status(401).json({ error: String(e.message || e) });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });
}

export function requireAuth(req, res, next) {
  if (process.env.AUTH_DISABLED === '1') {
    const user = {
      id: 'local',
      username: 'local',
      role: 'admin',
      root: DATA_ROOT,
      novelsRoot: path.join(ROOT, 'novels'),
      configPath: path.join(DATA_ROOT, 'llm-config.json'),
    };
    return runWithUser(user, next);
  }

  getSession(req)
    .then((session) => {
      if (!session) {
        return res.status(401).json({ error: '未登录', code: 'UNAUTHENTICATED' });
      }
      return runWithUser(session.user, next);
    })
    .catch((e) => res.status(500).json({ error: String(e.message || e) }));
}

export function getAuthStorageInfo() {
  return {
    usersPath: fs.existsSync(USERS_PATH) ? path.relative(ROOT, USERS_PATH).replace(/\\/g, '/') : null,
    cookieName: COOKIE_NAME,
  };
}
