import React, { useState } from "react";
import { BookOpen, ExternalLink, Search, ShieldCheck, Scale, Loader2, FileText } from "lucide-react";

interface Question { id:number; question:string; field_name:string; type:string; options:string[]; }
interface Result { qualification:string; confidence_level?:string; applicable_articles?:any[]; facts_to_verify?:string[]; procedure_steps?:string[]; documents_needed?:string[]; missing_information?:string[]; warnings?:string[]; source_status?:string; }

export default function WorkCodePanel({ token }: { token:string }) {
  const [mode,setMode]=useState<"search"|"diagnostic">("search");
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [description,setDescription]=useState("");
  const [stage,setStage]=useState<"description"|"questions"|"results">("description");
  const [diagnosticId,setDiagnosticId]=useState<number|null>(null);
  const [questions,setQuestions]=useState<Question[]>([]);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");

  async function search(){
    if(query.trim().length<2)return;
    setLoading(true);setError("");
    try{const r=await fetch("/api/legal/work-code/search?q="+encodeURIComponent(query)+"&limit=20",{headers:{Authorization:"Bearer "+token}});const d=await r.json();if(!d.success)throw new Error(d.message);setResults(d.results||[]);}
    catch(e:any){setError(e.message||"Recherche impossible.");}finally{setLoading(false);}
  }
  async function startDiagnostic(e:React.FormEvent){
    e.preventDefault();if(description.trim().length<10)return;
    setLoading(true);setError("");
    try{const r=await fetch("/api/diagnostic/travail",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({description})});const d=await r.json();if(!d.success)throw new Error(d.message);setDiagnosticId(d.diagnostic_id);setQuestions(d.current_question_set||[]);setAnswers({});setStage("questions");}
    catch(e:any){setError(e.message||"Impossible de démarrer l'analyse.");}finally{setLoading(false);}
  }
  async function analyze(e:React.FormEvent){
    e.preventDefault();setLoading(true);setError("");
    try{const r=await fetch("/api/diagnostic/travail/analyze",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({diagnostic_id:diagnosticId,answers})});const d=await r.json();if(!d.success)throw new Error(d.message);setResult(d);setStage("results");}
    catch(e:any){setError(e.message||"Analyse impossible.");}finally{setLoading(false);}
  }
  function restart(){setStage("description");setDescription("");setDiagnosticId(null);setQuestions([]);setAnswers({});setResult(null);setError("");}

  return <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 sm:p-7 bg-gradient-to-br from-[#063f32] via-[#075c48] to-[#0c7660] text-white">
        <div className="flex items-center gap-2 text-emerald-100 text-sm font-bold"><BookOpen className="w-4 h-4"/> Droit du travail — Côte d’Ivoire</div>
        <h1 className="text-2xl sm:text-3xl font-black mt-2">Code du Travail ivoirien</h1>
        <p className="text-sm text-emerald-50/90 mt-2">Loi n° 2015-532 du 20 juillet 2015 — édition 2021.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={()=>setMode("search")} className={"px-3 py-2 rounded-xl text-xs font-bold "+(mode==="search"?"bg-white text-emerald-800":"bg-white/10 text-white")}>Recherche juridique</button>
          <button onClick={()=>setMode("diagnostic")} className={"px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 "+(mode==="diagnostic"?"bg-white text-emerald-800":"bg-white/10 text-white")}><Scale className="w-3.5 h-3.5"/> Analyser une situation</button>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-5"><ShieldCheck className="w-4 h-4"/> Référentiel à valider par le Tribunal avant utilisation institutionnelle.</div>
        {error&&<div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">{error}</div>}

        {mode==="search"&&<><div className="flex gap-2">
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder="licenciement, salaire, conciliation, article 81.18…" className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200"/>
          <button onClick={search} disabled={loading} className="px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm inline-flex items-center gap-2">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<Search className="w-4 h-4"/>}Rechercher</button>
        </div>
        <div className="mt-5 divide-y divide-slate-100">
          {results.map((r,i)=><article key={i} className="py-5"><div className="flex items-center gap-2"><FileText className="w-4 h-4 text-emerald-700"/><span className="font-black">Article {r.article}</span></div><p className="text-sm text-slate-700 leading-6 mt-2 whitespace-pre-line">{r.text}</p></article>)}
          {!results.length&&<p className="text-sm text-slate-400 py-5">Recherchez une disposition du Code du Travail.</p>}
        </div>
        <a href="https://www.economie-ivoirienne.ci/sites/default/files/sites/default/files/inline-files/Loi%20n%C2%B0%202015-532%20du%2020%20juillet%202015%20portant%20code%20du%20Travail.pdf" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-emerald-700"><ExternalLink className="w-3.5 h-3.5"/> Ouvrir le PDF officiel</a>
        </>}

        {mode==="diagnostic"&&stage==="description"&&<form onSubmit={startDiagnostic}>
          <div className="mb-4"><p className="text-lg font-black text-slate-900">Décrivez votre situation de travail</p><p className="text-sm text-slate-500 mt-1">Contrat, salaire, licenciement, congés, rupture, litige avec l'employeur, etc.</p></div>
          <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={6} placeholder="Ex. Mon contrat a été rompu et je souhaite comprendre les démarches et les pièces à réunir…" className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-emerald-200"/>
          <button disabled={loading||description.trim().length<10} className="mt-4 w-full py-3.5 rounded-2xl bg-emerald-700 text-white font-black text-sm disabled:opacity-50">{loading?"Préparation…":"Commencer l'analyse"}</button>
        </form>}

        {mode==="diagnostic"&&stage==="questions"&&<form onSubmit={analyze} className="space-y-4">
          <div><p className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">Clarification des faits</p><p className="text-sm text-slate-600 mt-1">{description}</p></div>
          {questions.map(q=><div key={q.id} className="border border-slate-200 rounded-2xl p-4"><p className="text-sm font-bold text-slate-900 mb-3">{q.question}</p>{q.type==="radio"&&q.options?.length?<div className="flex flex-wrap gap-2">{q.options.map(o=><button type="button" key={o} onClick={()=>setAnswers({...answers,[q.field_name]:o})} className={"px-3 py-2 rounded-xl text-xs font-bold border "+(answers[q.field_name]===o?"bg-emerald-700 text-white border-emerald-700":"bg-slate-50 border-slate-200")}>{o}</button>)}</div>:<input value={answers[q.field_name]||""} onChange={e=>setAnswers({...answers,[q.field_name]:e.target.value})} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"/>}</div>)}
          <button disabled={loading} className="w-full py-3.5 rounded-2xl bg-slate-900 text-white font-black text-sm">{loading?"Analyse…":"Analyser avec le Code du Travail"}</button>
        </form>}

        {mode==="diagnostic"&&stage==="results"&&result&&<div className="space-y-4">
          <div className="rounded-2xl bg-slate-900 text-white p-5"><p className="text-[10px] uppercase text-emerald-300 font-bold">Synthèse documentaire</p><p className="text-xl font-black mt-1">{result.qualification}</p><p className="text-xs text-slate-400 mt-1">Confiance : {result.confidence_level||"—"}</p></div>
          {result.applicable_articles?.length?<div className="border border-slate-200 rounded-2xl p-5"><p className="text-xs uppercase text-slate-500 font-bold mb-3">Dispositions retrouvées</p>{result.applicable_articles.map((a:any,i)=><div key={i} className="border-l-2 border-emerald-600 pl-3 mb-4"><p className="font-bold text-sm">{a.article_number} — {a.title}</p><p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{a.text}</p></div>)}</div>:null}
          {result.facts_to_verify?.length?<List title="Faits à vérifier" items={result.facts_to_verify}/>:null}
          {result.procedure_steps?.length?<List title="Étapes / démarches à vérifier" items={result.procedure_steps}/>:null}
          {result.documents_needed?.length?<List title="Pièces utiles" items={result.documents_needed}/>:null}
          {result.missing_information?.length?<List title="Informations manquantes" items={result.missing_information}/>:null}
          {result.warnings?.length?<List title="Points de vigilance" items={result.warnings}/>:null}
          <p className="text-[11px] text-slate-400 text-center">Source : Code du Travail ivoirien. Validation institutionnelle requise avant usage officiel.</p>
          <button onClick={restart} className="w-full py-3.5 rounded-2xl bg-emerald-700 text-white font-bold">Nouvelle analyse</button>
        </div>}
      </div>
    </div>
  </section>;
}
function List({title,items}:{title:string,items:string[]}){return <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4"><p className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">{title}</p><ul className="space-y-1">{items.map((x,i)=><li key={i} className="text-sm text-slate-700">• {x}</li>)}</ul></div>}
