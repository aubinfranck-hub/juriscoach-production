import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";

export const WORK_CODE_SOURCE = {
  id: "CI-CODE-TRAVAIL-2015-532",
  title: "Loi n° 2015-532 du 20 juillet 2015 portant Code du Travail",
  edition: "Édition 2021 — Code du Travail ivoirien + Convention Collective Interprofessionnelle",
  jurisdiction: "Côte d'Ivoire",
  pages: 519,
  officialUrl: "https://www.economie-ivoirienne.ci/sites/default/files/sites/default/files/inline-files/Loi%20n%C2%B0%202015-532%20du%2020%20juillet%202015%20portant%20code%20du%20Travail.pdf",
  validationStatus: "A_VALIDER_PAR_LE_TRIBUNAL",
};

type Article = { article: string; page?: number; text: string };
let cache: { articles: Article[]; text: string; loadedAt: string; source: "local" | "remote" } | null = null;

function parseArticles(text: string): Article[] {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n");
  const re = /(?:^|\n)Art(?:icle)?\.?\s+([0-9]+(?:\.[0-9]+)?)\s*\n?/g;
  const matches = [...normalized.matchAll(re)];
  const articles: Article[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : normalized.length;
    const body = normalized.slice(start, end).trim().replace(/\n{3,}/g, "\n\n");
    if (body.length >= 15) articles.push({ article: matches[i][1], text: body });
  }
  return articles;
}

async function loadCorpus() {
  if (cache) return cache;
  const localText = path.join(process.cwd(), "legal", "code-travail-2021.txt");
  if (fs.existsSync(localText)) {
    const text = fs.readFileSync(localText, "utf8");
    cache = { articles: parseArticles(text), text, loadedAt: new Date().toISOString(), source: "local" };
    return cache;
  }
  const response = await fetch(WORK_CODE_SOURCE.officialUrl);
  if (!response.ok) throw new Error(`Téléchargement du Code du Travail impossible: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = await pdfParse(buffer);
  cache = { articles: parseArticles(parsed.text), text: parsed.text, loadedAt: new Date().toISOString(), source: "remote" };
  return cache;
}

export async function workCodeStatus() {
  try {
    const c = await loadCorpus();
    return { available: true, source: c.source, loadedAt: c.loadedAt, articles: c.articles.length, pages: WORK_CODE_SOURCE.pages, validationStatus: WORK_CODE_SOURCE.validationStatus };
  } catch (error: any) {
    return { available: false, source: null, articles: 0, pages: WORK_CODE_SOURCE.pages, validationStatus: WORK_CODE_SOURCE.validationStatus, error: error?.message || "Corpus indisponible" };
  }
}

export async function searchWorkCode(query: string, limit = 20) {
  const c = await loadCorpus();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { source: WORK_CODE_SOURCE, results: c.articles.slice(0, limit) };
  const terms = q.split(/\s+/).filter(Boolean);
  const results = c.articles.map((a) => {
    const hay = `${a.article} ${a.text}`.toLowerCase();
    return { ...a, score: terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0) };
  }).filter((a) => a.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(100, limit)));
  return { source: WORK_CODE_SOURCE, results };
}