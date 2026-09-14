import React, { useState } from "react";
import { Send, Scale, AlertTriangle, FileText, Loader2 } from "lucide-react";

interface Question {
  id: number;
  question: string;
  field_name: string;
  type: string;
  options: string[];
}

interface ArticleCite {
  article_number: string;
  source?: string;
  title: string;
  text: string;
}

interface DiagnosisResult {
  primary_qualification: string;
  secondary_qualifications?: string[];
  pertinence_score?: number;
  confidence_level?: string;
  constitutive_elements?: string[];
  applicable_articles?: ArticleCite[];
  sentences?: { min_years?: number; max_years?: number; min_fine?: number; max_fine?: number };
  evidence_needed?: string[];
  procedure?: string;
  prescription_info?: string;
  risk_level?: string;
  missing_information?: string[];
}

type Stage = "description" | "questions" | "results";

export default function DiagnosticScreen({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>("description");
  const [description, setDescription] = useState("");
  const [diagnosticId, setDiagnosticId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitDescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 10) {
      setError("Décrivez la situation en au moins quelques mots.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostic/penal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "Échec.");
        return;
      }
      setDiagnosticId(data.diagnostic_id);
      setQuestions(data.current_question_set || []);
      const initialAnswers: Record<string, string> = {};
      setAnswers(initialAnswers);
      setStage("questions");
    } catch (err: any) {
      setError(`Erreur réseau : ${err?.message || "cause inconnue"}.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnswers = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostic/penal/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ diagnostic_id: diagnosticId, answers }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "Échec de l'analyse.");
        return;
      }
      setResult(data);
      setStage("results");
    } catch (err: any) {
      setError(`Erreur réseau : ${err?.message || "cause inconnue"}.`);
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = () => {
    setStage("description");
    setDescription("");
    setDiagnosticId(null);
    setQuestions([]);
    setAnswers({});
    setResult(null);
    setError(null);
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 space-y-5">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Diagnostic pénal</h2>
        <p className="text-sm text-slate-400 mt-1">Décrivez une situation, JurisCoach l'analyse à partir de la base juridique ivoirienne.</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {stage === "description" && (
        <form onSubmit={handleSubmitDescription} className="space-y-3">
          <textarea
            required rows={5} placeholder="Ex: Un employé chargé de collecter des paiements pour l'entreprise ne les a jamais remis à la caisse..."
            value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 resize-none"
          />
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl cursor-pointer">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? "Analyse..." : "Continuer"}
          </button>
        </form>
      )}

      {stage === "questions" && (
        <form onSubmit={handleSubmitAnswers} className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">Situation décrite</p>
            <p className="text-sm text-slate-300">{description}</p>
          </div>
          {questions.map((q) => (
            <div key={q.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm text-white font-medium mb-2.5">{q.question}</p>
              {q.type === "radio" && q.options?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt} type="button"
                      onClick={() => setAnswers({ ...answers, [q.field_name]: opt })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border ${
                        answers[q.field_name] === opt
                          ? "bg-amber-600 border-amber-600 text-white"
                          : "bg-slate-950 border-slate-700 text-slate-300"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type="text" value={answers[q.field_name] || ""}
                  onChange={(e) => setAnswers({ ...answers, [q.field_name]: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              )}
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl cursor-pointer">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
            {loading ? "Analyse en cours..." : "Obtenir le diagnostic"}
          </button>
        </form>
      )}

      {stage === "results" && result && (
        <div className="space-y-4">
          <div className="bg-slate-900 border-2 border-amber-600 rounded-2xl p-5">
            <p className="text-xs text-amber-500 uppercase tracking-wider font-semibold mb-1">Qualification retenue</p>
            <p className="text-lg text-white font-display font-bold">{result.primary_qualification}</p>
            {result.confidence_level && (
              <p className="text-xs text-slate-400 mt-1">Confiance : {result.confidence_level}
                {result.pertinence_score != null && ` (${result.pertinence_score}%)`}</p>
            )}
          </div>

          {result.applicable_articles && result.applicable_articles.length > 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Articles cités
              </p>
              {result.applicable_articles.map((art, i) => (
                <div key={i} className="border-l-2 border-amber-600 pl-3">
                  <p className="text-sm text-white font-medium">{art.article_number} — {art.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{art.text}</p>
                  {art.source && <p className="text-[10px] text-slate-500 mt-1">Source : {art.source}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400">
              Aucun article de la base ne correspond précisément — la base est encore en cours de constitution.
            </div>
          )}

          {result.sentences && (result.sentences.min_years != null || result.sentences.min_fine != null) && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Peines encourues</p>
              <p className="text-sm text-slate-300">
                {result.sentences.min_years}-{result.sentences.max_years} ans d'emprisonnement
                {result.sentences.min_fine != null && `, amende ${result.sentences.min_fine?.toLocaleString("fr-FR")}-${result.sentences.max_fine?.toLocaleString("fr-FR")} FCFA`}
              </p>
              {result.prescription_info && <p className="text-xs text-slate-500 mt-1">Prescription : {result.prescription_info}</p>}
            </div>
          )}

          {result.constitutive_elements && result.constitutive_elements.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Éléments constitutifs</p>
              <ul className="space-y-1">
                {result.constitutive_elements.map((el, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-amber-500">•</span>{el}</li>
                ))}
              </ul>
            </div>
          )}

          {result.missing_information && result.missing_information.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-amber-500 font-semibold mb-2">Informations manquantes</p>
              <ul className="space-y-1">
                {result.missing_information.map((el, i) => (
                  <li key={i} className="text-sm text-amber-200/80 flex gap-2"><span>•</span>{el}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-slate-500 text-center px-4">
            Ce diagnostic est une aide informative et ne remplace pas l'avis d'un avocat.
          </p>

          <button onClick={handleRestart}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium py-3 rounded-xl cursor-pointer">
            Nouveau diagnostic
          </button>
        </div>
      )}
    </div>
  );
}
