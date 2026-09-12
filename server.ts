import express from "express";
import cors from "cors";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";

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
      is_admin BOOLEAN NOT NULL DEFAULT false
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
      confidence_level VARCHAR(50),
      constitutive_elements JSONB,
      applicable_texts JSONB,
      sentences JSONB,
      evidence_needed JSONB,
      procedure_type VARCHAR(100),
      prescription_info TEXT,
      missing_information JSONB,
      risk_level VARCHAR(50),
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

// ═══════════════════════════════════════════════════════════════════════
// MOTEUR JURIDIQUE — diagnostic pénal, recherche, dossiers, documents
// Adapté depuis le code généré fourni par l'utilisateur (schéma/logique conservés),
// avec req.user.userId résolu via resolveUserId (téléphone → id) au lieu du JWT d'origine.
// ═══════════════════════════════════════════════════════════════════════

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Pas de JSON trouvé dans la réponse.");
  return JSON.parse(match[0]);
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

    const response = await getAnthropicClient().messages.create({
      model: "claude-opus-5",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Tu es JurisCoach, un système de diagnostic juridique pour la Côte d'Ivoire.

La situation décrite: "${description}"

Génère 5 questions structurées en JSON pour clarifier cette situation pénale. Chaque question doit être numérotée, clairement formulée, avec options de réponse.

Format réponse JSON UNIQUEMENT:
{"questions":[{"id":1,"question":"...","field_name":"...","type":"radio","options":["Oui","Non","Pas certain"]}]}

Focus sur: infraction probable, auteur, victime, élément constitutif, intention, circonstances.`,
      }],
    });

    let questionsData: any;
    try {
      questionsData = extractJson((response.content[0] as any).text);
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

    const response = await getAnthropicClient().messages.create({
      model: "claude-opus-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }],
    });
    const diagnosisData = extractJson((response.content[0] as any).text);

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

    const response = await getAnthropicClient().messages.create({ model: "claude-opus-5", max_tokens: 2500, messages: [{ role: "user", content: prompt }] });
    const content = (response.content[0] as any).text;

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
