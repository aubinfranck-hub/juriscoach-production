import React, { useState } from "react";
import { AlertTriangle, FileText, Loader2, Scale, Home, BriefcaseBusiness, Users, ShieldAlert } from "lucide-react";
import LegalTemplatePicker, { LEGAL_TEMPLATES } from "./LegalTemplatePicker";

interface Question { id: number; question: string; field_name: string; type: string; options: string[]; }
interface ArticleCite { article_number: string; source?: string; title: string; text: string; }
interface DiagnosisResult {
  primary_qualification: string; secondary_qualifications?: string[]; pertinence_score?: number; confidence_level?: string;
  constitutive_elements?: string[]; applicable_articles?: ArticleCite[];
  sentences?: { min_years?: number; max_years?: number; min_fine?: number; max_fine?: number };
  evidence_needed?: string[]; procedure?: string; prescription_info?: string; risk_level?: string; missing_information?: string[];
}
type Stage = "description" | "questions" | "results";

const privateDomains = [
  { icon: Home, title: "Logement & Terrains", text: "Bail, loyer, caution, parcelles, ACD, litiges fonciers", tone: "emerald" },
  { icon: BriefcaseBusiness, title: "Travail & Salaire", text: "Contrat, licenciement, CNPS, salaire, indemnités", tone: "orange" },
  { icon: Users, title: "Famille & Héritage", text: "Mariage, filiation, pension, succession, partage", tone: "violet" },
  { icon: ShieldAlert, title: "Urgence Police & Plainte", text: "Garde à vue, plainte, escroquerie, cybercriminalité", tone: "rose" },
];
const proDomains = [
  { title: "Création & CEPICI", text: "Statuts, RCCM, formalités", icon: "🏢" },
  { title: "Contrats & Salariés", text: "Contrats, RH, conformité", icon: "📄" },
  { title: "Factures & Impayés", text: "Recouvrement, injonction de payer", icon: "💰" },
  { title: "Baux commerciaux", text: "Renouvellement, loyer, résiliation", icon: "🏪" },
];

export default function DiagnosticScreen({ token, onLive }: { token: string; onLive: () => void }) {
  const [stage, setStage] = useState<Stage>("description");
  const [description, setDescription] = useState("");
  const [diagnosticId, setDiagnosticId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("accueil");

  const handleSubmitDescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 10) { setError("Décrivez la situation en au moins quelques mots."); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/diagnostic/penal", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description, template_id: selectedTemplateId, template_title: LEGAL_TEMPLATES.find((t) => t.id === selectedTemplateId)?.title }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Échec."); return; }
      setDiagnosticId(data.diagnostic_id); setQuestions(data.current_question_set || []); setAnswers({}); setStage("questions");
    } catch (err: any) { setError(`Erreur réseau : ${err?.message || "cause inconnue"}.`); }
    finally { setLoading(false); }
  };

  const handleSubmitAnswers = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await fetch("/api/diagnostic/penal/analyze", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ diagnostic_id: diagnosticId, answers }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Échec de l'analyse."); return; }
      setResult(data); setStage("results");
    } catch (err: any) { setError(`Erreur réseau : ${err?.message || "cause inconnue"}.`); }
    finally { setLoading(false); }
  };

  const handleRestart = () => { setStage("description"); setDescription(""); setDiagnosticId(null); setQuestions([]); setAnswers({}); setResult(null); setError(null); };

  const handleTemplateLive = () => {
    const template = LEGAL_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (template) sessionStorage.setItem("juriscoach_live_context", JSON.stringify({ id: template.id, title: template.title, description: template.description }));
    onLive();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#063f32] via-[#075c48] to-[#0c7660] p-5 sm:p-8 text-white shadow-xl">
        <div className="absolute -right-16 -top-16 w-48 h-48 rounded-full bg-orange-400/15" />
        <div className="absolute -left-10 -bottom-20 w-40 h-40 rounded-full bg-white/10" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">
            <Scale className="w-3.5 h-3.5" /> JurisCoach Côte d'Ivoire
          </div>
          <h1 className="mt-4 text-2xl sm:text-4xl font-black tracking-tight">Vos problèmes juridiques, en langage simple.</h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base text-emerald-50/90">Décrivez votre situation. JurisCoach vous aide à structurer les faits, identifier les points juridiques et préparer la prochaine étape.</p>
          <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-semibold">
            <span className="rounded-full bg-white/10 px-3 py-1.5">🇨🇮 Droit ivoirien</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">📱 Mobile & tablette</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">🔒 Confidentiel</span>
          </div>
        </div>
      </section>

      <LegalTemplatePicker
        selectedId={selectedTemplateId}
        onSelect={(id) => { setSelectedTemplateId(id); setDescription(""); setError(null); }}
        description={description}
        setDescription={setDescription}
        onSubmit={handleSubmitDescription}
        onLive={handleTemplateLive}
        loading={loading}
      />

      {error && <div className="mt-5 bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-700 flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

      {stage === "questions" && (
        <form onSubmit={handleSubmitAnswers} className="mt-5 space-y-4">
          <div className="rounded-[24px] bg-white border border-slate-200 p-5"><p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Étape 2 · Clarification</p><p className="text-sm text-slate-600 mt-1">{description}</p></div>
          {questions.map((q) => <div key={q.id} className="rounded-[20px] bg-white border border-slate-200 p-4 sm:p-5">
            <p className="text-sm text-slate-900 font-bold mb-3">{q.question}</p>
            {q.type === "radio" && q.options?.length ? <div className="flex flex-wrap gap-2">{q.options.map((opt) => <button key={opt} type="button" onClick={() => setAnswers({ ...answers, [q.field_name]: opt })} className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer border transition ${answers[q.field_name] === opt ? "bg-emerald-700 border-emerald-700 text-white" : "bg-slate-50 border-slate-200 text-slate-700 hover:border-emerald-300"}`}>{opt}</button>)}</div> : <input type="text" value={answers[q.field_name] || ""} onChange={(e) => setAnswers({ ...answers, [q.field_name]: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900" />}
          </div>)}
          <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-black py-3.5 rounded-2xl cursor-pointer">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}{loading ? "Analyse en cours..." : "Obtenir le résultat"}</button>
        </form>
      )}

      {stage === "results" && result && (
        <div className="mt-5 space-y-4">
          <div className="rounded-[24px] bg-slate-900 text-white p-5 sm:p-6"><p className="text-[10px] uppercase tracking-wider text-orange-400 font-bold">Qualification</p><p className="text-xl font-black mt-1">{result.primary_qualification}</p>{result.confidence_level && <p className="text-xs text-slate-400 mt-1">Confiance : {result.confidence_level}{result.pertinence_score != null && ` · ${result.pertinence_score}%`}</p>}</div>
          {result.applicable_articles?.length ? <div className="rounded-[20px] bg-white border border-slate-200 p-5 space-y-3"><p className="text-xs uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Articles cités</p>{result.applicable_articles.map((art,i)=><div key={i} className="border-l-2 border-emerald-600 pl-3"><p className="text-sm text-slate-900 font-bold">{art.article_number} — {art.title}</p><p className="text-xs text-slate-500 mt-1">{art.text}</p>{art.source && <p className="text-[10px] text-slate-400 mt-1">Source : {art.source}</p>}</div>)}</div> : <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-800">Aucun article correspondant n'est encore disponible dans la base pour cette analyse.</div>}
          {result.sentences && (result.sentences.min_years != null || result.sentences.min_fine != null) && <div className="rounded-2xl bg-white border border-slate-200 p-5"><p className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">Peines renseignées dans la base</p><p className="text-sm text-slate-700">{result.sentences.min_years}-{result.sentences.max_years} ans{result.sentences.min_fine != null && `, amende ${result.sentences.min_fine?.toLocaleString("fr-FR")}-${result.sentences.max_fine?.toLocaleString("fr-FR")} FCFA`}</p>{result.prescription_info && <p className="text-xs text-slate-400 mt-1">Prescription : {result.prescription_info}</p>}</div>}
          {result.constitutive_elements?.length ? <div className="rounded-2xl bg-white border border-slate-200 p-5"><p className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">Éléments à vérifier</p><ul className="space-y-1">{result.constitutive_elements.map((el,i)=><li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-orange-500">•</span>{el}</li>)}</ul></div> : null}
          {result.missing_information?.length ? <div className="rounded-2xl bg-orange-50 border border-orange-200 p-5"><p className="text-xs uppercase tracking-wider text-orange-700 font-bold mb-2">Informations manquantes</p><ul className="space-y-1">{result.missing_information.map((el,i)=><li key={i} className="text-sm text-orange-800 flex gap-2"><span>•</span>{el}</li>)}</ul></div> : null}
          <p className="text-[11px] text-slate-400 text-center px-4">Aide informative : JurisCoach ne remplace pas l'avis d'un avocat.</p>
          <button onClick={handleRestart} className="w-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold py-3.5 rounded-2xl cursor-pointer">Nouvelle analyse</button>
        </div>
      )}
    </div>
  );
}
