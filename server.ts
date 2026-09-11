import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.set("trust proxy", 1);

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    })
  : null;

// Normalise un numéro de téléphone (retire espaces/tirets/parenthèses) pour qu'il soit
// TOUJOURS identique, qu'il soit saisi avec espaces ou copié-collé depuis un endroit différent.
function normalizePhone(raw: string): string {
  return String(raw || "").replace(/[\s\-().]/g, "").trim();
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

const userAccounts = new Map<string, { passwordHash: string; salt: string; createdAt: number; isAdmin: boolean }>();
const sessions = new Map<string, { phone: string; createdAt: number }>();
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

function createAccount(phone: string, password: string, isAdmin = false): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const existing = userAccounts.get(phone);
  userAccounts.set(phone, { passwordHash, salt, createdAt: existing?.createdAt ?? Date.now(), isAdmin });
  persistAccount(phone).catch(() => {});
}

function verifyAccountPassword(phone: string, password: string): boolean {
  const acc = userAccounts.get(phone);
  if (!acc) return false;
  return hashPassword(password, acc.salt) === acc.passwordHash;
}

function createSession(phone: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { phone, createdAt: Date.now() });
  persistSession(token).catch(() => {});
  return token;
}

async function persistAccount(phone: string): Promise<void> {
  if (!pool) return;
  const acc = userAccounts.get(phone);
  if (!acc) return;
  try {
    await pool.query(
      `INSERT INTO accounts (phone, password_hash, salt, created_at, is_admin) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (phone) DO UPDATE SET password_hash=$2, salt=$3, is_admin=$5`,
      [phone, acc.passwordHash, acc.salt, acc.createdAt, acc.isAdmin]
    );
  } catch (err: any) {
    console.error("[DB] Échec sauvegarde compte:", err.message);
  }
}

async function persistSession(token: string): Promise<void> {
  if (!pool) return;
  const s = sessions.get(token);
  if (!s) return;
  try {
    await pool.query(
      `INSERT INTO sessions (token, phone, created_at) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING`,
      [token, s.phone, s.createdAt]
    );
  } catch (err: any) {
    console.error("[DB] Échec sauvegarde session:", err.message);
  }
}

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ success: false, message: "Session invalide ou expirée. Veuillez vous reconnecter." });
  }
  req.session = sessions.get(token);
  next();
}

function requireAdminAuth(req: any, res: any, next: any) {
  const code = req.headers["x-admin-code"];
  if (code && code === process.env.ADMIN_SECRET) return next();
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const session = token ? sessions.get(token) : null;
  if (session && userAccounts.get(session.phone)?.isAdmin) return next();
  return res.status(401).json({ success: false, message: "Accès admin refusé." });
}

async function initDatabase(): Promise<void> {
  if (!pool) {
    console.warn("[DB] DATABASE_URL non configuré.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      phone TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  const accountsRes = await pool.query("SELECT * FROM accounts");
  for (const row of accountsRes.rows) {
    const cleanPhone = normalizePhone(row.phone);
    userAccounts.set(cleanPhone, {
      passwordHash: row.password_hash, salt: row.salt,
      createdAt: Number(row.created_at), isAdmin: row.is_admin,
    });
  }
  const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const sessionsRes = await pool.query("SELECT * FROM sessions");
  let loadedSessions = 0;
  for (const row of sessionsRes.rows) {
    if (Date.now() - Number(row.created_at) <= SESSION_MAX_AGE_MS) {
      sessions.set(row.token, { phone: normalizePhone(row.phone), createdAt: Number(row.created_at) });
      loadedSessions++;
    }
  }
  console.log(`[DB] ${accountsRes.rows.length} compte(s), ${loadedSessions} session(s) rechargé(s).`);

  if (process.env.ADMIN_SEED_PHONE && process.env.ADMIN_SEED_PASSWORD) {
    const seedPhone = normalizePhone(process.env.ADMIN_SEED_PHONE);
    if (!userAccounts.has(seedPhone)) {
      createAccount(seedPhone, process.env.ADMIN_SEED_PASSWORD, true);
      console.log(`[Démarrage] Compte admin créé pour ${seedPhone}.`);
    }
  }
}

app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "juriscoach" });
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { phoneNumber, countryCode, password } = req.body;
  if (!phoneNumber || !password) {
    return res.status(400).json({ success: false, message: "Numéro et mot de passe requis." });
  }
  const fullPhone = normalizePhone(`${countryCode || "+225"}${phoneNumber}`);
  const localOnly = normalizePhone(phoneNumber);

  const attempts = loginAttempts.get(fullPhone);
  if (attempts && attempts.count >= 8 && Date.now() - attempts.firstAttempt < 15 * 60 * 1000) {
    return res.status(429).json({ success: false, message: "Trop de tentatives. Réessayez dans 15 minutes." });
  }

  let matchedPhone: string | null = null;
  if (verifyAccountPassword(fullPhone, password)) {
    matchedPhone = fullPhone;
  } else if (localOnly !== fullPhone && verifyAccountPassword(localOnly, password)) {
    matchedPhone = localOnly;
  }

  if (!matchedPhone) {
    const a = loginAttempts.get(fullPhone) || { count: 0, firstAttempt: Date.now() };
    a.count++;
    loginAttempts.set(fullPhone, a);
    return res.status(401).json({ success: false, message: "Numéro ou mot de passe incorrect." });
  }
  loginAttempts.delete(fullPhone);

  const isAdminAccount = userAccounts.get(matchedPhone)?.isAdmin === true;
  if (!isAdminAccount) {
    for (const [oldToken, s] of sessions) {
      if (s.phone === matchedPhone) sessions.delete(oldToken);
    }
  }
  const token = createSession(matchedPhone);
  res.json({ success: true, sessionToken: token, isAdmin: isAdminAccount });
});

app.get("/api/user/status", requireAuth, (req: any, res) => {
  const acc = userAccounts.get(req.session.phone);
  res.json({ success: true, phone: req.session.phone, isAdmin: acc?.isAdmin === true });
});

app.post("/api/admin/create-account", requireAdminAuth, (req, res) => {
  const { password, isAdmin } = req.body;
  const phone = normalizePhone(req.body.phone);
  if (!phone || !password) {
    return res.status(400).json({ success: false, message: "Numéro et mot de passe requis." });
  }
  createAccount(phone, password, isAdmin === true);
  res.json({ success: true, normalizedPhone: phone });
});

app.get("/api/admin/accounts", requireAdminAuth, (req, res) => {
  const accounts = Array.from(userAccounts.entries()).map(([phone, acc]) => ({
    phone, createdAt: acc.createdAt, isAdmin: acc.isAdmin,
  }));
  res.json({ success: true, accounts });
});

app.post("/api/admin/accounts/:phone/reset-password", requireAdminAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  if (!userAccounts.has(phone)) return res.status(404).json({ success: false, message: "Compte introuvable." });
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let newPassword = "";
  for (let i = 0; i < 8; i++) newPassword += chars[Math.floor(Math.random() * chars.length)];
  const acc = userAccounts.get(phone)!;
  createAccount(phone, newPassword, acc.isAdmin);
  for (const [token, s] of sessions) {
    if (s.phone === phone) sessions.delete(token);
  }
  res.json({ success: true, newPassword });
});

async function startServer() {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ success: false, message: "Route inconnue." });
    res.sendFile(path.join(distPath, "index.html"));
  });

  // Le serveur écoute immédiatement, sans attendre la base — évite tout blocage si la base
  // (plan gratuit) est endormie et met du temps à répondre.
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`JurisCoach running on port ${PORT}`);
  });

  try {
    await initDatabase();
  } catch (err: any) {
    console.error("[DB] Échec du chargement initial:", err.message);
  }
}

startServer();
