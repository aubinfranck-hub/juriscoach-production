import React, { useEffect, useState } from "react";
import { BriefcaseBusiness, CalendarDays, CheckCircle2, FileText, Loader2, Plus, RefreshCw, Send, Upload } from "lucide-react";

type CaseRow = {
  id:number; dossier_id:number; dossier_number:string; title:string; employee_name:string;
  employer_name:string; tribunal_status:string; current_step:string; created_at:string;
};

const STEPS = [
  "BROUILLON",
  "PREPARATION",
  "SAISINE_A_VALIDER",
  "RECU",
  "VERIFICATION",
  "COMPLEMENT_REQUIS",
  "COMPLET",
  "CONVOCATION",
  "CONCILIATION",
  "AUDIENCE",
  "DECISION",
  "CLOTURE",
];

export default function LaborCasePanel({token}:{token:string}) {
  const [cases,setCases]=useState<CaseRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [selected,setSelected]=useState<any|null>(null);
  const [showForm,setShowForm]=useState(false);
  const [error,setError]=useState("");
  const [form,setForm]=useState({
    title:"", employee_name:"", employee_phone:"", employee_email:"",
    employer_name:"", employer_contact:"", employment_start:"", employment_end:"",
    contract_type:"CDI", dispute_type:"Rupture / licenciement", tribunal:"",
    description:"",
  });
  const [event,setEvent]=useState({status:"VERIFICATION",title:"",description:"",event_date:new Date().toISOString().slice(0,10)});
  const [doc,setDoc]=useState({document_type:"CONTRAT",document_name:"",required:true,file:null as File|null});

  async function api(url:string, options:any={}) {
    const r=await fetch(url,{...options,headers:{Authorization:"Bearer "+token,...(options.headers||{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.success) throw new Error(d.message||"Opération impossible.");
    return d;
  }
  async function load(){
    setLoading(true);setError("");
    try { const d=await api("/api/travail/dossiers"); setCases(d.cases||[]); }
    catch(e:any){setError(e.message||"Impossible de charger les dossiers.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);
  function setField(k:string,v:string){setForm({...form,[k]:v});}
  async function createCase(e:React.FormEvent){
    e.preventDefault(); setSaving(true);setError("");
    try {
      const d=await api("/api/travail/dossiers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      setShowForm(false); setForm({...form,title:"",description:""});
      await load(); await openCase(d.dossier_id);
    } catch(e:any){setError(e.message||"Création impossible.");}
    finally{setSaving(false);}
  }
  async function openCase(id:number){
    try { const d=await api("/api/travail/dossiers/"+id); setSelected(d); }
    catch(e:any){setError(e.message||"Dossier introuvable.");}
  }
  async function addEvent(e:React.FormEvent){
    e.preventDefault(); if(!selected)return;
    try {
      await api("/api/travail/dossiers/"+selected.dossier_id+"/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(event)});
      await openCase(selected.dossier_id);
      setEvent({...event,title:"",description:""});
    } catch(e:any){setError(e.message||"Événement impossible.");}
  }
  async function addDocument(e:React.FormEvent){
    e.preventDefault(); if(!selected||!doc.document_name)return;
    const body={document_type:doc.document_type,document_name:doc.document_name,required:doc.required};
    try {
      await api("/api/travail/dossiers/"+selected.dossier_id+"/documents",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      await openCase(selected.dossier_id);
      setDoc({...doc,document_name:""});
    } catch(e:any){setError(e.message||"Pièce impossible.");}
  }
  async function submit(){
    if(!selected)return;
    try { await api("/api/travail/dossiers/"+selected.dossier_id+"/submit",{method:"POST"}); await openCase(selected.dossier_id); await load(); }
    catch(e:any){setError(e.message||"Saisine impossible.");}
  }

  return <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 sm:p-7 bg-gradient-to-br from-[#10253f] via-[#17466b] to-[#146c73] text-white">
        <div className="flex items-center justify-between gap-3">
          <div><div className="flex items-center gap-2 text-cyan-100 text-sm font-bold"><BriefcaseBusiness className="w-4 h-4"/> Dossiers — Tribunal du Travail</div>
          <h2 className="text-2xl font-black mt-2">Gestion d’un dossier de travail</h2>
          <p className="text-sm text-cyan-50/90 mt-1">Préparation, pièces, chronologie et suivi des étapes. Les transitions institutionnelles restent soumises à validation.</p></div>
          <button onClick={()=>setShowForm(!showForm)} className="shrink-0 px-3 py-2.5 rounded-xl bg-white text-slate-900 font-black text-xs inline-flex items-center gap-1.5"><Plus className="w-4 h-4"/>{showForm?"Fermer":"Nouveau dossier"}</button>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        {error&&<div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">{error}</div>}
        {showForm&&<form onSubmit={createCase} className="mb-6 border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="font-black text-slate-900">1. Identification du litige</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              ["title","Titre du dossier","Ex. Litige salaire — Société X"],
              ["employee_name","Salarié","Nom et prénoms"],
              ["employee_phone","Téléphone salarié","+225…"],
              ["employee_email","Email salarié",""],
              ["employer_name","Employeur","Raison sociale"],
              ["employer_contact","Contact employeur",""],
              ["employment_start","Début de relation de travail",""],
              ["employment_end","Fin / rupture (si applicable)",""],
              ["tribunal","Tribunal / juridiction","À confirmer par le Greffe"],
            ].map(([k,label,ph])=><label key={k} className="text-xs font-bold text-slate-600">{label}<input type={k.includes("email")?"email":k.includes("date")||k.includes("start")||k.includes("end")?"date":"text"} value={(form as any)[k]} onChange={e=>setField(k,e.target.value)} placeholder={ph} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"/></label>)}
            <label className="text-xs font-bold text-slate-600">Type de contrat<select value={form.contract_type} onChange={e=>setField("contract_type",e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"><option>CDI</option><option>CDD</option><option>Apprentissage</option><option>Autre</option><option>Inconnu</option></select></label>
            <label className="text-xs font-bold text-slate-600">Nature du litige<select value={form.dispute_type} onChange={e=>setField("dispute_type",e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"><option>Rupture / licenciement</option><option>Salaires / accessoires</option><option>Congés</option><option>Accident du travail / maladie professionnelle</option><option>Exécution du contrat</option><option>Autre</option></select></label>
          </div>
          <label className="text-xs font-bold text-slate-600">Exposé initial<textarea rows={4} value={form.description} onChange={e=>setField("description",e.target.value)} placeholder="Exposez les faits connus, sans demander à l’application de décider du litige." className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal resize-none"/></label>
          <button disabled={saving||!form.title||!form.employee_name||!form.employer_name} className="w-full py-3.5 rounded-2xl bg-slate-900 text-white font-black text-sm disabled:opacity-50">{saving?"Création…":"Créer le dossier"}</button>
        </form>}

        <div className="grid lg:grid-cols-[280px_1fr] gap-5">
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-3 bg-slate-50 flex items-center justify-between"><span className="text-xs font-black">Mes dossiers</span><button onClick={load} className="p-1.5"><RefreshCw className="w-3.5 h-3.5"/></button></div>
            {loading?<div className="p-5 text-xs text-slate-400">Chargement…</div>:cases.length?cases.map(c=><button key={c.id} onClick={()=>openCase(c.dossier_id)} className={"w-full text-left p-3 border-t border-slate-100 "+(selected?.dossier_id===c.dossier_id?"bg-emerald-50":"hover:bg-slate-50")}><p className="text-xs font-black">{c.dossier_number}</p><p className="text-sm font-bold mt-1">{c.title}</p><p className="text-[11px] text-slate-500 mt-1">{c.employee_name} · {c.employer_name}</p><span className="inline-block mt-2 text-[10px] font-bold bg-slate-100 rounded-full px-2 py-1">{c.current_step}</span></button>):<p className="p-5 text-xs text-slate-400">Aucun dossier travail.</p>}
          </div>

          <div className="min-h-[360px]">
            {!selected?<div className="h-full border border-dashed border-slate-300 rounded-2xl flex items-center justify-center text-sm text-slate-400 p-8 text-center">Sélectionnez un dossier ou créez-en un nouveau.</div>:
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-2xl p-5">
                <div className="flex justify-between gap-3"><div><p className="text-[10px] uppercase text-emerald-700 font-black">{selected.dossier_number}</p><h3 className="text-xl font-black mt-1">{selected.title}</h3></div><span className="h-fit text-[10px] font-black bg-emerald-50 text-emerald-800 px-2.5 py-1.5 rounded-full">{selected.current_step}</span></div>
                <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm"><div><b>Salarié :</b> {selected.employee_name}</div><div><b>Employeur :</b> {selected.employer_name}</div><div><b>Contrat :</b> {selected.contract_type||"—"}</div><div><b>Litige :</b> {selected.dispute_type||"—"}</div><div><b>Tribunal :</b> {selected.tribunal||"À confirmer"}</div><div><b>État :</b> {selected.tribunal_status}</div></div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-black mb-3">Étapes de suivi</p><div className="flex flex-wrap gap-1.5">{STEPS.map(s=><span key={s} className={"text-[10px] px-2 py-1 rounded-full font-bold "+(s===selected.current_step?"bg-emerald-700 text-white":"bg-slate-100 text-slate-500")}>{s}</span>)}</div>
                <p className="text-[11px] text-slate-400 mt-3">Les étapes sont une modélisation applicative du parcours ; leur activation et leur ordre doivent être paramétrés/validés par le Tribunal.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <form onSubmit={addEvent} className="border border-slate-200 rounded-2xl p-4"><p className="text-xs font-black mb-3">Chronologie / événement</p>
                  <select value={event.status} onChange={e=>setEvent({...event,status:e.target.value})} className="w-full border rounded-xl px-3 py-2 text-xs mb-2">{STEPS.map(s=><option key={s}>{s}</option>)}</select>
                  <input value={event.title} onChange={e=>setEvent({...event,title:e.target.value})} placeholder="Titre" className="w-full border rounded-xl px-3 py-2 text-xs mb-2"/>
                  <input type="date" value={event.event_date} onChange={e=>setEvent({...event,event_date:e.target.value})} className="w-full border rounded-xl px-3 py-2 text-xs mb-2"/>
                  <textarea value={event.description} onChange={e=>setEvent({...event,description:e.target.value})} placeholder="Description" rows={3} className="w-full border rounded-xl px-3 py-2 text-xs mb-2 resize-none"/>
                  <button className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black inline-flex justify-center items-center gap-1"><CalendarDays className="w-3.5 h-3.5"/>Ajouter</button>
                </form>

                <form onSubmit={addDocument} className="border border-slate-200 rounded-2xl p-4"><p className="text-xs font-black mb-3">Pièce du dossier</p>
                  <select value={doc.document_type} onChange={e=>setDoc({...doc,document_type:e.target.value})} className="w-full border rounded-xl px-3 py-2 text-xs mb-2"><option>CONTRAT</option><option>BULLETINS_SALAIRE</option><option>LETTRE_RUPTURE</option><option>PV_NON_CONCILIATION</option><option>IDENTITE</option><option>PREUVES</option><option>AUTRE</option></select>
                  <input value={doc.document_name} onChange={e=>setDoc({...doc,document_name:e.target.value})} placeholder="Nom de la pièce" className="w-full border rounded-xl px-3 py-2 text-xs mb-2"/>
                  <label className="flex items-center gap-2 text-xs mb-2"><input type="checkbox" checked={doc.required} onChange={e=>setDoc({...doc,required:e.target.checked})}/> Pièce requise</label>
                  <button className="w-full py-2.5 rounded-xl bg-emerald-700 text-white text-xs font-black inline-flex justify-center items-center gap-1"><Upload className="w-3.5 h-3.5"/>Enregistrer la pièce</button>
                  <p className="text-[10px] text-slate-400 mt-2">Cette étape enregistre la pièce au dossier ; l’envoi binaire sera ajouté avec le stockage GED institutionnel.</p>
                </form>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5"><p className="text-xs font-black mb-3">Chronologie</p>{selected.events?.length?selected.events.map((x:any)=><div key={x.id} className="border-l-2 border-slate-200 pl-3 mb-3"><p className="text-xs font-bold">{x.title} · {x.status}</p><p className="text-[11px] text-slate-500">{x.event_date} — {x.description||"—"}</p></div>):<p className="text-xs text-slate-400">Aucun événement.</p>}</div>
              <div className="border border-slate-200 rounded-2xl p-5"><p className="text-xs font-black mb-3">Pièces</p>{selected.documents?.length?selected.documents.map((x:any)=><div key={x.id} className="flex items-center justify-between py-2 border-b last:border-0"><span className="text-xs"><FileText className="inline w-3.5 h-3.5 mr-1"/>{x.document_name}</span><span className="text-[10px] text-slate-500">{x.document_type}{x.required?" · requise":""}</span></div>):<p className="text-xs text-slate-400">Aucune pièce enregistrée.</p>}</div>

              <button onClick={submit} disabled={selected.current_step!=="BROUILLON"&&selected.current_step!=="PREPARATION"} className="w-full py-3.5 rounded-2xl bg-amber-600 text-white font-black text-sm inline-flex justify-center items-center gap-2 disabled:opacity-40"><Send className="w-4 h-4"/>Soumettre pour validation du Greffe</button>
              <p className="text-[11px] text-slate-400 text-center">La soumission applicative ne vaut pas à elle seule saisine juridiquement valide : le Tribunal doit définir et valider le circuit électronique.</p>
            </div>}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
