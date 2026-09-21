import React, { useState } from "react";
import { BookOpen, ExternalLink, Search, ShieldCheck } from "lucide-react";

export default function WorkCodePanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search() {
    setLoading(true); setSearched(true);
    try {
      const r = await fetch(`/api/legal/work-code/search?q=${encodeURIComponent(query)}&limit=20`);
      const data = await r.json();
      setResults(data.results || []);
    } finally { setLoading(false); }
  }

  return <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm"><BookOpen className="w-4 h-4"/> Droit du travail — Côte d’Ivoire</div>
            <h1 className="text-2xl font-black mt-2">Code du Travail ivoirien</h1>
            <p className="text-sm text-slate-500 mt-2">Loi n° 2015-532 du 20 juillet 2015 — édition 2021.</p>
          </div>
          <a href="https://www.economie-ivoirienne.ci/sites/default/files/sites/default/files/inline-files/Loi%20n%C2%B0%202015-532%20du%2020%20juillet%202015%20portant%20code%20du%20Travail.pdf" target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"><ExternalLink className="w-3.5 h-3.5"/> Source PDF</a>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2"><ShieldCheck className="w-4 h-4"/> Référentiel à valider par le Tribunal avant toute utilisation comme source institutionnelle.</div>
        <div className="mt-4 flex gap-2">
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="Ex. licenciement, salaire, conciliation, article 81.18..." className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-200" />
          <button onClick={search} className="px-4 py-3 rounded-xl bg-emerald-700 text-white font-bold text-sm inline-flex items-center gap-2"><Search className="w-4 h-4"/>{loading?'Recherche…':'Rechercher'}</button>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {!searched && <div className="p-8 text-sm text-slate-500">Recherchez un article ou un sujet dans le Code du Travail.</div>}
        {searched && !loading && !results.length && <div className="p-8 text-sm text-slate-500">Aucun résultat.</div>}
        {results.map((r,i)=><article key={`${r.article}-${i}`} className="p-5">
          <div className="flex items-center justify-between gap-3"><span className="font-black text-slate-900">Article {r.article}</span>{r.page&&<span className="text-[11px] text-slate-400">p. {r.page}</span>}</div>
          <p className="text-sm text-slate-700 leading-6 mt-2 whitespace-pre-line">{r.text}</p>
        </article>)}
      </div>
    </div>
  </section>;
}