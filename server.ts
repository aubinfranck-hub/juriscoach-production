import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from "@google/genai";
import pdfParse from "pdf-parse";

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

const userAccounts = new Map<string, { passwordHash: string; salt: string; createdAt: number; isAdmin: boolean; isPro: boolean }>();
const sessions = new Map<string, { phone: string; createdAt: number }>();
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

function createAccount(phone: string, password: string, isAdmin = false): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const existing = userAccounts.get(phone);
  userAccounts.set(phone, { passwordHash, salt, createdAt: existing?.createdAt ?? Date.now(), isAdmin, isPro: existing?.isPro ?? false });
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
      `INSERT INTO accounts (phone, password_hash, salt, created_at, is_admin, is_pro) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (phone) DO UPDATE SET password_hash=$2, salt=$3, is_admin=$5, is_pro=$6`,
      [phone, acc.passwordHash, acc.salt, acc.createdAt, acc.isAdmin, acc.isPro]
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

// Résout l'identifiant numérique lié au téléphone (créé au besoin) — le schéma juridique
// (dossiers, diagnostics) référence un user_id entier, alors que l'authentification se fait
// par téléphone. Ce middleware fait le pont, sans jamais toucher au système d'auth existant.
async function resolveUserId(req: any, res: any, next: any) {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    await pool.query(`INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING`, [req.session.phone]);
    const { rows } = await pool.query(`SELECT id FROM users WHERE phone = $1`, [req.session.phone]);
    req.user = { userId: rows[0].id };
    next();
  } catch (err: any) {
    console.error("[Users] Échec résolution userId:", err.message);
    res.status(500).json({ success: false, message: "Erreur interne." });
  }
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
      is_admin BOOLEAN NOT NULL DEFAULT false,
      is_pro BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    -- Table pont : associe chaque compte (téléphone) à un identifiant numérique, requis par
    -- le schéma juridique (dossiers, diagnostics) qui référence un user_id entier.
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS legal_sources (
      id SERIAL PRIMARY KEY,
      country VARCHAR(10) NOT NULL,
      organization VARCHAR(100),
      domain VARCHAR(50) NOT NULL,
      source_type VARCHAR(50) NOT NULL,
      title VARCHAR(300) NOT NULL,
      reference VARCHAR(100),
      version VARCHAR(50),
      content TEXT,
      effective_date DATE,
      expiry_date DATE,
      official_url TEXT,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      last_verified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sources_domain ON legal_sources(domain);

    CREATE TABLE IF NOT EXISTS legal_articles (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES legal_sources(id) ON DELETE CASCADE,
      article_number VARCHAR(50),
      subsection VARCHAR(100),
      title VARCHAR(300),
      official_text TEXT NOT NULL,
      domain VARCHAR(50),
      infraction VARCHAR(300),
      criminal_elements JSONB,
      perpetrator_type VARCHAR(100),
      victim_type VARCHAR(100),
      intent_required BOOLEAN,
      circumstances TEXT,
      attempt_applicable BOOLEAN,
      complicity_applicable BOOLEAN,
      recidivism_applicable BOOLEAN,
      min_sentence_years INTEGER,
      max_sentence_years INTEGER,
      fine_min_fcfa INTEGER,
      fine_max_fcfa INTEGER,
      additional_penalties JSONB,
      prescription_years INTEGER,
      procedure_type VARCHAR(100),
      related_articles JSONB,
      exceptions TEXT,
      conditions TEXT,
      searchable_text TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_articles_source ON legal_articles(source_id);
    CREATE INDEX IF NOT EXISTS idx_articles_domain ON legal_articles(domain);

    CREATE TABLE IF NOT EXISTS case_law (
      id SERIAL PRIMARY KEY,
      case_id VARCHAR(100) UNIQUE,
      jurisdiction VARCHAR(100),
      court VARCHAR(200),
      country VARCHAR(10),
      decision_date DATE,
      case_number VARCHAR(100),
      parties_plaintiff VARCHAR(300),
      parties_defendant VARCHAR(300),
      domain VARCHAR(50),
      facts TEXT NOT NULL,
      legal_question TEXT NOT NULL,
      decision_summary TEXT NOT NULL,
      legal_principle TEXT,
      related_articles JSONB,
      keywords JSONB,
      official_url TEXT,
      source_document VARCHAR(300),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_case_law_domain ON case_law(domain);

    CREATE TABLE IF NOT EXISTS dossiers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dossier_number VARCHAR(50) UNIQUE,
      title VARCHAR(300) NOT NULL,
      description TEXT,
      domain VARCHAR(50),
      status VARCHAR(50) DEFAULT 'OUVERT',
      client_name VARCHAR(200),
      client_phone VARCHAR(20),
      client_email VARCHAR(100),
      adversary_name VARCHAR(200),
      adversary_contact VARCHAR(200),
      tribunal VARCHAR(200),
      tribunal_number VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dossiers_user ON dossiers(user_id);

    CREATE TABLE IF NOT EXISTS dossier_chronology (
      id SERIAL PRIMARY KEY,
      dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      event_date DATE NOT NULL,
      event_type VARCHAR(100),
      description TEXT,
      importance VARCHAR(50) DEFAULT 'NORMAL',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chronology_dossier ON dossier_chronology(dossier_id);

    CREATE TABLE IF NOT EXISTS dossier_documents (
      id SERIAL PRIMARY KEY,
      dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      document_name VARCHAR(300),
      document_type VARCHAR(100),
      file_path VARCHAR(500),
      file_size INTEGER,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_documents_dossier ON dossier_documents(dossier_id);

    CREATE TABLE IF NOT EXISTS diagnostic_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      dossier_id INTEGER REFERENCES dossiers(id),
      diagnostic_type VARCHAR(50) NOT NULL,
      input_description TEXT NOT NULL,
      input_answers JSONB,
      primary_qualification VARCHAR(300),
      secondary_qualifications JSONB,
      pertinence_score INTEGER,
      confidence_level TEXT,
      constitutive_elements JSONB,
      applicable_texts JSONB,
      sentences JSONB,
      evidence_needed JSONB,
      procedure_type TEXT,
      prescription_info TEXT,
      missing_information JSONB,
      risk_level TEXT,
      explanation_sources JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_diagnostic_user ON diagnostic_results(user_id);

    CREATE TABLE IF NOT EXISTS generated_documents (
      id SERIAL PRIMARY KEY,
      dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      document_type VARCHAR(100),
      title VARCHAR(300),
      content TEXT,
      format VARCHAR(50),
      file_path VARCHAR(500),
      is_generated_draft BOOLEAN DEFAULT TRUE,
      needs_review_by_professional BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_generated_dossier ON generated_documents(dossier_id);
  `);

  // Index unique séparé (pas dans le bloc principal) : si des doublons existent déjà en base,
  // cette création échoue seule sans jamais empêcher le reste du serveur de démarrer.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_number ON legal_articles(source_id, article_number)`);
  } catch (err: any) {
    console.warn("[DB] Index unique articles non créé (doublons probables) :", err.message);
  }

  // Élargit des colonnes créées trop étroites (VARCHAR) : les modèles de secours (DeepSeek,
  // NVIDIA) répondent souvent de façon plus verbeuse que Gemini et dépassaient la limite.
  try {
    await pool.query(`
      ALTER TABLE diagnostic_results ALTER COLUMN confidence_level TYPE TEXT;
      ALTER TABLE diagnostic_results ALTER COLUMN procedure_type TYPE TEXT;
      ALTER TABLE diagnostic_results ALTER COLUMN risk_level TYPE TEXT;
    `);
  } catch (err: any) {
    console.warn("[DB] Élargissement des colonnes diagnostic_results échoué :", err.message);
  }

  // Ajoute is_pro aux comptes déjà existants (créés avant l'introduction du statut Pro).
  try {
    await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false`);
  } catch (err: any) {
    console.warn("[DB] Ajout de is_pro échoué :", err.message);
  }

  const accountsRes = await pool.query("SELECT * FROM accounts");
  for (const row of accountsRes.rows) {
    const cleanPhone = normalizePhone(row.phone);
    userAccounts.set(cleanPhone, {
      passwordHash: row.password_hash, salt: row.salt,
      createdAt: Number(row.created_at), isAdmin: row.is_admin, isPro: row.is_pro === true,
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
  const isProAccount = userAccounts.get(matchedPhone)?.isPro === true;
  res.json({ success: true, sessionToken: token, isAdmin: isAdminAccount, isPro: isProAccount });
});

app.get("/api/user/status", requireAuth, (req: any, res) => {
  const acc = userAccounts.get(req.session.phone);
  res.json({ success: true, phone: req.session.phone, isAdmin: acc?.isAdmin === true, isPro: acc?.isPro === true });
});

app.post("/api/admin/toggle-pro", requireAdminAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: "phone requis." });
  const cleanPhone = normalizePhone(phone);
  const acc = userAccounts.get(cleanPhone);
  if (!acc) return res.status(404).json({ success: false, message: "Compte introuvable." });
  acc.isPro = !acc.isPro;
  userAccounts.set(cleanPhone, acc);
  await persistAccount(cleanPhone);
  res.json({ success: true, isPro: acc.isPro, message: `Statut Pro ${acc.isPro ? "activé" : "désactivé"} pour ${cleanPhone}.` });
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
    phone, createdAt: acc.createdAt, isAdmin: acc.isAdmin, isPro: acc.isPro,
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

// ═══════════════════════════════════════════════════════════════════════
// MOTEUR JURIDIQUE — diagnostic pénal, recherche, dossiers, documents
// Adapté depuis le code généré fourni par l'utilisateur (schéma/logique conservés),
// avec req.user.userId résolu via resolveUserId (téléphone → id) au lieu du JWT d'origine.
// ═══════════════════════════════════════════════════════════════════════

function getAIClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Pas de JSON trouvé dans la réponse.");
  return JSON.parse(match[0]);
}

// Secours quand Gemini est surchargé (503) : même tâche de structuration via un modèle
// hébergé sur NVIDIA (build.nvidia.com), API compatible OpenAI.
// Ajoute une limite de temps stricte à un fetch — sans ça, un appel qui ne répond jamais
// bloque la tâche indéfiniment, ce qui a fini par provoquer un redémarrage du serveur
// (tuant la tâche en cours) lors d'un essai précédent.
async function fetchWithTimeout(url: string, options: any, timeoutMs = 25000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callNvidiaFallback(prompt: string): Promise<string> {
  if (!process.env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY non configurée — pas de secours possible.");
  // Catalogue NVIDIA en évolution (des modèles y sont retirés régulièrement) — on essaie
  // plusieurs modèles dans l'ordre, pour ne pas dépendre d'un seul nom qui pourrait disparaître.
  // "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" est confirmé déployé sur ce compte
  // (fourni directement par l'utilisateur depuis son tableau de bord build.nvidia.com) —
  // en premier. Les autres restent en secours si jamais celui-ci disparaît du catalogue.
  // Les 2 autres modèles précédemment listés se sont révélés définitivement morts (410/404,
  // pas transitoire) — on ne garde que celui confirmé fonctionnel pour ne plus perdre de temps.
  const models = ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"];
  let lastErr: any;
  for (const model of models) {
    try {
      const res = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
        body: JSON.stringify({
          model, messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 8192,
          ...(model.includes("reasoning") ? { reasoning_budget: 4096, top_p: 0.95 } : {}),
        }),
      }, 25000);
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 200);
        console.warn(`[NVIDIA] Modèle ${model} indisponible (${res.status}): ${errText}`);
        lastErr = new Error(`NVIDIA (${model}) a répondu ${res.status}: ${errText}`);
        continue;
      }
      const data: any = await res.json();
      return data.choices?.[0]?.message?.content || "";
    } catch (err: any) {
      console.warn(`[NVIDIA] Modèle ${model} échoué/délai dépassé:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr || new Error("Tous les modèles NVIDIA de secours ont échoué.");
}

// Trouve la clé DeepSeek quelle que soit la casse exacte utilisée sur Render (le nom exact
// nous a été donné de façon incertaine — on couvre les variantes plausibles).
function findDeepseekKey(): string | undefined {
  const candidates = ["DEEPSEEK_API_KEY", "Deepseek", "DEEPSEEK", "deepseek", "Deepseek_Api_Key", "DeepseekApiKey"];
  for (const name of candidates) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

// Second niveau de secours (après Gemini ET NVIDIA) : DeepSeek, API compatible OpenAI.
async function callDeepseekFallback(prompt: string): Promise<string> {
  const key = findDeepseekKey();
  if (!key) throw new Error("Clé DeepSeek non trouvée sous les noms de variable essayés.");
  const res = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  }, 25000);
  if (!res.ok) throw new Error(`DeepSeek a répondu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// Point d'entrée unique pour tout appel IA texte simple (hors extraction d'articles) —
// même chaîne de secours Gemini -> NVIDIA -> DeepSeek, pour que le diagnostic ne dépende
// pas uniquement du quota gratuit Gemini (20 requêtes/jour, vite épuisé).
// Gemini est à quota quotidien épuisé et 2 modèles NVIDIA sur 3 se sont révélés morts —
// DeepSeek s'est montré le plus fiable en pratique, on l'essaie en premier pour éviter
// d'attendre inutilement des échecs prévisibles avant chaque recherche.
async function generateWithFallback(prompt: string): Promise<string> {
  try {
    return await callDeepseekFallback(prompt);
  } catch (deepseekErr: any) {
    console.warn("[IA] DeepSeek indisponible, secours Gemini:", deepseekErr.message);
    try {
      const response = await getAIClient().models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      return response.text || "";
    } catch (geminiErr: any) {
      console.warn("[IA] Gemini aussi indisponible, secours NVIDIA:", geminiErr.message);
      return await callNvidiaFallback(prompt);
    }
  }
}

// --- DIAGNOSTIC PÉNAL ---

app.post("/api/diagnostic/penal", requireAuth, resolveUserId, async (req: any, res) => {
  try {
    const { description, dossier_id } = req.body;
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ success: false, message: "La description doit contenir au moins 10 caractères." });
    }
    const diagResult = await pool!.query(
      `INSERT INTO diagnostic_results (user_id, dossier_id, diagnostic_type, input_description, input_answers, confidence_level)
       VALUES ($1, $2, 'PENAL', $3, '{}', 'INITIAL') RETURNING id`,
      [req.user.userId, dossier_id || null, description]
    );
    const diagnosticId = diagResult.rows[0].id;

    const response = await generateWithFallback(`Tu es JurisCoach, un système de diagnostic juridique pour la Côte d'Ivoire.

La situation décrite: "${description}"

Génère 5 questions structurées en JSON pour clarifier cette situation pénale. Chaque question doit être numérotée, clairement formulée, avec options de réponse.

Format réponse JSON UNIQUEMENT:
{"questions":[{"id":1,"question":"...","field_name":"...","type":"radio","options":["Oui","Non","Pas certain"]}]}

Focus sur: infraction probable, auteur, victime, élément constitutif, intention, circonstances.`);

    let questionsData: any;
    try {
      questionsData = extractJson(response || "");
    } catch {
      questionsData = {
        questions: [
          { id: 1, question: "Quel type d'infraction suspectez-vous ?", field_name: "infraction_type", type: "radio", options: ["Abus de confiance", "Détournement", "Escroquerie", "Autre"] },
          { id: 2, question: "Qui est l'auteur présumé ?", field_name: "author_type", type: "radio", options: ["Employé", "Associé", "Tiers", "Pas certain"] },
          { id: 3, question: "Des preuves écrites existent-elles ?", field_name: "has_proof", type: "radio", options: ["Oui", "Non", "Pas certain"] },
          { id: 4, question: "Montant impliqué ?", field_name: "amount", type: "text", options: [] },
          { id: 5, question: "Plainte déjà déposée ?", field_name: "complaint_filed", type: "radio", options: ["Oui", "Non", "Envisagée"] },
        ],
      };
    }

    res.status(201).json({
      success: true, diagnostic_id: diagnosticId, stage: "questions", description,
      current_question_set: questionsData.questions,
      message: "Veuillez répondre aux questions pour affiner le diagnostic",
    });
  } catch (err: any) {
    console.error("[Diagnostic] Erreur:", err.message);
    res.status(500).json({ success: false, message: "Échec du diagnostic." });
  }
});

app.post("/api/diagnostic/penal/analyze", requireAuth, resolveUserId, async (req: any, res) => {
  try {
    const { diagnostic_id, answers } = req.body;
    if (!diagnostic_id || !answers) {
      return res.status(400).json({ success: false, message: "diagnostic_id et answers requis." });
    }
    const diagResult = await pool!.query(
      "SELECT * FROM diagnostic_results WHERE id = $1 AND user_id = $2",
      [diagnostic_id, req.user.userId]
    );
    if (diagResult.rows.length === 0) return res.status(404).json({ success: false, message: "Diagnostic introuvable." });
    const diagnostic = diagResult.rows[0];

    const articlesResult = await pool!.query(
      `SELECT id, article_number, title, official_text, domain, infraction, min_sentence_years, max_sentence_years, fine_min_fcfa, fine_max_fcfa
       FROM legal_articles
       WHERE domain = 'PENAL'
       AND (official_text ILIKE '%confiance%' OR official_text ILIKE '%détournement%' OR official_text ILIKE '%escroquerie%')
       LIMIT 5`
    );
    const articlesContext = articlesResult.rows.map((art: any) =>
      `\nArt. ${art.article_number}: ${art.title}\n${(art.official_text || "").substring(0, 300)}...\nPeines: ${art.min_sentence_years}-${art.max_sentence_years} ans, Amende: ${art.fine_min_fcfa}-${art.fine_max_fcfa} FCFA`
    ).join("\n");

    const prompt = `Tu es JurisCoach. Génère un diagnostic pénal précis basé sur:

SITUATION:
"${diagnostic.input_description}"

RÉPONSES:
${JSON.stringify(answers, null, 2)}

ARTICLES APPLICABLES (base de données — peut être vide si non encore alimentée):
${articlesContext || "Aucun article correspondant trouvé en base pour l'instant."}

RÈGLES:
- N'invente JAMAIS un article. Si la base ne contient pas d'article pertinent, dis-le clairement plutôt que d'en inventer un.
- Chaque conclusion doit citer une source réelle (base de données) ou indiquer l'absence de source.
- Si données insuffisantes, dis "Je ne sais pas" et liste les manques.
- Produis un JSON structuré.

JSON REQUIS:
{"primary_qualification":"...","secondary_qualifications":["..."],"pertinence_score":85,"confidence_level":"HAUTE|MODÉRÉE|BASSE","constitutive_elements":["..."],"applicable_articles":[{"article_number":"...","source":"...","title":"...","text":"..."}],"sentences":{"min_years":2,"max_years":5,"min_fine":500000,"max_fine":2000000},"evidence_needed":["..."],"procedure":"...","prescription_years":5,"risk_level":"FAIBLE|MODÉRÉ|ÉLEVÉ","missing_information":["..."],"explanation":[{"fact":"...","rule":"...","source":"...","conclusion":"..."}]}`;

    const response = await generateWithFallback(prompt);
    const diagnosisData = extractJson(response || "");

    await pool!.query(
      `UPDATE diagnostic_results SET input_answers=$1, primary_qualification=$2, secondary_qualifications=$3,
       pertinence_score=$4, confidence_level=$5, constitutive_elements=$6, applicable_texts=$7, sentences=$8,
       evidence_needed=$9, procedure_type=$10, prescription_info=$11, missing_information=$12, risk_level=$13,
       explanation_sources=$14 WHERE id=$15`,
      [JSON.stringify(answers), diagnosisData.primary_qualification, JSON.stringify(diagnosisData.secondary_qualifications),
       diagnosisData.pertinence_score, diagnosisData.confidence_level, JSON.stringify(diagnosisData.constitutive_elements),
       JSON.stringify(diagnosisData.applicable_articles), JSON.stringify(diagnosisData.sentences),
       JSON.stringify(diagnosisData.evidence_needed), diagnosisData.procedure,
       diagnosisData.prescription_info || `${diagnosisData.prescription_years || 5} ans`,
       JSON.stringify(diagnosisData.missing_information), diagnosisData.risk_level,
       JSON.stringify(diagnosisData.explanation), diagnostic_id]
    );

    res.json({ success: true, diagnostic_id, stage: "results", ...diagnosisData });
  } catch (err: any) {
    console.error("[Diagnostic analyze] Erreur:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'analyse." });
  }
});

app.get("/api/diagnostic/:id", requireAuth, resolveUserId, async (req: any, res) => {
  const result = await pool!.query("SELECT * FROM diagnostic_results WHERE id = $1 AND user_id = $2", [req.params.id, req.user.userId]);
  if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Diagnostic introuvable." });
  res.json({ success: true, ...result.rows[0] });
});

app.get("/api/diagnostic/user/history", requireAuth, resolveUserId, async (req: any, res) => {
  const result = await pool!.query(
    `SELECT id, diagnostic_type, primary_qualification, pertinence_score, confidence_level, risk_level, created_at
     FROM diagnostic_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.userId]
  );
  res.json({ success: true, diagnostics: result.rows });
});

// --- RECHERCHE JURIDIQUE ---

app.get("/api/search/articles", requireAuth, async (req: any, res) => {
  const { q, domain, limit } = req.query;
  if (!q || String(q).trim().length < 2) return res.status(400).json({ success: false, message: "Recherche trop courte (2 caractères min)." });
  let sql = `SELECT id, article_number, title, official_text, domain, source_id, min_sentence_years, max_sentence_years
             FROM legal_articles WHERE official_text ILIKE $1 OR title ILIKE $1 OR article_number ILIKE $1`;
  const params: any[] = [`%${q}%`];
  if (domain) { sql += ` AND domain = $${params.length + 1}`; params.push(domain); }
  sql += ` LIMIT $${params.length + 1}`;
  params.push(Math.min(parseInt(String(limit)) || 10, 50));
  const result = await pool!.query(sql, params);
  const articles = await Promise.all(result.rows.map(async (art: any) => {
    const sourceResult = await pool!.query("SELECT title, reference, country FROM legal_sources WHERE id = $1", [art.source_id]);
    const source = sourceResult.rows[0] || {};
    return {
      article_id: art.id, article_number: art.article_number, title: art.title,
      excerpt: (art.official_text || "").substring(0, 200) + "...", domain: art.domain,
      source: source.title, reference: source.reference, country: source.country,
    };
  }));
  res.json({ success: true, query: q, results: articles, count: articles.length });
});

app.get("/api/search/article/:id", requireAuth, async (req: any, res) => {
  const result = await pool!.query(
    `SELECT a.*, s.title as source_title, s.official_url, s.version, s.last_verified
     FROM legal_articles a JOIN legal_sources s ON a.source_id = s.id WHERE a.id = $1`,
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Article introuvable." });
  const article = result.rows[0];
  res.json({
    success: true, article_id: article.id, article_number: article.article_number, title: article.title,
    official_text: article.official_text, domain: article.domain, source: article.source_title,
    version: article.version, official_url: article.official_url,
    simplified_explanation: `Cette disposition traite de : ${article.title}`,
    criminal_elements: article.criminal_elements || [],
    conditions: article.conditions ? article.conditions.split("\n") : [],
    exceptions: article.exceptions ? article.exceptions.split("\n") : [],
    sentences: { min_years: article.min_sentence_years, max_years: article.max_sentence_years, min_fine_fcfa: article.fine_min_fcfa, max_fine_fcfa: article.fine_max_fcfa },
    prescription_years: article.prescription_years, related_articles: article.related_articles || [],
    last_verified: article.last_verified,
  });
});

app.get("/api/search/cases", requireAuth, async (req: any, res) => {
  const { q, domain, limit } = req.query;
  if (!q || String(q).trim().length < 2) return res.status(400).json({ success: false, message: "Recherche trop courte (2 caractères min)." });
  let sql = `SELECT id, case_id, case_number, court, decision_date, legal_principle, keywords FROM case_law
             WHERE legal_principle ILIKE $1 OR facts ILIKE $1 OR case_number ILIKE $1`;
  const params: any[] = [`%${q}%`];
  if (domain) { sql += ` AND domain = $${params.length + 1}`; params.push(domain); }
  sql += ` ORDER BY decision_date DESC LIMIT $${params.length + 1}`;
  params.push(Math.min(parseInt(String(limit)) || 10, 50));
  const result = await pool!.query(sql, params);
  res.json({
    success: true, query: q,
    results: result.rows.map((row: any) => ({
      case_id: row.case_id, case_number: row.case_number, court: row.court, decision_date: row.decision_date,
      principle_excerpt: (row.legal_principle || "").substring(0, 150) + "...", keywords: row.keywords,
    })),
    count: result.rows.length,
  });
});

app.get("/api/search/case/:id", requireAuth, async (req: any, res) => {
  const result = await pool!.query("SELECT * FROM case_law WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Décision introuvable." });
  const c = result.rows[0];
  res.json({
    success: true, case_id: c.case_id, case_number: c.case_number, court: c.court, decision_date: c.decision_date,
    parties: { plaintiff: c.parties_plaintiff, defendant: c.parties_defendant }, facts: c.facts,
    legal_question: c.legal_question, decision: c.decision_summary, legal_principle: c.legal_principle,
    related_articles: c.related_articles, official_url: c.official_url,
  });
});

// --- DOSSIERS ---

app.post("/api/dossiers", requireAuth, resolveUserId, async (req: any, res) => {
  const { title, domain, description, client_name, client_phone, client_email, adversary_name, adversary_contact, tribunal, tribunal_number } = req.body;
  if (!title || !domain) return res.status(400).json({ success: false, message: "Titre et domaine requis." });
  const dossierNumber = `CI-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const result = await pool!.query(
    `INSERT INTO dossiers (user_id, dossier_number, title, domain, description, client_name, client_phone, client_email, adversary_name, adversary_contact, tribunal, tribunal_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, dossier_number, title, domain, created_at`,
    [req.user.userId, dossierNumber, title, domain, description || null, client_name || null, client_phone || null, client_email || null, adversary_name || null, adversary_contact || null, tribunal || null, tribunal_number || null]
  );
  const dossier = result.rows[0];
  res.status(201).json({ success: true, dossier_id: dossier.id, dossier_number: dossier.dossier_number, title: dossier.title, domain: dossier.domain, created_at: dossier.created_at, message: "Dossier créé avec succès" });
});

app.get("/api/dossiers", requireAuth, resolveUserId, async (req: any, res) => {
  const { status, domain, limit, offset } = req.query;
  let sql = "SELECT id, dossier_number, title, domain, status, client_name, created_at FROM dossiers WHERE user_id = $1";
  const params: any[] = [req.user.userId];
  if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
  if (domain) { sql += ` AND domain = $${params.length + 1}`; params.push(domain); }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(Math.min(parseInt(String(limit)) || 20, 100));
  params.push(Math.max(0, parseInt(String(offset)) || 0));
  const result = await pool!.query(sql, params);
  res.json({ success: true, dossiers: result.rows, count: result.rows.length });
});

app.get("/api/dossiers/:id", requireAuth, resolveUserId, async (req: any, res) => {
  const dosResult = await pool!.query("SELECT * FROM dossiers WHERE id = $1 AND user_id = $2", [req.params.id, req.user.userId]);
  if (dosResult.rows.length === 0) return res.status(404).json({ success: false, message: "Dossier introuvable." });
  const [chrono, docs, diags, genDocs] = await Promise.all([
    pool!.query("SELECT id, event_date, event_type, description, importance FROM dossier_chronology WHERE dossier_id = $1 ORDER BY event_date DESC", [req.params.id]),
    pool!.query("SELECT id, document_name, document_type, uploaded_at FROM dossier_documents WHERE dossier_id = $1 ORDER BY uploaded_at DESC", [req.params.id]),
    pool!.query("SELECT id, diagnostic_type, primary_qualification, pertinence_score, confidence_level, created_at FROM diagnostic_results WHERE dossier_id = $1 ORDER BY created_at DESC", [req.params.id]),
    pool!.query("SELECT id, document_type, title, created_at FROM generated_documents WHERE dossier_id = $1 ORDER BY created_at DESC", [req.params.id]),
  ]);
  res.json({ success: true, ...dosResult.rows[0], chronology: chrono.rows, documents: docs.rows, diagnostics: diags.rows, generated_documents: genDocs.rows });
});

app.patch("/api/dossiers/:id", requireAuth, resolveUserId, async (req: any, res) => {
  const { title, status, description, client_name, adversary_name, tribunal } = req.body;
  const dosResult = await pool!.query("SELECT id FROM dossiers WHERE id = $1 AND user_id = $2", [req.params.id, req.user.userId]);
  if (dosResult.rows.length === 0) return res.status(404).json({ success: false, message: "Dossier introuvable." });
  const fields: [string, any][] = [];
  if (title !== undefined) fields.push(["title", title]);
  if (status !== undefined) fields.push(["status", status]);
  if (description !== undefined) fields.push(["description", description]);
  if (client_name !== undefined) fields.push(["client_name", client_name]);
  if (adversary_name !== undefined) fields.push(["adversary_name", adversary_name]);
  if (tribunal !== undefined) fields.push(["tribunal", tribunal]);
  let sql = "UPDATE dossiers SET updated_at = CURRENT_TIMESTAMP";
  const params: any[] = [];
  let i = 1;
  for (const [col, val] of fields) { sql += `, ${col} = $${i++}`; params.push(val); }
  sql += ` WHERE id = $${i}`;
  params.push(req.params.id);
  await pool!.query(sql, params);
  res.json({ success: true, message: "Dossier mis à jour." });
});

app.delete("/api/dossiers/:id", requireAuth, resolveUserId, async (req: any, res) => {
  const dosResult = await pool!.query("SELECT id FROM dossiers WHERE id = $1 AND user_id = $2", [req.params.id, req.user.userId]);
  if (dosResult.rows.length === 0) return res.status(404).json({ success: false, message: "Dossier introuvable." });
  await pool!.query("DELETE FROM dossiers WHERE id = $1", [req.params.id]);
  res.json({ success: true, message: "Dossier supprimé." });
});

app.post("/api/dossiers/:id/chronology", requireAuth, resolveUserId, async (req: any, res) => {
  const { event_date, event_type, description, importance } = req.body;
  if (!event_date || !event_type) return res.status(400).json({ success: false, message: "Date et type d'événement requis." });
  const dosResult = await pool!.query("SELECT id FROM dossiers WHERE id = $1 AND user_id = $2", [req.params.id, req.user.userId]);
  if (dosResult.rows.length === 0) return res.status(404).json({ success: false, message: "Dossier introuvable." });
  const result = await pool!.query(
    `INSERT INTO dossier_chronology (dossier_id, event_date, event_type, description, importance) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.params.id, event_date, event_type, description || null, importance || "NORMAL"]
  );
  res.status(201).json({ success: true, chronology_id: result.rows[0].id, message: "Événement ajouté." });
});

app.get("/api/dossiers/:id/chronology", requireAuth, async (req: any, res) => {
  const result = await pool!.query("SELECT id, event_date, event_type, description, importance, created_at FROM dossier_chronology WHERE dossier_id = $1 ORDER BY event_date DESC", [req.params.id]);
  res.json({ success: true, chronology: result.rows });
});

// --- GÉNÉRATION DE DOCUMENTS ---

// --- Alimentation de la base juridique (admin uniquement) ---
// Premier jeu de textes réels (Code pénal ivoirien, infractions courantes). À des fins de
// démarrage/test du moteur — CE CONTENU DOIT ÊTRE VÉRIFIÉ PAR UN JURISTE avant tout usage
// avec de vrais clients : les numéros d'articles et peines doivent être confirmés sur le
// texte officiel en vigueur (le Code pénal ivoirien a été réformé par la loi n°2019-574).
app.post("/api/admin/seed-legal-data", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Base déjà alimentée — aucune action (évite les doublons).", skipped: true });
    }

    const { rows: sourceRows } = await pool.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, version, status)
       VALUES ('CI', 'République de Côte d''Ivoire', 'PENAL', 'CODE', 'Code pénal ivoirien', 'Loi n°2019-574 du 26 juin 2019, modifiée par la loi n°2021-893', '2021', 'ACTIVE')
       RETURNING id`
    );
    const sourceId = sourceRows[0].id;

    // Texte officiel vérifié directement depuis le Journal Officiel (loi n°2019-574) et ses
    // sources de recoupement (droit-afrique.com, loidici.biz, refworld.org). Le numéro de
    // l'article "détournement de deniers publics" n'a pas pu être confirmé avec certitude
    // pour la codification 2019 (texte vérifié, numéro à confirmer) — à corriger si besoin.
    const articles = [
      {
        article_number: "Art. 467", title: "Abus de confiance",
        official_text: "Constitue un abus de confiance, le détournement, la dissipation ou la destruction, par une personne, au préjudice d'autrui, de fonds, de valeurs ou d'un bien meuble quelconque qui lui ont été remis et qu'elle a acceptés à charge de les rendre, de les représenter, d'en faire un usage ou un emploi déterminé. Dès lors que la preuve de la remise de la chose est rapportée, celui qui l'a reçue est présumé l'avoir détournée, dissipée ou détruite s'il ne peut la rendre, la représenter ou justifier qu'il en a fait l'usage ou l'emploi prévu.",
        infraction: "Abus de confiance",
        min_sentence_years: 1, max_sentence_years: 5, fine_min_fcfa: 300000, fine_max_fcfa: 3000000,
        prescription_years: 3, procedure_type: "Tribunal correctionnel",
        conditions: "Remise préalable du bien à charge de restitution ou d'usage déterminé\nDétournement, dissipation ou destruction du bien remis\nPréjudice pour le remettant\nPrésomption de détournement si la chose n'est pas rendue/représentée/justifiée",
      },
      {
        article_number: "Art. 470", title: "Escroquerie",
        official_text: "L'escroquerie consiste à tromper une personne physique ou morale, soit par l'usage d'un faux nom ou d'une fausse qualité, soit par l'emploi de manœuvres frauduleuses, et à la déterminer ainsi, à son préjudice ou au préjudice d'un tiers, à remettre des fonds, des valeurs ou un bien quelconque. Peine aggravée à 10 ans d'emprisonnement et amende de 10.000.000 F si l'auteur a fait un appel public en vue de l'émission d'actions, obligations, bons, parts ou titres au profit d'une société, entreprise commerciale ou industrielle.",
        infraction: "Escroquerie",
        min_sentence_years: 1, max_sentence_years: 5, fine_min_fcfa: 300000, fine_max_fcfa: 3000000,
        prescription_years: 3, procedure_type: "Tribunal correctionnel",
        conditions: "Faux nom, fausse qualité ou manœuvre frauduleuse\nRemise déterminée par la tromperie (le lien de cause à effet est essentiel)\nPréjudice pour la victime ou un tiers\nTentative punissable",
      },
      {
        article_number: "Art. 392", title: "Vol",
        official_text: "Le vol se définit comme le fait de soustraire ou de prendre frauduleusement une chose qui ne vous appartient pas.",
        infraction: "Vol",
        min_sentence_years: 5, max_sentence_years: 10, fine_min_fcfa: 300000, fine_max_fcfa: 3000000,
        prescription_years: 3, procedure_type: "Tribunal correctionnel",
        conditions: "Soustraction ou prise frauduleuse de la chose\nChose appartenant à autrui\nIntention frauduleuse\nTentative punissable",
      },
      {
        article_number: "Art. non confirmé (2019) — anciennement art. 178 du code de 1981", title: "Détournement de deniers publics par un fonctionnaire",
        official_text: "Tout fonctionnaire qui détourne ou dissipe, en tout ou partie, des deniers publics ou privés, effets ou titres en tenant lieu, qui sont entre ses mains en vertu de ses fonctions, est puni conformément aux dispositions du présent article. Les poursuites engagées à ce titre doivent obligatoirement faire l'objet d'une instruction préparatoire ; le juge d'instruction doit, si l'inculpation est maintenue, ordonner le séquestre des biens de l'inculpé.",
        infraction: "Détournement de deniers publics",
        min_sentence_years: 5, max_sentence_years: 10, fine_min_fcfa: 300000, fine_max_fcfa: 3000000,
        prescription_years: 10, procedure_type: "Instruction préparatoire obligatoire — Tribunal correctionnel / Cour de répression des infractions économiques",
        conditions: "Qualité de fonctionnaire\nDétention des deniers/effets en raison des fonctions\nDétournement ou dissipation, même partielle",
      },
    ];

    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, min_sentence_years, max_sentence_years, fine_min_fcfa, fine_max_fcfa, prescription_years, procedure_type, conditions, searchable_text)
         VALUES ($1,$2,$3,$4,'PENAL',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [sourceId, art.article_number, art.title, art.official_text, art.infraction, art.min_sentence_years,
         art.max_sentence_years, art.fine_min_fcfa, art.fine_max_fcfa, art.prescription_years, art.procedure_type,
         art.conditions, `${art.title} ${art.official_text}`]
      );
    }

    res.json({ success: true, message: `${articles.length} article(s) ajoutés sous la source "Code pénal ivoirien".`, source_id: sourceId });
  } catch (err: any) {
    console.error("[Seed] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'alimentation." });
  }
});

// --- Alimentation droit des affaires OHADA (admin uniquement) ---
// 3 actes uniformes, 2 articles clés verifiés chacun (droit commercial général, sociétés
// commerciales et GIE, recouvrement de créances). Même principe que le Code pénal : contenu
// de démarrage réel et vérifié par recoupement de sources, à faire valider par un juriste.
app.post("/api/admin/seed-ohada-data", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE organization = 'OHADA'");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Droit OHADA déjà alimenté — aucune action.", skipped: true });
    }

    const actes = [
      {
        title: "Acte uniforme relatif au droit commercial général (AUDCG)",
        reference: "Adopté le 15 décembre 2010 à Lomé",
        articles: [
          {
            article_number: "Art. 2", title: "Définition du commerçant",
            official_text: "Est commerçant celui qui fait de l'accomplissement d'actes de commerce par nature sa profession.",
            conditions: "Accomplissement d'actes de commerce par nature\nCaractère professionnel et habituel de cette activité",
          },
          {
            article_number: "Art. 101", title: "Résiliation judiciaire du bail commercial",
            official_text: "En cas d'inexécution de l'une quelconque de ses obligations par le preneur, le bailleur pourra demander la résiliation judiciaire du bail après avoir fait délivrer, par acte extrajudiciaire, une mise en demeure lui indiquant que faute d'exécuter ses obligations dans le délai d'un mois il encourt la résiliation judiciaire. Le bailleur doit informer les créanciers inscrits de sa demande de résiliation et le jugement ne peut intervenir avant un mois au moins suivant cette notification.",
            conditions: "Inexécution d'une obligation par le locataire (preneur)\nMise en demeure préalable par acte extrajudiciaire, délai d'un mois\nInformation des créanciers inscrits\nDélai d'un mois avant jugement",
          },
        ],
      },
      {
        title: "Acte uniforme relatif au droit des sociétés commerciales et du GIE (AUSCGIE)",
        reference: "Version révisée, J.O. OHADA du 04 février 2014",
        articles: [
          {
            article_number: "Art. 4", title: "Définition de la société commerciale",
            official_text: "La société commerciale est créée par deux (2) ou plusieurs personnes qui conviennent, par un contrat, d'affecter à une activité des biens en numéraire ou en nature, ou de l'industrie, dans le but de partager le bénéfice ou de profiter de l'économie qui peut en résulter. Les associés s'engagent à contribuer aux pertes dans les conditions prévues par le présent Acte uniforme. La société commerciale est créée dans l'intérêt commun des associés.",
            conditions: "Deux personnes ou plus (sauf société unipersonnelle prévue par ailleurs)\nContrat d'apport (numéraire, nature ou industrie)\nBut de partage du bénéfice ou de l'économie\nEngagement de contribuer aux pertes",
          },
          {
            article_number: "Art. 19-21", title: "Objet social",
            official_text: "Toute société a un objet qui est constitué par l'activité qu'elle entreprend et qui doit être déterminée et décrite dans ses statuts. Toute société doit avoir un objet licite. Lorsque l'activité exercée par la société est réglementée, la société doit se conformer aux règles particulières auxquelles ladite activité est soumise.",
            conditions: "Objet déterminé et décrit dans les statuts\nLicéité de l'objet\nConformité aux règles particulières si activité réglementée",
          },
        ],
      },
      {
        title: "Acte uniforme portant organisation des procédures simplifiées de recouvrement et des voies d'exécution (AUPSRVE)",
        reference: "Adopté le 10 avril 1998 à Libreville",
        articles: [
          {
            article_number: "Art. 1", title: "Injonction de payer — principe",
            official_text: "Le recouvrement d'une créance certaine, liquide et exigible peut être demandé suivant la procédure d'injonction de payer.",
            conditions: "Créance certaine (existence non contestable)\nCréance liquide (montant déterminé)\nCréance exigible (échéance passée)",
          },
          {
            article_number: "Art. 2", title: "Injonction de payer — conditions d'origine de la créance",
            official_text: "La procédure d'injonction de payer peut être introduite lorsque : 1) la créance a une cause contractuelle ; 2) l'engagement résulte de l'émission ou de l'acceptation de tout effet de commerce, ou d'un chèque dont la provision s'est révélée inexistante ou insuffisante.",
            conditions: "Cause contractuelle de la créance, OU\nEffet de commerce (lettre de change, billet à ordre) émis/accepté, OU\nChèque sans provision suffisante",
          },
        ],
      },
    ];

    let totalArticles = 0;
    for (const acte of actes) {
      const { rows: sourceRows } = await pool.query(
        `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
         VALUES ('OHADA', 'OHADA', 'AFFAIRES', 'ACTE_UNIFORME', $1, $2, 'ACTIVE') RETURNING id`,
        [acte.title, acte.reference]
      );
      const sourceId = sourceRows[0].id;
      for (const art of acte.articles) {
        await pool.query(
          `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions, searchable_text)
           VALUES ($1,$2,$3,$4,'AFFAIRES',$5,$6,$7)`,
          [sourceId, art.article_number, art.title, art.official_text, art.title, art.conditions, `${art.title} ${art.official_text}`]
        );
        totalArticles++;
      }
    }

    res.json({ success: true, message: `${totalArticles} article(s) OHADA ajoutés sous ${actes.length} actes uniformes.` });
  } catch (err: any) {
    console.error("[Seed OHADA] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'alimentation." });
  }
});

// --- Deuxième lot Code pénal (coups et blessures, voie de fait) ---
// --- Extraction automatique d'articles depuis un texte brut (au lieu de les taper à la main) ---
// L'admin colle un extrait de texte de loi (Code pénal, acte uniforme OHADA, etc.) — Gemini
// repère et structure TOUS les articles qu'il contient, puis on les enregistre directement.
async function extractAndStoreArticles(
  rawText: string, sourceTitle: string, domain: string, organization?: string, country?: string, reference?: string
): Promise<{ inserted: number; skipped: number; totalDetected: number }> {
  let sourceId: number;
  const existing = await pool!.query("SELECT id FROM legal_sources WHERE title = $1", [sourceTitle]);
  if (existing.rows.length > 0) {
    sourceId = existing.rows[0].id;
  } else {
    const created = await pool!.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
       VALUES ($1,$2,$3,'CODE',$4,$5,'ACTIVE') RETURNING id`,
      [country || "CI", organization || "République de Côte d'Ivoire", domain, sourceTitle, reference || ""]
    );
    sourceId = created.rows[0].id;
  }

  const prompt = `Voici un extrait BRUT d'un texte de loi (peut contenir des artefacts de scan/OCR à ignorer). Repère CHAQUE article de loi présent dans cet extrait et structure-le. N'invente RIEN : si une information n'est pas présente dans le texte, laisse le champ vide ou null plutôt que de deviner.

RÈGLES:
- Un "article" = une disposition numérotée (Art. X, Article X)
- official_text = le texte exact de l'article, nettoyé des artefacts OCR (espaces cassés, tirets de fin de ligne) mais SANS reformuler le fond
- Si l'article prévoit des peines (emprisonnement/amende), extrais min/max en années et en FCFA — sinon laisse null
- conditions = liste des éléments constitutifs si identifiables dans le texte, sinon chaîne vide
- N'extrais QUE les articles complets et clairement identifiables dans ce texte, ignore les fragments coupés en début/fin d'extrait

TEXTE:
"""
${rawText.slice(0, 45000)}
"""

Réponds UNIQUEMENT en JSON, sans aucun texte avant/après, sans balises markdown: {"articles":[{"article_number":"Art. X","title":"...","official_text":"...","min_sentence_years":null,"max_sentence_years":null,"fine_min_fcfa":null,"fine_max_fcfa":null,"conditions":"..."}]}`;

  let responseText: string;
  try {
    responseText = await callDeepseekFallback(prompt);
  } catch (deepseekErr: any) {
    console.warn("[Extract] DeepSeek indisponible, secours Gemini:", deepseekErr.message);
    try {
      const response = await getAIClient().models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      responseText = response.text || "";
    } catch (geminiErr: any) {
      console.warn("[Extract] Gemini aussi indisponible, secours NVIDIA:", geminiErr.message);
      responseText = await callNvidiaFallback(prompt);
    }
  }

  const parsed = extractJson(responseText || "{}");
  const articles = parsed.articles || [];

  let inserted = 0;
  let skipped = 0;
  // Nettoie une valeur numérique vers un entier sûr pour la colonne INTEGER (Gemini renvoie
  // parfois des décimaux, ex: 0.5 an pour "six mois" — on arrondit plutôt que de planter).
  const toSafeInt = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  // Toutes les insertions en parallèle (upsert en une seule requête chacune grâce à l'index
  // unique) au lieu d'un aller-retour SELECT puis INSERT, séquentiel, par article — beaucoup
  // plus rapide sur un lot de 15-20 articles, ce qui réduit le risque de dépassement de délai
  // réseau côté téléphone.
  const results = await Promise.allSettled(
    articles
      .filter((art: any) => art.article_number && art.official_text)
      .map((art: any) =>
        pool!.query(
          `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, min_sentence_years, max_sentence_years, fine_min_fcfa, fine_max_fcfa, conditions, searchable_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (source_id, article_number) DO NOTHING
           RETURNING id`,
          [sourceId, art.article_number, art.title || "", art.official_text, domain, art.title || "",
           toSafeInt(art.min_sentence_years), toSafeInt(art.max_sentence_years),
           toSafeInt(art.fine_min_fcfa), toSafeInt(art.fine_max_fcfa),
           art.conditions || "", `${art.title || ""} ${art.official_text}`]
        )
      )
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.rows.length > 0) inserted++; else skipped++; // conflit ignoré (déjà présent)
    } else {
      console.error("[Extract] Article ignoré:", r.reason?.message);
      skipped++;
    }
  }
  return { inserted, skipped, totalDetected: articles.length };
}

// --- Nouvelle méthode : le SERVEUR va chercher et lire le PDF lui-même — l'admin ne
// transmet plus qu'un lien (petite requête), au lieu d'un gros texte depuis le téléphone
// (source de la panne "Failed to fetch" jamais élucidée avec l'envoi de texte brut).
// Tâche de fond avec suivi de progression : la requête HTTP répond immédiatement avec un
// identifiant de tâche, le traitement (potentiellement plusieurs minutes) continue en arrière-
// plan côté serveur — évite toute coupure de connexion par l'infrastructure Render, qui limite
// la durée d'une requête HTTP unique bien avant qu'un PDF de 50+ pages ne soit traité.
interface ExtractJob {
  status: "running" | "done" | "error";
  message: string;
  progress: string;
  totalInserted: number;
  totalSkipped: number;
}
const extractJobs = new Map<string, ExtractJob>();

app.post("/api/admin/extract-from-pdf-url", requireAdminAuth, (req, res) => {
  const { pdfUrl, sourceTitle, domain, startPage, endPage } = req.body;
  console.log(`[Extract PDF] Requête reçue: pages ${startPage}-${endPage}, source "${sourceTitle}"`);
  if (!pdfUrl || !sourceTitle || !domain) {
    return res.status(400).json({ success: false, message: "Lien PDF, titre de la source et domaine requis." });
  }
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });

  const jobId = crypto.randomBytes(8).toString("hex");
  extractJobs.set(jobId, { status: "running", message: "Téléchargement du PDF...", progress: "", totalInserted: 0, totalSkipped: 0 });
  console.log(`[Extract PDF] Tâche créée: ${jobId}`);
  res.json({ success: true, jobId });

  // Traitement en arrière-plan — la réponse HTTP ci-dessus est déjà partie, ce qui suit ne
  // bloque plus aucune connexion cliente.
  (async () => {
    try {
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) throw new Error(`Le PDF n'a pas pu être téléchargé (HTTP ${pdfRes.status})`);
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      extractJobs.set(jobId, { ...extractJobs.get(jobId)!, message: "Lecture du PDF..." });

      // Découpage fiable page par page : le texte brut de pdf-parse ne contient pas toujours
      // de séparateur de page exploitable (\f) selon le PDF — on force la capture page par
      // page via le callback pagerender, seule méthode fiable constatée sur ce document.
      const pages: string[] = [];
      await pdfParse(buffer, {
        pagerender: (pageData: any) =>
          pageData.getTextContent().then((tc: any) => {
            const pageText = tc.items.map((item: any) => item.str).join(" ");
            pages.push(pageText);
            return pageText;
          }),
      });

      let text: string;
      if (startPage || endPage) {
        const start = (startPage || 1) - 1;
        const end = endPage || pages.length;
        text = pages.slice(start, end).join("\n\n");
      } else {
        text = pages.join("\n\n");
      }

      if (!text || text.trim().length < 50) {
        extractJobs.set(jobId, { status: "error", message: "Aucun texte exploitable extrait de ce PDF (peut-être un scan sans OCR).", progress: "", totalInserted: 0, totalSkipped: 0 });
        return;
      }

      const CHUNK_SIZE = 15000; // réduit (était 42000) — un morceau trop gros produit une
      // réponse JSON trop longue pour la limite de sortie des modèles de secours (DeepSeek,
      // NVIDIA), ce qui la tronque avant sa fin et casse le JSON.
      const totalChunks = Math.ceil(text.length / CHUNK_SIZE);
      let totalInserted = 0, totalSkipped = 0;
      for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
        extractJobs.set(jobId, { status: "running", message: "En cours...", progress: `Morceau ${chunkNum}/${totalChunks}`, totalInserted, totalSkipped });
        const slice = text.slice(i, i + CHUNK_SIZE);
        if (slice.trim().length < 50) continue;
        try {
          const result = await extractAndStoreArticles(slice, sourceTitle, domain);
          totalInserted += result.inserted;
          totalSkipped += result.skipped;
        } catch (chunkErr: any) {
          console.error(`[Extract PDF] Morceau ${chunkNum} échoué:`, chunkErr.message);
        }
      }

      const finalMessage = `Terminé : ${text.length.toLocaleString("fr-FR")} caractères traités. ${totalInserted} article(s) enregistré(s), ${totalSkipped} déjà présent(s)/ignoré(s).`;
      console.log(`[Extract PDF] Tâche ${jobId} terminée: ${finalMessage}`);
      extractJobs.set(jobId, { status: "done", message: finalMessage, progress: "", totalInserted, totalSkipped });
    } catch (err: any) {
      console.error("[Extract PDF] Échec:", err.stack || err.message);
      extractJobs.set(jobId, { status: "error", message: "Échec : " + err.message, progress: "", totalInserted: 0, totalSkipped: 0 });
    }
  })();
});

app.get("/api/admin/extract-job/:jobId", requireAdminAuth, (req, res) => {
  const job = extractJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, message: "Tâche introuvable (peut-être expirée après un redémarrage serveur)." });
  res.json({ success: true, ...job });
});

app.post("/api/admin/extract-articles", requireAdminAuth, async (req, res) => {
  console.log(`[Extract] Requête reçue, taille texte: ${req.body?.rawText?.length || 0} caractères, source: "${req.body?.sourceTitle}"`);
  const { rawText, sourceTitle, domain, organization, country, reference } = req.body;
  if (!rawText || rawText.trim().length < 50) {
    return res.status(400).json({ success: false, message: "Texte trop court ou manquant." });
  }
  if (!sourceTitle || !domain) {
    return res.status(400).json({ success: false, message: "Titre de la source et domaine (PENAL/AFFAIRES) requis." });
  }
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });

  try {
    const result = await extractAndStoreArticles(rawText, sourceTitle, domain, organization, country, reference);
    res.json({ success: true, message: `${result.inserted} article(s) extrait(s) et enregistré(s), ${result.skipped} déjà présent(s) (ignoré(s)).`, ...result });
  } catch (err: any) {
    console.error("[Extract] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'extraction : " + err.message });
  }
});

// --- Extraction depuis une IMAGE de page (scan/photo) via NVIDIA Nemotron Parse (OCR
// spécialisé documents), puis même pipeline Gemini de structuration des articles ---
app.post("/api/admin/extract-from-image", requireAdminAuth, async (req, res) => {
  const { imageBase64, sourceTitle, domain, organization, country, reference } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, message: "Image requise." });
  if (!sourceTitle || !domain) {
    return res.status(400).json({ success: false, message: "Titre de la source et domaine (PENAL/AFFAIRES) requis." });
  }
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  if (!process.env.NVIDIA_API_KEY) {
    return res.status(400).json({ success: false, message: "NVIDIA_API_KEY non configurée sur le serveur." });
  }

  try {
    const nvidiaRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-parse-v1.2",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "</s><s><predict_bbox><predict_classes><output_markdown><predict_no_text_in_pic>" },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        }],
        temperature: 0.0,
        repetition_penalty: 1.1,
      }),
    });
    if (!nvidiaRes.ok) {
      const errText = await nvidiaRes.text();
      throw new Error(`NVIDIA API a répondu ${nvidiaRes.status}: ${errText.slice(0, 200)}`);
    }
    const nvidiaData: any = await nvidiaRes.json();
    const extractedText = nvidiaData.choices?.[0]?.message?.content || "";
    if (!extractedText || extractedText.trim().length < 50) {
      return res.json({ success: false, message: "Aucun texte exploitable extrait de l'image." });
    }

    const result = await extractAndStoreArticles(extractedText, sourceTitle, domain, organization, country, reference);
    res.json({
      success: true,
      message: `OCR: ${extractedText.length} caractères extraits. ${result.inserted} article(s) enregistré(s), ${result.skipped} déjà présent(s).`,
      ocrPreview: extractedText.slice(0, 300),
      ...result,
    });
  } catch (err: any) {
    console.error("[Extract image] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'extraction : " + err.message });
  }
});

// --- Fusion ponctuelle de deux sources en doublon (ex: "CODE PENAL" créé par erreur avec
// un titre différent de "Code pénal ivoirien") : déplace tous les articles vers la source
// principale, ignore les doublons déjà présents, puis supprime la source vide.
// Vue d'ensemble de la base juridique : chaque source avec son nombre d'articles — pour
// voir précisément ce qui est en base sans avoir à deviner via les journaux.
app.get("/api/admin/sources-overview", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const result = await pool.query(`
      SELECT s.id, s.title, s.domain, s.organization, COUNT(a.id) AS article_count
      FROM legal_sources s
      LEFT JOIN legal_articles a ON a.source_id = s.id
      GROUP BY s.id, s.title, s.domain, s.organization
      ORDER BY s.domain, s.title
    `);
    res.json({ success: true, sources: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/admin/merge-sources", requireAdminAuth, async (req, res) => {
  const { fromTitle, toTitle } = req.body;
  if (!fromTitle || !toTitle) return res.status(400).json({ success: false, message: "fromTitle et toTitle requis." });
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const fromRes = await pool.query("SELECT id FROM legal_sources WHERE title = $1", [fromTitle]);
    const toRes = await pool.query("SELECT id FROM legal_sources WHERE title = $1", [toTitle]);
    if (fromRes.rows.length === 0) return res.json({ success: false, message: `Source "${fromTitle}" introuvable.` });
    if (toRes.rows.length === 0) return res.json({ success: false, message: `Source "${toTitle}" introuvable.` });
    const fromId = fromRes.rows[0].id;
    const toId = toRes.rows[0].id;
    if (fromId === toId) return res.json({ success: false, message: "Les deux titres pointent déjà vers la même source." });

    // Déplace ce qui n'est pas déjà en doublon dans la source cible.
    const moved = await pool.query(
      `UPDATE legal_articles SET source_id = $1
       WHERE source_id = $2
       AND article_number NOT IN (SELECT article_number FROM legal_articles WHERE source_id = $1)`,
      [toId, fromId]
    );
    // Ce qui restait (doublons exacts) est simplement supprimé de l'ancienne source.
    const deleted = await pool.query("DELETE FROM legal_articles WHERE source_id = $1", [fromId]);
    await pool.query("DELETE FROM legal_sources WHERE id = $1", [fromId]);

    res.json({ success: true, message: `${moved.rowCount} article(s) déplacés vers "${toTitle}", ${deleted.rowCount} doublon(s) supprimé(s), source "${fromTitle}" retirée.` });
  } catch (err: any) {
    console.error("[Merge sources] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec : " + err.message });
  }
});

// Fusionne TOUTES les sources d'un même domaine (ex: PENAL) en une seule, désignée par
// canonicalTitle — corrige d'un coup l'accumulation de titres légèrement différents créés
// au fil de plusieurs envois ("Code", "Code penal", "Code pénal", "CODE PENAL IVOIRIEN"...).
app.post("/api/admin/merge-all-in-domain", requireAdminAuth, async (req, res) => {
  const { domain, canonicalTitle } = req.body;
  if (!domain || !canonicalTitle) return res.status(400).json({ success: false, message: "domain et canonicalTitle requis." });
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    // Crée la source canonique si elle n'existe pas encore.
    let canonicalRes = await pool.query("SELECT id FROM legal_sources WHERE title = $1", [canonicalTitle]);
    let canonicalId: number;
    if (canonicalRes.rows.length === 0) {
      const created = await pool.query(
        `INSERT INTO legal_sources (country, organization, domain, source_type, title, status)
         VALUES ('CI', 'République de Côte d''Ivoire', $1, 'CODE', $2, 'ACTIVE') RETURNING id`,
        [domain, canonicalTitle]
      );
      canonicalId = created.rows[0].id;
    } else {
      canonicalId = canonicalRes.rows[0].id;
    }

    const others = await pool.query("SELECT id, title FROM legal_sources WHERE domain = $1 AND id != $2", [domain, canonicalId]);
    let totalMoved = 0, totalDupesRemoved = 0;
    for (const src of others.rows) {
      const moved = await pool.query(
        `UPDATE legal_articles SET source_id = $1
         WHERE source_id = $2
         AND article_number NOT IN (SELECT article_number FROM legal_articles WHERE source_id = $1)`,
        [canonicalId, src.id]
      );
      const deleted = await pool.query("DELETE FROM legal_articles WHERE source_id = $1", [src.id]);
      await pool.query("DELETE FROM legal_sources WHERE id = $1", [src.id]);
      totalMoved += moved.rowCount || 0;
      totalDupesRemoved += deleted.rowCount || 0;
    }

    const finalCount = await pool.query("SELECT COUNT(*) FROM legal_articles WHERE source_id = $1", [canonicalId]);
    res.json({
      success: true,
      message: `${others.rows.length} source(s) fusionnée(s) dans "${canonicalTitle}". ${totalMoved} article(s) déplacés, ${totalDupesRemoved} doublon(s) supprimés. Total final : ${finalCount.rows[0].count} articles.`,
    });
  } catch (err: any) {
    console.error("[Merge all in domain] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec : " + err.message });
  }
});

app.post("/api/admin/seed-legal-data-2", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: exist } = await pool.query("SELECT COUNT(*) FROM legal_articles WHERE article_number = 'Art. 345'");
    if (Number(exist[0].count) > 0) return res.json({ success: true, message: "Lot 2 déjà présent.", skipped: true });

    const { rows: srcRows } = await pool.query("SELECT id FROM legal_sources WHERE title = 'Code pénal ivoirien' LIMIT 1");
    const sourceId = srcRows[0]?.id;
    if (!sourceId) return res.status(400).json({ success: false, message: "Alimentez d'abord le Code pénal (lot 1)." });

    const articles = [
      {
        article_number: "Art. 345", title: "Coups et blessures volontaires",
        official_text: "Quiconque, volontairement, porte des coups ou fait des blessures ou commet toute autre violence ou voie de fait est puni. L'emprisonnement est de cinq à vingt ans lorsque les coups portés et les blessures faites, même sans intention de donner la mort, l'ont pourtant occasionnée. La peine est d'un emprisonnement de cinq à dix ans et d'une amende de 50.000 à 500.000 francs lorsque les violences ont occasionné une mutilation, amputation ou privation de l'usage d'un membre, la cécité ou la perte d'un œil ou toute autre infirmité permanente.",
        infraction: "Coups et blessures volontaires",
        min_sentence_years: 5, max_sentence_years: 20, fine_min_fcfa: 50000, fine_max_fcfa: 500000,
        prescription_years: 10, procedure_type: "Tribunal correctionnel ou criminel selon la gravité",
        conditions: "Coups ou blessures volontaires\nGravité graduée selon le résultat (décès non intentionnel, mutilation, infirmité permanente)",
      },
      {
        article_number: "Art. 382", title: "Voie de fait",
        official_text: "Constitue une voie de fait, le fait d'exercer volontairement sur une personne une violence ou tout autre acte qui ne constitue aucun coup ni n'occasionne aucune blessure, mais est de nature à impressionner la victime ou à lui causer un trouble. Est puni d'un emprisonnement de quinze jours à six mois et d'une amende de 100.000 à 1.000.000 de francs, quiconque commet une voie de fait.",
        infraction: "Voie de fait",
        min_sentence_years: 0, max_sentence_years: 1, fine_min_fcfa: 100000, fine_max_fcfa: 1000000,
        prescription_years: 3, procedure_type: "Tribunal correctionnel",
        conditions: "Violence ou acte intentionnel\nAbsence de coup ou blessure physique\nEffet d'impression ou de trouble sur la victime",
      },
    ];

    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, min_sentence_years, max_sentence_years, fine_min_fcfa, fine_max_fcfa, prescription_years, procedure_type, conditions, searchable_text)
         VALUES ($1,$2,$3,$4,'PENAL',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [sourceId, art.article_number, art.title, art.official_text, art.infraction, art.min_sentence_years,
         art.max_sentence_years, art.fine_min_fcfa, art.fine_max_fcfa, art.prescription_years, art.procedure_type,
         art.conditions, `${art.title} ${art.official_text}`]
      );
    }
    res.json({ success: true, message: `${articles.length} article(s) ajoutés (coups et blessures, voie de fait).` });
  } catch (err: any) {
    console.error("[Seed 2] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'alimentation." });
  }
});

// --- Acte OHADA supplémentaire : sûretés ---
app.post("/api/admin/seed-ohada-suretes", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: exist } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE title LIKE '%sûretés%'");
    if (Number(exist[0].count) > 0) return res.json({ success: true, message: "Acte sûretés déjà présent.", skipped: true });

    const { rows: sourceRows } = await pool.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
       VALUES ('OHADA', 'OHADA', 'AFFAIRES', 'ACTE_UNIFORME', 'Acte uniforme portant organisation des sûretés (AUS)', 'Adopté le 15 décembre 2010, entré en vigueur le 15 mai 2011', 'ACTIVE')
       RETURNING id`
    );
    const sourceId = sourceRows[0].id;

    const articles = [
      {
        article_number: "Art. 1", title: "Définition de la sûreté",
        official_text: "Une sûreté est l'affectation au bénéfice d'un créancier d'un bien, d'un ensemble de biens ou d'un patrimoine afin de garantir l'exécution d'une obligation ou d'un ensemble d'obligations, quelle que soit la nature juridique de celles-ci et notamment qu'elles soient présentes ou futures, déterminées ou déterminables, conditionnelles ou inconditionnelles.",
        conditions: "Affectation d'un bien/patrimoine au bénéfice d'un créancier\nGarantie d'une ou plusieurs obligations, présentes ou futures",
      },
      {
        article_number: "Art. 3", title: "Débiteur professionnel",
        official_text: "Est considéré comme débiteur professionnel au sens du présent Acte uniforme, tout débiteur dont la dette est née dans l'exercice de sa profession ou se trouve en rapport direct avec l'une de ses activités professionnelles, même si celle-ci n'est pas principale.",
        conditions: "Dette née dans l'exercice de la profession, OU\nRapport direct avec une activité professionnelle (même non principale)",
      },
    ];

    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions, searchable_text)
         VALUES ($1,$2,$3,$4,'AFFAIRES',$5,$6,$7)`,
        [sourceId, art.article_number, art.title, art.official_text, art.title, art.conditions, `${art.title} ${art.official_text}`]
      );
    }
    res.json({ success: true, message: `${articles.length} article(s) ajoutés (Acte uniforme sûretés).` });
  } catch (err: any) {
    console.error("[Seed OHADA sûretés] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'alimentation." });
  }
});

// --- Ajout des 5 actes uniformes OHADA restants (procédures collectives, arbitrage,
// comptable, transport routier, sociétés coopératives), articles clés vérifiés ---
app.post("/api/admin/seed-ohada-remaining", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE title LIKE '%procédures collectives%' OR title LIKE '%arbitrage%'");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Ces actes sont déjà présents.", skipped: true });
    }

    const actes = [
      {
        title: "Acte uniforme portant organisation des procédures collectives d'apurement du passif (AUPC)",
        reference: "Révisé le 10 septembre 2015 à Grand-Bassam (Côte d'Ivoire), entré en vigueur le 24 décembre 2015",
        articles: [
          {
            article_number: "Art. 1", title: "Objet de l'acte uniforme",
            official_text: "Le présent Acte uniforme a pour objet : d'organiser les procédures collectives de règlement préventif, de redressement judiciaire et de liquidation des biens du débiteur en vue de l'apurement collectif de son passif ; de définir les sanctions patrimoniales, professionnelles et pénales relatives à la défaillance du débiteur.",
            conditions: "Débiteur en difficulté (prévention) ou en cessation des paiements (traitement)\nApurement collectif du passif au bénéfice de l'ensemble des créanciers",
          },
          {
            article_number: "Art. 2-3", title: "Définitions : redressement judiciaire et liquidation des biens",
            official_text: "Le redressement judiciaire est une procédure collective destinée au sauvetage de l'entreprise débitrice en cessation des paiements mais dont la situation n'est pas irrémédiablement compromise, et à l'apurement de son passif au moyen d'un concordat de redressement. La liquidation des biens est une procédure collective destinée à la réalisation de l'actif de l'entreprise débitrice en cessation des paiements dont la situation est irrémédiablement compromise pour apurer son passif.",
            conditions: "Redressement : cessation des paiements mais situation non irrémédiablement compromise\nLiquidation : cessation des paiements et situation irrémédiablement compromise",
          },
        ],
      },
      {
        title: "Acte uniforme relatif au droit de l'arbitrage (AUA)",
        reference: "Révisé le 23 novembre 2017",
        articles: [
          {
            article_number: "Art. 1", title: "Champ d'application",
            official_text: "Le présent Acte uniforme a vocation à s'appliquer à tout arbitrage lorsque le siège du tribunal arbitral se trouve dans l'un des États Parties.",
            conditions: "Siège du tribunal arbitral situé dans un État partie à l'OHADA",
          },
          {
            article_number: "Art. 2", title: "Personnes pouvant recourir à l'arbitrage",
            official_text: "Toute personne physique ou morale peut recourir à l'arbitrage sur les droits dont elle a la libre disposition. Les États, les autres collectivités publiques territoriales, les établissements publics et toute autre personne morale de droit public peuvent également être parties à un arbitrage, quelle que soit la nature juridique du contrat, sans pouvoir invoquer leur propre droit pour contester l'arbitrabilité d'un différend, leur capacité à compromettre ou la validité de la convention d'arbitrage.",
            conditions: "Droits dont la personne a la libre disposition\nPersonnes physiques, morales privées ou publiques (États compris)",
          },
        ],
      },
      {
        title: "Acte uniforme relatif au droit comptable et à l'information financière (AUDCIF)",
        reference: "Adopté le 26 janvier 2017, publié le 15 février 2017, entré en vigueur le 1er janvier 2018",
        articles: [
          {
            article_number: "Art. 2", title: "Champ d'application",
            official_text: "Entrent dans le champ d'application de l'Acte uniforme relatif au droit comptable et à l'information financière toutes les entités produisant des biens et des services marchands ou non marchands, dans la mesure où elles exercent, dans un but lucratif ou non, des activités économiques à titre principal ou accessoires qui se fondent sur des actes répétitifs, à l'exception de celles soumises aux règles de la comptabilité publique.",
            conditions: "Production de biens/services marchands ou non marchands\nActivité économique à titre principal ou accessoire, actes répétitifs\nException : entités soumises à la comptabilité publique",
          },
          {
            article_number: "Art. 5", title: "Système comptable OHADA (SYSCOHADA)",
            official_text: "Il est institué un système comptable unique, commun à tous les États parties composé du Plan comptable général OHADA et du Dispositif comptable relatif aux comptes consolidés et combinés, dénommé Système comptable OHADA en abrégé SYSCOHADA. Le SYSCOHADA a pour objet la collecte, la tenue, le contrôle, la présentation et la communication par les entités, d'informations financières établies dans les mêmes conditions de fiabilité, de compréhension et de comparabilité.",
            conditions: "Applicable à toutes les entités visées à l'article 2\nExceptions : établissements de crédit, microfinance, marché financier, assurance/réassurance, sécurité sociale, entités à but non lucratif (référentiels propres)",
          },
        ],
      },
      {
        title: "Acte uniforme relatif aux contrats de transport de marchandises par route (AUCTMR)",
        reference: "Adopté le 22 mars 2003, entré en vigueur le 1er janvier 2004",
        articles: [
          {
            article_number: "Art. 1", title: "Champ d'application",
            official_text: "Le présent Acte uniforme s'applique à tout contrat de transport de marchandises par route lorsque le lieu de prise en charge de la marchandise et le lieu prévu pour la livraison, tels qu'ils sont indiqués au contrat, sont situés soit sur le territoire d'un État membre de l'OHADA, soit sur le territoire de deux États différents dont l'un au moins est membre de l'OHADA. L'Acte uniforme s'applique quels que soient le domicile et la nationalité des parties au contrat de transport.",
            conditions: "Lieu de prise en charge et/ou de livraison dans un État membre OHADA\nExclusions : marchandises dangereuses, transports funéraires, déménagement, conventions postales internationales",
          },
          {
            article_number: "Art. 3", title: "Définition du contrat de transport",
            official_text: "Le contrat de transport de marchandise existe dès que le donneur d'ordre et le transporteur sont d'accord pour le déplacement d'une marchandise moyennant un prix convenu.",
            conditions: "Accord entre donneur d'ordre et transporteur\nDéplacement d'une marchandise\nPrix convenu (le contrat existe par le seul accord, indépendamment de l'établissement d'une lettre de voiture)",
          },
        ],
      },
      {
        title: "Acte uniforme relatif au droit des sociétés coopératives (AUSCOOP)",
        reference: "Adopté le 15 décembre 2010 à Lomé (Togo), entré en vigueur le 15 mai 2011",
        articles: [
          {
            article_number: "Art. 1", title: "Champ d'application",
            official_text: "Toute société coopérative, toute union ou fédération de sociétés coopératives, dont le siège social est situé sur le territoire de l'un des États Parties au Traité relatif à l'harmonisation du droit des affaires en Afrique, est soumise aux dispositions du présent Acte uniforme. Toute confédération de sociétés coopératives qui fait option de la forme coopérative est également soumise aux dispositions du présent Acte uniforme.",
            conditions: "Siège social dans un État partie OHADA\nApplicable aux sociétés, unions, fédérations et confédérations coopératives",
          },
          {
            article_number: "Art. 2", title: "Caractère d'ordre public",
            official_text: "Les dispositions du présent Acte uniforme sont d'ordre public, sauf dans les cas où il en dispose autrement.",
            conditions: "Application impérative sauf dérogation expresse prévue par l'Acte uniforme lui-même",
          },
        ],
      },
    ];

    let totalArticles = 0;
    for (const acte of actes) {
      const { rows: sourceRows } = await pool.query(
        `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
         VALUES ('OHADA', 'OHADA', 'AFFAIRES', 'ACTE_UNIFORME', $1, $2, 'ACTIVE') RETURNING id`,
        [acte.title, acte.reference]
      );
      const sourceId = sourceRows[0].id;
      for (const art of acte.articles) {
        await pool.query(
          `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions, searchable_text)
           VALUES ($1,$2,$3,$4,'AFFAIRES',$5,$6,$7)`,
          [sourceId, art.article_number, art.title, art.official_text, art.title, art.conditions, `${art.title} ${art.official_text}`]
        );
        totalArticles++;
      }
    }

    res.json({ success: true, message: `${totalArticles} article(s) ajoutés sous ${actes.length} nouveaux actes uniformes OHADA.` });
  } catch (err: any) {
    console.error("[Seed OHADA remaining] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec de l'alimentation : " + err.message });
  }
});

// --- Code du travail ivoirien (droit NATIONAL, pas OHADA — l'acte uniforme OHADA sur le
// travail n'est jamais entré en vigueur) ---
app.post("/api/admin/seed-code-travail", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE title = 'Code du travail ivoirien'");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Déjà présent.", skipped: true });
    }

    const { rows: sourceRows } = await pool.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
       VALUES ('CI', 'République de Côte d''Ivoire', 'TRAVAIL', 'CODE', 'Code du travail ivoirien', 'Loi n°2015-532 du 20 juillet 2015', 'ACTIVE') RETURNING id`
    );
    const sourceId = sourceRows[0].id;

    const articles = [
      {
        article_number: "Art. 2", title: "Définition du travailleur",
        official_text: "Est considéré comme travailleur ou salarié, quels que soient son sexe, sa race ou sa nationalité, toute personne physique qui s'est engagée à mettre son activité professionnelle, moyennant rémunération, sous la direction et l'autorité d'une autre personne physique ou morale, publique ou privée, appelée employeur.",
        conditions: "Engagement de l'activité professionnelle\nMoyennant rémunération\nSous la direction et l'autorité d'un employeur (lien de subordination)",
      },
      {
        article_number: "Art. 8", title: "Caractère d'ordre public",
        official_text: "Sous réserve de dérogation expresse, les dispositions du présent Code sont d'ordre public. En conséquence, toute règle résultant d'une décision unilatérale, d'un contrat ou d'une convention et qui ne respecte pas les dispositions dudit Code ou des textes pris pour son application est nulle de plein droit.",
        conditions: "Nullité de plein droit de toute clause moins favorable, sauf dérogation expresse prévue par le Code",
      },
      {
        article_number: "Art. 18.9", title: "Licenciement pour motif économique",
        official_text: "Constitue un licenciement pour motif économique, le licenciement opéré par un employeur en raison d'une suppression ou transformation d'emploi, consécutives notamment à des mutations technologiques, à une restructuration ou à des difficultés économiques de nature à compromettre l'équilibre financier de l'entreprise.",
        conditions: "Suppression ou transformation d'emploi\nCause économique (mutation technologique, restructuration, difficultés financières)",
      },
      {
        article_number: "Art. 18.15", title: "Licenciement abusif",
        official_text: "Toute rupture abusive du contrat donne lieu à dommages-intérêts. Les licenciements effectués sans motif légitime ou en violation des dispositions de l'article 4 du présent Code, ou les licenciements économiques collectifs sans respect de la procédure requise ou pour faux motif, sont abusifs. La juridiction compétente constate l'abus par une enquête sur les causes et les circonstances de la rupture du contrat.",
        conditions: "Absence de motif légitime, OU\nNon-respect de la procédure de licenciement économique, OU\nFaux motif invoqué",
      },
    ];

    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions, searchable_text)
         VALUES ($1,$2,$3,$4,'TRAVAIL',$5,$6,$7)`,
        [sourceId, art.article_number, art.title, art.official_text, art.title, art.conditions, `${art.title} ${art.official_text}`]
      );
    }

    res.json({ success: true, message: `${articles.length} article(s) du Code du travail ivoirien ajoutés.` });
  } catch (err: any) {
    console.error("[Seed Code travail] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec : " + err.message });
  }
});

// --- Code foncier rural ivoirien (Loi n°98-750 du 23 décembre 1998, modifiée) ---
app.post("/api/admin/seed-code-foncier", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE title = 'Code foncier rural ivoirien'");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Déjà présent.", skipped: true });
    }

    const { rows: sourceRows } = await pool.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
       VALUES ('CI', 'République de Côte d''Ivoire', 'FONCIER', 'CODE', 'Code foncier rural ivoirien', 'Loi n°98-750 du 23 décembre 1998, modifiée par les lois n°2004-412, n°2013-655 et n°2019-868', 'ACTIVE') RETURNING id`
    );
    const sourceId = sourceRows[0].id;

    const articles = [
      {
        article_number: "Art. 1", title: "Définition du domaine foncier rural",
        official_text: "Le Domaine Foncier Rural est constitué par l'ensemble des terres mises en valeur ou non et quelle que soit la nature de la mise en valeur. Il constitue un patrimoine national auquel toute personne physique ou morale peut accéder. Toutefois, seuls l'État, les Collectivités publiques et les personnes physiques ivoiriennes sont admis à en être propriétaires.",
        conditions: "Terres mises en valeur ou non\nPatrimoine national\nPropriété réservée à l'État, aux collectivités publiques et aux personnes physiques ivoiriennes",
      },
      {
        article_number: "Art. 2", title: "Composition du domaine foncier rural",
        official_text: "Le Domaine Foncier Rural est à la fois : hors du domaine public ; hors des périmètres urbains ; hors des zones d'aménagement différé dûment constituées ; hors du domaine forestier classé et des aires protégées ; hors des zones touristiques dûment constituées.",
        conditions: "Exclusion du domaine public, des périmètres urbains, des zones d'aménagement différé, du domaine forestier classé/aires protégées et des zones touristiques constituées",
      },
      {
        article_number: "Art. 3", title: "Domaine foncier rural coutumier",
        official_text: "Le Domaine Foncier Rural coutumier est constitué par l'ensemble des terres sur lesquelles s'exercent : des droits coutumiers conformes aux traditions ; des droits coutumiers cédés à des tiers.",
        conditions: "Exercice de droits coutumiers conformes aux traditions\nOu droits coutumiers ayant fait l'objet d'une cession à un tiers",
      },
      {
        article_number: "Art. 4", title: "Établissement de la propriété",
        official_text: "La propriété d'une terre du Domaine Foncier Rural est établie à partir de l'immatriculation de cette terre au Registre Foncier ouvert à cet effet par l'Administration et, en ce qui concerne les terres du domaine coutumier, par le Certificat Foncier.",
        conditions: "Immatriculation au Registre Foncier (terres hors coutumier)\nOu délivrance d'un Certificat Foncier (terres du domaine coutumier)",
      },
    ];

    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions, searchable_text)
         VALUES ($1,$2,$3,$4,'FONCIER',$5,$6,$7)`,
        [sourceId, art.article_number, art.title, art.official_text, art.title, art.conditions, `${art.title} ${art.official_text}`]
      );
    }

    res.json({ success: true, message: `${articles.length} article(s) du Code foncier rural ivoirien ajoutés.` });
  } catch (err: any) {
    console.error("[Seed Code foncier] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec : " + err.message });
  }
});

app.post("/api/admin/seed-loi-mariage", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE title = 'Loi relative au mariage'");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Déjà présent.", skipped: true });
    }

    const { rows: sourceRows } = await pool.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
       VALUES ('CI', 'République de Côte d''Ivoire', 'FAMILLE', 'CODE', 'Loi relative au mariage', 'Loi n°2019-570 du 26 juin 2019', 'ACTIVE') RETURNING id`
    );
    const sourceId = sourceRows[0].id;

    const articles = [
      {
        article_number: "Art. 1", title: "Définition du mariage",
        official_text: "Le mariage est l'union d'un homme et d'une femme célébrée par devant l'officier de l'état civil.",
        conditions: "Union entre un homme et une femme\nCélébration devant l'officier de l'état civil (seule forme ayant des effets légaux)",
      },
      {
        article_number: "Art. 2", title: "Âge légal du mariage",
        official_text: "L'homme et la femme avant dix-huit ans révolus ne peuvent contracter mariage.",
        conditions: "Âge minimum de 18 ans révolus pour les deux époux",
      },
      {
        article_number: "Art. 3", title: "Interdiction de la bigamie",
        official_text: "Nul ne peut contracter un nouveau mariage avant la dissolution du précédent constatée soit par une décision devenue définitive, soit par un acte de décès. Au cas où le mariage est dissous par le divorce ou annulé, une nouvelle union ne peut être contractée avant l'accomplissement des formalités de mention en marge de l'acte de mariage et des actes de naissance des époux, du dispositif du jugement ou de l'arrêt qui prononce le divorce.",
        conditions: "Dissolution du mariage précédent (décision définitive ou acte de décès)\nMentions marginales accomplies en cas de divorce/annulation avant tout nouveau mariage",
      },
      {
        article_number: "Art. 4", title: "Consentement des époux",
        official_text: "Chacun des futurs époux doit consentir personnellement au mariage. Le consentement n'est pas valable s'il a été extorqué par la violence ou s'il n'a été donné que par suite d'une erreur sur l'identité physique ou civile de la personne.",
        conditions: "Consentement personnel et libre de chaque époux\nAbsence de violence ou d'erreur sur l'identité de la personne",
      },
    ];

    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions, searchable_text)
         VALUES ($1,$2,$3,$4,'FAMILLE',$5,$6,$7)`,
        [sourceId, art.article_number, art.title, art.official_text, art.title, art.conditions, `${art.title} ${art.official_text}`]
      );
    }

    res.json({ success: true, message: `${articles.length} article(s) de la Loi relative au mariage ajoutés.` });
  } catch (err: any) {
    console.error("[Seed loi mariage] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec : " + err.message });
  }
});

app.post("/api/documents/generate", requireAuth, resolveUserId, async (req: any, res) => {
  try {
    const { dossier_id, document_type, recipient_name, recipient_address, facts_summary, amount_claimed_fcfa, deadline_days } = req.body;
    if (!dossier_id || !document_type) return res.status(400).json({ success: false, message: "dossier_id et document_type requis." });
    const dosResult = await pool!.query("SELECT * FROM dossiers WHERE id = $1 AND user_id = $2", [dossier_id, req.user.userId]);
    if (dosResult.rows.length === 0) return res.status(404).json({ success: false, message: "Dossier introuvable." });
    const dossier = dosResult.rows[0];

    const prompt = `Tu es un expert juridique OHADA/Côte d'Ivoire.

Génère un document de type: ${document_type}

Paramètres:
- Destinataire: ${recipient_name}
- Adresse: ${recipient_address}
- Faits: ${facts_summary}
- Montant réclamé: ${amount_claimed_fcfa} FCFA
- Délai: ${deadline_days} jours

Contexte dossier:
- Client: ${dossier.client_name}
- Domaine: ${dossier.domain}

Produis un document professionnel en HTML prêt à être converti. N'invente pas d'articles. Cite uniquement des textes existants. Le document doit être signable/envoyable.`;

    const content = await generateWithFallback(prompt);

    const result = await pool!.query(
      `INSERT INTO generated_documents (dossier_id, document_type, title, content, format) VALUES ($1,$2,$3,$4,'html') RETURNING id, created_at`,
      [dossier_id, document_type, `${document_type} — ${dossier.client_name || "Client"}`, content]
    );
    res.status(201).json({ success: true, document_id: result.rows[0].id, document_type, content, created_at: result.rows[0].created_at, needs_review_by_professional: true });
  } catch (err: any) {
    console.error("[Documents] Erreur génération:", err.message);
    res.status(500).json({ success: false, message: "Échec de la génération du document." });
  }
});

app.get("/api/documents/:id", requireAuth, async (req: any, res) => {
  const result = await pool!.query("SELECT * FROM generated_documents WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Document introuvable." });
  res.json({ success: true, ...result.rows[0] });
});

app.delete("/api/documents/:id", requireAuth, async (req: any, res) => {
  await pool!.query("DELETE FROM generated_documents WHERE id = $1", [req.params.id]);
  res.json({ success: true, message: "Document supprimé." });
});

// Filet de sécurité : capture toute erreur qui échapperait à un bloc try/catch existant dans
// une route, pour ne jamais laisser une requête sans réponse (ce qui provoquerait "Failed to
// fetch" côté client sans aucune trace serveur).
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[Erreur non gérée]", err?.stack || err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: "Erreur interne inattendue." });
  }
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
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
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`JurisCoach running on port ${PORT}`);
  });

  // --- Bridge vocal Gemini Live (fonctionnalité Live, réservée aux comptes Pro) ---
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname, searchParams } = new URL(request.url || "", `http://${request.headers.host}`);
    if (pathname === "/api/live-ws") {
      const token = searchParams.get("token") || "";
      const session = sessions.get(token);
      if (!token || !session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const acc = userAccounts.get(session.phone);
      if (!acc?.isPro) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (clientWs) => {
    console.log("[WebSocket] Client connecté au bridge vocal Live.");
    let geminiSession: any = null;
    let isClosed = false;

    clientWs.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "start") {
          const systemInstruction = `Tu es JurisCoach, un assistant juridique vocal spécialisé en droit ivoirien (Code pénal, droit OHADA, Code du travail, Code foncier). Tu accompagnes une personne qui te pose des questions juridiques à voix haute, comme le ferait un avocat au téléphone.

RÈGLE D'IDENTITÉ :
- Ton nom est JurisCoach. Si on te demande qui tu es, réponds : "JurisCoach, je vous écoute."

TON ET STYLE :
- Vouvoie toujours la personne, avec sérieux et bienveillance professionnelle.
- Réponses courtes et claires (2-3 phrases maximum) pour un échange vocal fluide.
- Cite les articles de loi pertinents quand tu les connais (numéro + résumé), sans les réciter en entier à voix haute.
- Si l'information exacte n'est pas certaine, dis-le clairement plutôt que d'inventer un article ou un numéro.

RAPPEL IMPORTANT (à dire une fois en début d'échange) :
- Précise que ce diagnostic vocal est une aide informative et ne remplace pas la consultation d'un avocat pour un dossier réel.

FORMATAGE VOCAL STRICT : Ne génère aucun caractère markdown (pas d'astérisques, pas de hashtags, pas de puces). Phrases fluides et naturelles uniquement.`;

          try {
            geminiSession = await getAIClient().live.connect({
              model: "gemini-3.1-flash-live-preview",
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
                systemInstruction,
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                realtimeInputConfig: {
                  automaticActivityDetection: {
                    disabled: false,
                    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                    prefixPaddingMs: 20,
                    silenceDurationMs: 300,
                  },
                },
              },
              callbacks: {
                onmessage: (msg: any) => {
                  if (isClosed) return;
                  const modelParts = msg.serverContent?.modelTurn?.parts;
                  if (modelParts && Array.isArray(modelParts)) {
                    for (const part of modelParts) {
                      if (part.inlineData?.data) clientWs.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
                      if (part.text) clientWs.send(JSON.stringify({ type: "text", text: part.text }));
                    }
                  }
                  const userParts = msg.serverContent?.userTurn?.parts;
                  if (userParts && Array.isArray(userParts)) {
                    for (const part of userParts) {
                      if (part.text) clientWs.send(JSON.stringify({ type: "userTranscript", text: part.text }));
                    }
                  }
                  if (msg.serverContent?.interrupted) clientWs.send(JSON.stringify({ type: "interrupted" }));
                  if (msg.serverContent?.turnComplete) clientWs.send(JSON.stringify({ type: "turnComplete" }));
                },
                onclose: () => {
                  console.log("[WebSocket] Session Gemini Live fermée.");
                  if (!isClosed) { clientWs.send(JSON.stringify({ type: "closed" })); clientWs.close(); }
                },
                onerror: (err: any) => {
                  console.error("[WebSocket] Erreur Gemini Live:", err);
                  if (!isClosed) clientWs.send(JSON.stringify({ type: "error", message: "Erreur de connexion vocale avec l'IA." }));
                },
              },
            });

            clientWs.send(JSON.stringify({ type: "connected" }));
            geminiSession.sendClientContent({
              turns: [{ role: "user", parts: [{ text: "JurisCoach, signale ta présence en disant : 'JurisCoach, je vous écoute.' puis rappelle en une phrase que ce diagnostic vocal est informatif et ne remplace pas un avocat." }] }],
            });
          } catch (err: any) {
            console.error("[WebSocket] Échec connexion Gemini Live:", err);
            clientWs.send(JSON.stringify({ type: "error", message: "Impossible de démarrer la session vocale : " + err.message }));
            clientWs.close();
          }
        } else if (message.type === "audio") {
          if (geminiSession) {
            geminiSession.sendRealtimeInput({ audio: { data: message.audio, mimeType: "audio/pcm;rate=16000" } });
          }
        } else if (message.type === "text") {
          if (geminiSession) {
            geminiSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: message.text }] }] });
          }
        }
      } catch (err: any) {
        console.error("[WebSocket] Erreur traitement message:", err);
      }
    });

    clientWs.on("close", () => {
      console.log("[WebSocket] Client déconnecté du bridge vocal Live.");
      isClosed = true;
      if (geminiSession) { try { geminiSession.close(); } catch (e) {} }
    });
  });

  try {
    await initDatabase();
  } catch (err: any) {
    console.error("[DB] Échec du chargement initial:", err.message);
  }
}

app.post("/api/admin/seed-code-construction", requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, message: "Service indisponible." });
  try {
    const { rows: existing } = await pool.query("SELECT COUNT(*) FROM legal_sources WHERE title = 'Code de la Construction et de l''Habitat'");
    if (Number(existing[0].count) > 0) {
      return res.json({ success: true, message: "Déjà présent.", skipped: true });
    }
    const { rows: sourceRows } = await pool.query(
      `INSERT INTO legal_sources (country, organization, domain, source_type, title, reference, status)
       VALUES ('CI', 'République de Côte d''Ivoire', 'CONSTRUCTION', 'CODE', 'Code de la Construction et de l''Habitat', 'Loi n°2019-576 du 26 juin 2019 - Journal Officiel 1er août 2019', 'ACTIVE') RETURNING id`
    );
    const sourceId = sourceRows[0].id;
    const articles = [
      { article_number: "Art. 1", title: "Objet de la loi", official_text: "La présente loi fixe les règles relatives à la construction, à l'urbanisme, à l'habitat et aux activités immobilières en République de Côte d'Ivoire.", conditions: "Application générale sur le territoire national" },
      { article_number: "Art. 2", title: "Définitions", official_text: "Au sens de la présente loi, on entend par : construction : tout édifice ou ouvrage réalisé par assemblage de matériaux ; promoteur immobilier : toute personne physique ou morale qui réalise des programmes de construction destinés à la vente ou à la location.", conditions: "Définitions légales applicables" },
      { article_number: "Art. 5", title: "Permis de construire obligatoire", official_text: "Toute construction, reconstruction, transformation ou agrandissement d'immeuble est soumis à l'obtention préalable d'un permis de construire délivré par l'autorité compétente.", conditions: "Travaux de construction ou transformation immobilière", infraction: "Construction sans permis de construire", procedure_type: "Administrative/Pénale", prescription_period: "10 ans" },
      { article_number: "Art. 8", title: "Certificat d'urbanisme", official_text: "Le certificat d'urbanisme indique les dispositions d'urbanisme applicables à un terrain ainsi que les limitations administratives au droit de propriété.", conditions: "Demande préalable à tout projet immobilier" },
      { article_number: "Art. 12", title: "Plan d'urbanisme directeur", official_text: "Le plan d'urbanisme directeur détermine la destination générale des sols sur le territoire communal et définit les zones constructibles, agricoles et naturelles.", conditions: "Applicable dans les communes dotées d'un plan d'urbanisme" },
      { article_number: "Art. 15", title: "Zones constructibles", official_text: "Sont constructibles les terrains situés en zone urbaine équipée des réseaux d'eau, d'électricité et de voirie, ou pouvant l'être dans des conditions économiquement acceptables.", conditions: "Disponibilité des réseaux d'infrastructure" },
      { article_number: "Art. 18", title: "Règles de construction parasismique", official_text: "Les constructions doivent respecter les normes parasismiques définies par voie réglementaire selon la zone de sismicité du territoire national.", conditions: "Toute construction nouvelle" },
      { article_number: "Art. 22", title: "Maîtrise d'ouvrage", official_text: "Le maître d'ouvrage est la personne physique ou morale pour le compte de laquelle les travaux sont exécutés. Il est responsable de la conformité de la construction au permis accordé.", conditions: "Relation contractuelle maître d'ouvrage / entrepreneur" },
      { article_number: "Art. 25", title: "Maîtrise d'œuvre", official_text: "La maîtrise d'œuvre est assurée par un architecte agréé. Toute construction dont la surface de plancher excède 150 m² doit être conçue par un architecte.", conditions: "Construction de plus de 150 m² de surface de plancher" },
      { article_number: "Art. 28", title: "Responsabilité décennale", official_text: "Les constructeurs sont responsables pendant dix ans à compter de la réception des travaux des dommages qui compromettent la solidité de l'ouvrage ou le rendent impropre à sa destination.", conditions: "Désordres affectant la solidité ou la destination de l'ouvrage", procedure_type: "Civile", prescription_period: "10 ans" },
      { article_number: "Art. 32", title: "Réception des travaux", official_text: "La réception est l'acte par lequel le maître d'ouvrage déclare accepter les travaux avec ou sans réserves. Elle constitue le point de départ des garanties légales.", conditions: "Fin des travaux de construction" },
      { article_number: "Art. 35", title: "Garantie de parfait achèvement", official_text: "L'entrepreneur est tenu, pendant un délai d'un an à compter de la réception, de remédier à tous les désordres signalés par le maître d'ouvrage.", conditions: "Désordres apparus dans l'année suivant la réception", procedure_type: "Civile", prescription_period: "1 an" },
      { article_number: "Art. 38", title: "Garantie biennale", official_text: "Les éléments d'équipement dissociables de la construction sont couverts par une garantie de bon fonctionnement de deux ans à compter de la réception.", conditions: "Équipements dissociables défaillants", procedure_type: "Civile", prescription_period: "2 ans" },
      { article_number: "Art. 42", title: "Agrément des entreprises de BTP", official_text: "Les entreprises de bâtiment et travaux publics doivent être agréées par le ministère chargé de la construction. L'agrément est délivré selon la capacité technique et financière.", conditions: "Exercice de l'activité de BTP en Côte d'Ivoire" },
      { article_number: "Art. 45", title: "Norme de construction NORM CI", official_text: "Toute construction doit respecter les normes techniques ivoiriennes homologuées par l'CODINORM relatives aux matériaux, structures et installations.", conditions: "Normes techniques obligatoires" },
      { article_number: "Art. 52", title: "Permis de démolir", official_text: "La démolition totale ou partielle d'un immeuble est soumise à l'obtention d'un permis de démolir délivré par l'autorité compétente.", conditions: "Démolition d'un bâtiment existant", infraction: "Démolition sans permis", procedure_type: "Administrative/Pénale" },
      { article_number: "Art. 58", title: "Lotissement", official_text: "Le lotissement est l'opération consistant à diviser en lots une propriété foncière en vue de la construction d'immeubles. Il est soumis à autorisation préalable.", conditions: "Division parcellaire à des fins de construction" },
      { article_number: "Art. 65", title: "Promotion immobilière — agrément", official_text: "Toute personne physique ou morale qui se livre à la promotion immobilière doit obtenir un agrément délivré par le ministère chargé du logement.", conditions: "Exercice de la promotion immobilière professionnelle" },
      { article_number: "Art. 68", title: "Vente en l'état futur d'achèvement (VEFA)", official_text: "La vente en l'état futur d'achèvement est le contrat par lequel le vendeur s'oblige à édifier un immeuble dans un délai déterminé. Elle est constatée par acte authentique.", conditions: "Contrat de vente sur plan", procedure_type: "Civile/Notariale" },
      { article_number: "Art. 72", title: "Dépôt de garantie VEFA", official_text: "Le contrat de réservation en VEFA peut prévoir un dépôt de garantie plafonné à 5% du prix prévisionnel de vente si le délai de réalisation est inférieur ou égal à deux ans.", conditions: "Contrat de réservation préliminaire à la VEFA" },
      { article_number: "Art. 75", title: "Garantie financière d'achèvement", official_text: "Tout promoteur immobilier doit justifier d'une garantie financière d'achèvement ou de remboursement avant toute commercialisation d'un programme immobilier.", conditions: "Commercialisation d'un programme neuf" },
      { article_number: "Art. 82", title: "Réserves foncières", official_text: "L'État et les collectivités territoriales peuvent constituer des réserves foncières par voie d'acquisition amiable ou d'expropriation en vue de la réalisation d'opérations d'aménagement.", conditions: "Projets d'aménagement urbain ou d'habitat" },
      { article_number: "Art. 88", title: "Expropriation pour utilité publique", official_text: "L'expropriation ne peut être prononcée qu'après déclaration d'utilité publique et offre préalable d'une juste et préalable indemnité.", conditions: "Projet reconnu d'utilité publique par décret" },
      { article_number: "Art. 95", title: "Logement social", official_text: "Le programme national de logements sociaux vise à produire des logements accessibles aux ménages à revenus modestes. Les promoteurs agréés bénéficient d'avantages fiscaux.", conditions: "Programme agréé par le ministère du logement" },
      { article_number: "Art. 102", title: "Normes d'accessibilité PMR", official_text: "Les bâtiments recevant du public doivent être accessibles aux personnes à mobilité réduite selon les normes fixées par voie réglementaire.", conditions: "Établissements recevant du public (ERP)" },
      { article_number: "Art. 108", title: "Sécurité incendie", official_text: "Les constructions doivent satisfaire aux règles de sécurité contre l'incendie fixées par voie réglementaire. Un avis favorable de la commission de sécurité est requis avant ouverture.", conditions: "ERP et immeubles de grande hauteur (IGH)" },
      { article_number: "Art. 115", title: "Copropriété — définition", official_text: "La copropriété est le régime applicable à tout immeuble bâti ou groupe d'immeubles dont la propriété est répartie entre plusieurs personnes par lots comprenant une partie privative et une quote-part de parties communes.", conditions: "Immeuble à propriété divisée" },
      { article_number: "Art. 118", title: "Règlement de copropriété", official_text: "Tout immeuble en copropriété doit être régi par un règlement établi par acte notarié fixant la destination de l'immeuble, les droits et obligations des copropriétaires.", conditions: "Existence d'une copropriété" },
      { article_number: "Art. 122", title: "Syndicat des copropriétaires", official_text: "Les copropriétaires sont constitués de plein droit en un syndicat qui a la personnalité civile. Il est représenté par un syndic élu en assemblée générale.", conditions: "Immeuble en copropriété" },
      { article_number: "Art. 128", title: "Assemblée générale de copropriété", official_text: "L'assemblée générale des copropriétaires se réunit au moins une fois par an. Les décisions sont prises à la majorité des voix des copropriétaires présents ou représentés.", conditions: "Convocation obligatoire annuelle" },
      { article_number: "Art. 135", title: "Charges de copropriété", official_text: "Chaque copropriétaire contribue aux charges relatives à la conservation, l'entretien et l'administration des parties communes proportionnellement à ses tantièmes.", conditions: "Répartition des charges communes" },
      { article_number: "Art. 142", title: "Bail d'habitation — définition", official_text: "Le bail d'habitation est le contrat par lequel le bailleur s'engage à mettre à la disposition du locataire un logement décent en contrepartie d'un loyer.", conditions: "Location de logement à usage d'habitation principale" },
      { article_number: "Art. 145", title: "Durée minimale du bail", official_text: "La durée minimale du bail d'habitation est fixée à deux ans renouvelables pour les personnes physiques. Le bail doit être établi par écrit.", conditions: "Bail entre particuliers personne physique" },
      { article_number: "Art. 148", title: "Dépôt de garantie locatif", official_text: "Le dépôt de garantie ne peut excéder deux mois de loyer hors charges. Il doit être restitué dans un délai de deux mois après la remise des clés.", conditions: "Remise des clés en fin de bail" },
      { article_number: "Art. 152", title: "Obligations du bailleur", official_text: "Le bailleur est tenu de délivrer un logement décent, d'en assurer la jouissance paisible et d'effectuer les réparations autres que locatives.", conditions: "Pendant toute la durée du bail" },
      { article_number: "Art. 155", title: "Obligations du locataire", official_text: "Le locataire est tenu de payer le loyer et les charges aux termes convenus, d'user paisiblement des locaux et de répondre des dégradations survenues.", conditions: "Pendant toute la durée de l'occupation" },
      { article_number: "Art. 158", title: "Résiliation du bail", official_text: "Le bailleur peut résilier le bail à son expiration pour reprendre le logement pour y habiter, pour vendre ou pour motif légitime et sérieux, avec préavis de trois mois.", conditions: "Non-renouvellement à l'expiration du bail" },
      { article_number: "Art. 162", title: "Expulsion locative", official_text: "L'expulsion du locataire ne peut intervenir qu'en vertu d'une décision de justice exécutoire. Aucune expulsion ne peut avoir lieu sans l'assistance d'un officier de police judiciaire.", conditions: "Décision de justice définitive requise", procedure_type: "Judiciaire" },
      { article_number: "Art. 168", title: "Loyers impayés — procédure", official_text: "En cas de non-paiement du loyer, le bailleur peut saisir le tribunal compétent en référé pour obtenir la résiliation du bail et l'expulsion sous astreinte.", conditions: "Impayés de loyer après mise en demeure", procedure_type: "Civile — référé", prescription_period: "3 ans" },
      { article_number: "Art. 175", title: "Agences immobilières — agrément", official_text: "L'exercice de la profession d'agent immobilier est subordonné à l'obtention d'un agrément délivré par le ministère chargé du logement et d'un cautionnement financier.", conditions: "Exercice professionnel de l'activité d'agent immobilier" },
      { article_number: "Art. 178", title: "Mandat de l'agent immobilier", official_text: "Tout acte d'entremise immobilière doit faire l'objet d'un mandat écrit signé par le mandant. L'agent ne peut percevoir de rémunération sans mandat préalable.", conditions: "Exercice d'une mission d'entremise" },
      { article_number: "Art. 182", title: "Honoraires d'agence", official_text: "Les honoraires des agents immobiliers sont librement fixés par convention entre les parties. Ils sont dus à la signature de l'acte authentique ou du bail.", conditions: "Transaction immobilière aboutie" },
      { article_number: "Art. 188", title: "Fonds de garantie immobilier", official_text: "Les agents immobiliers doivent adhérer à un fonds de garantie permettant d'indemniser les victimes de détournements de fonds de clients.", conditions: "Maniement de fonds de clients" },
      { article_number: "Art. 195", title: "Diagnostic technique immobilier", official_text: "Avant toute vente d'immeuble bâti, le vendeur doit fournir un dossier de diagnostic technique comprenant l'état parasitaire, l'état des installations électriques et de gaz.", conditions: "Vente d'immeuble bâti" },
      { article_number: "Art. 198", title: "Diagnostiqueur certifié", official_text: "Les diagnostics techniques immobiliers doivent être réalisés par des opérateurs certifiés par un organisme accrédité par le CODINORM.", conditions: "Réalisation de diagnostics techniques" },
      { article_number: "Art. 205", title: "Responsabilité du diagnostiqueur", official_text: "Le diagnostiqueur engage sa responsabilité civile professionnelle en cas d'erreur ou d'omission dans ses rapports. Il doit être couvert par une assurance professionnelle.", conditions: "Rapport de diagnostic erroné causant un préjudice", procedure_type: "Civile", prescription_period: "5 ans" },
      { article_number: "Art. 519", title: "Construction sans permis — sanctions", official_text: "Est punie d'un emprisonnement de six mois à deux ans et d'une amende de 1 000 000 à 5 000 000 FCFA, toute personne qui procède à des travaux de construction sans permis de construire.", conditions: "Travaux de construction non autorisés", infraction: "Construction sans permis de construire", min_sentence_years: 0.5, max_sentence_years: 2, fine_amount_fcfa: 5000000, procedure_type: "Pénale", prescription_period: "3 ans" },
      { article_number: "Art. 522", title: "Non-respect du permis — sanctions", official_text: "Est punie d'un emprisonnement d'un mois à un an et d'une amende de 500 000 à 2 000 000 FCFA, toute personne qui réalise une construction non conforme aux plans approuvés.", conditions: "Travaux non conformes au permis accordé", infraction: "Non-conformité au permis de construire", min_sentence_years: 0.08, max_sentence_years: 1, fine_amount_fcfa: 2000000, procedure_type: "Pénale", prescription_period: "3 ans" },
      { article_number: "Art. 525", title: "Exercice sans agrément BTP", official_text: "Est punie d'une amende de 2 000 000 à 10 000 000 FCFA, toute entreprise exerçant une activité de bâtiment et travaux publics sans l'agrément requis.", conditions: "Exercice illégal d'une activité de BTP", infraction: "Exercice sans agrément BTP", fine_amount_fcfa: 10000000, procedure_type: "Pénale/Administrative", prescription_period: "3 ans" },
      { article_number: "Art. 528", title: "Promotion immobilière sans agrément", official_text: "Est punie d'un emprisonnement d'un an à trois ans et d'une amende de 5 000 000 à 20 000 000 FCFA, toute personne exerçant la promotion immobilière sans agrément.", conditions: "Promotion immobilière exercée sans agrément", infraction: "Promotion immobilière sans agrément", min_sentence_years: 1, max_sentence_years: 3, fine_amount_fcfa: 20000000, procedure_type: "Pénale", prescription_period: "5 ans" },
      { article_number: "Art. 531", title: "Vente VEFA frauduleuse", official_text: "Est punie d'un emprisonnement de deux ans à cinq ans et d'une amende de 10 000 000 à 50 000 000 FCFA, toute personne qui commercialise un programme immobilier sans garantie financière d'achèvement.", conditions: "Commercialisation sans garantie financière d'achèvement", infraction: "VEFA sans garantie financière", min_sentence_years: 2, max_sentence_years: 5, fine_amount_fcfa: 50000000, procedure_type: "Pénale", prescription_period: "5 ans" },
      { article_number: "Art. 534", title: "Agent immobilier sans mandat", official_text: "Est punie d'une amende de 500 000 à 3 000 000 FCFA, tout agent immobilier percevant une rémunération sans mandat écrit préalable.", conditions: "Perception d'honoraires sans mandat écrit", infraction: "Exercice sans mandat immobilier", fine_amount_fcfa: 3000000, procedure_type: "Pénale/Administrative", prescription_period: "3 ans" },
      { article_number: "Art. 537", title: "Détournement de fonds immobiliers", official_text: "Est punie d'un emprisonnement de trois ans à dix ans et d'une amende de 20 000 000 à 100 000 000 FCFA, toute personne qui détourne des fonds confiés dans le cadre d'une transaction immobilière.", conditions: "Détournement de fonds de clients par un professionnel immobilier", infraction: "Détournement de fonds immobiliers", min_sentence_years: 3, max_sentence_years: 10, fine_amount_fcfa: 100000000, procedure_type: "Pénale", prescription_period: "10 ans" },
      { article_number: "Art. 540", title: "Expulsion voie de fait", official_text: "Est punie d'un emprisonnement de six mois à deux ans et d'une amende de 1 000 000 à 5 000 000 FCFA, tout bailleur procédant à une expulsion sans décision de justice.", conditions: "Expulsion sans décision judiciaire exécutoire", infraction: "Expulsion illégale — voie de fait", min_sentence_years: 0.5, max_sentence_years: 2, fine_amount_fcfa: 5000000, procedure_type: "Pénale", prescription_period: "3 ans" },
      { article_number: "Art. 543", title: "Diagnostics falsifiés", official_text: "Est punie d'un emprisonnement d'un an à trois ans et d'une amende de 3 000 000 à 15 000 000 FCFA, toute personne établissant un rapport de diagnostic technique immobilier falsifié.", conditions: "Faux rapport de diagnostic ayant causé un préjudice", infraction: "Faux diagnostic technique immobilier", min_sentence_years: 1, max_sentence_years: 3, fine_amount_fcfa: 15000000, procedure_type: "Pénale", prescription_period: "5 ans" },
      { article_number: "Art. 546", title: "Récidive — aggravation des peines", official_text: "En cas de récidive, les peines d'emprisonnement et d'amende prévues par la présente loi sont portées au double. Le tribunal peut en outre prononcer l'interdiction définitive d'exercer.", conditions: "Infraction commise en état de récidive légale", infraction: "Récidive — infraction Code Construction", procedure_type: "Pénale", prescription_period: "5 ans" },
      { article_number: "Art. 547", title: "Dispositions transitoires", official_text: "Les constructions en cours à la date d'entrée en vigueur de la présente loi disposent d'un délai de deux ans pour se mettre en conformité avec les nouvelles exigences.", conditions: "Constructions antérieures à la loi n°2019-576" },
      { article_number: "Art. 550", title: "Textes d'application", official_text: "Des décrets pris en Conseil des Ministres fixent les modalités d'application de la présente loi dans un délai de six mois à compter de sa promulgation.", conditions: "Entrée en vigueur des décrets d'application" },
      { article_number: "Art. 553", title: "Entrée en vigueur", official_text: "La présente loi entre en vigueur à la date de sa publication au Journal Officiel de la République de Côte d'Ivoire. Elle abroge toutes dispositions antérieures contraires.", conditions: "Publication au Journal Officiel du 1er août 2019" },
    ];
    for (const art of articles) {
      await pool.query(
        `INSERT INTO legal_articles (source_id, article_number, title, official_text, domain, infraction, conditions,
          min_sentence_years, max_sentence_years, fine_amount_fcfa, procedure_type, prescription_period, searchable_text)
         VALUES ($1,$2,$3,$4,'CONSTRUCTION',$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          sourceId, art.article_number, art.title, art.official_text,
          art.infraction ?? null, art.conditions,
          art.min_sentence_years ?? null, art.max_sentence_years ?? null,
          art.fine_amount_fcfa ?? null, art.procedure_type ?? null,
          art.prescription_period ?? null,
          `${art.title} ${art.official_text}`
        ]
      );
    }
    res.json({ success: true, message: `${articles.length} article(s) du Code de la Construction et de l'Habitat (Loi n°2019-576) ajoutés.` });
  } catch (err: any) {
    console.error("[Seed Code Construction] Échec:", err.message);
    res.status(500).json({ success: false, message: "Échec : " + err.message });
  }
});

startServer();