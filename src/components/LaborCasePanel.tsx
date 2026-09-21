import React, { useEffect, useState } from "react";
import { BriefcaseBusiness, CalendarDays, FileText, Plus, RefreshCw, Upload, CheckCircle2, Search } from "lucide-react";

type CaseRow = {
  id:number; dossier_id:number; dossier_number:string; title:string; employee_name:string;
  employer_name:string; current_step:string; created_at:string;
};

const PREPARATION_STEPS = ["BROUILLON","PREPARATION","PRET_A_REVUE"];

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
    contract_type:"CDI", dispute_type:"Rupture / licenciement", description:"",
  });
  const [event,setEvent]=useState({
    status:"PREPARATION",title:"",description:"",event_date:new Date().toISOString().slice(0,10)
  });
  const [doc,setDoc]=useState({
    document_type:"CONTRAT",document_name:"",required:true,file:null as File|null
  });

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
      setShowForm(false);setForm({...form,title:"",description:""});await load();await openCase(d.dossier_id);
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
      await openCase(selected.dossier_id);setEvent({...event,title:"",description:""});
    } catch(e:any){setError(e.message||"Événement impossible.");}
  }
  async function addDocument(e:React.FormEvent){
    e.preventDefault();if(!selected||!doc.document_name)return;
    try {
      let content_base64="",mime_type="",file_size=0;
      if(doc.file){
        file_size=doc.file.size;mime_type=doc.file.type||"application/octet-stream";
        content_base64=await new Promise<string>((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");reader.onerror=reject;reader.readAsDataURL(doc.file as File);
        });
      }
      await api("/api/travail/dossiers/"+selected.dossier_id+"/documents",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        document_type:doc.document_type,document_name:doc.document_name,required:doc.required,content_base64,mime_type,file_size
      })});
      await openCase(selected.dossier_id);setDoc({...doc,document_name:"",file:null});
    } catch(e:any){setError(e.message||"Pièce impossible.");}
  }
  async function markReady(){
    if(!selected)return;
    try {
      await api("/api/travail/dossiers/"+selected.dossier_id+"/prepare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"PRET_A_REVUE"})});
      await openCase(selected.dossier_id);await load();
    } catch(e:any){setError(e.message||"Impossible de marquer le dossier comme prêt.");}
  }

  return <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 sm:p-7 bg-gradient-to-br from-[#10253f] via-[#17466b] to-[#146c73] text-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-cyan-100 text-sm font-bold"><BriefcaseBusiness className="w-4 h-4"/> Préparation — Droit du travail</div>
            <h2 className="text-2xl font-black mt-2">Construire mon dossier de travail</h2>
            <p className="text-sm text-cyan-50/90 mt-1">JurisCoach organise les faits, la chronologie, les pièces et les informations utiles à l’analyse juridique.</p>
          </div>
          <button onClick={()=>setShowForm(!showForm)} className="shrink-0 px-3 py-2.5 rounded-xl bg-white text-slate-900 font-black text-xs inline-flex items-center gap-1.5"><Plus className="w-4 h-4"/>{showForm?"Fermer":"Nouveau dossier"}</button>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <b>Important :</b> JurisCoach est un assistant juridique. Ce module sert à préparer et organiser votre dossier.
          Il ne constitue pas une saisine officielle, ne remplace pas le Tribunal du Travail et ne produit aucune décision judiciaire.
        </div>
        {error&&<div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">{error}</div>}

        {showForm&&<form onSubmit={createCase} className="mb-6 border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="font-black text-slate-900">1. Identification de la situation</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              ["title","Titre du dossier","Ex. Litige salaire — Société X"],["employee_name","Salarié","Nom et prénoms"],
              ["employee_phone","Téléphone salarié","+225…"],["employee_email","Email salarié",""],["employer_name","Employeur","Raison sociale"],
              ["employer_contact","Contact employeur",""],["employment_start","Début de relation de travail",""],["employment_end","Fin / rupture (si applicable)",""],
            ].map(([k,label,ph])=><label key={k} className="text-xs font-bold text-slate-600">{label}
              <input type={k.includes("email")?"email":k.includes("start")||k.includes("end")?"date":"text"} value={(form as any)[k]} onChange={e=>setField(k,e.target.value)} placeholder={ph} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"/>
            </label>)}
            <label className="text-xs font-bold text-slate-600">Type de contrat
              <select value={form.contract_type} onChange={e=>setField("contract_type",e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"><option>CDI</option><option>CDD</option><option>Apprentissage</option><option>Travail temporaire</option><option>Autre</option><option>Inconnu</option></select>
            </label>
            <label className="text-xs font-bold text-slate-600">Nature du litige
              <select value={form.dispute_type} onChange={e=>setField("dispute_type",e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"><option>Rupture / licenciement</option><option>Salaires / accessoires</option><option>Congés</option><option>Accident du travail / maladie professionnelle</option><option>Exécution du contrat</option><option>Harcèlement / discrimination</option><option>Autre</option></select>
            </label>
          </div>
          <label className="text-xs font-bold text-slate-600">Exposé initial
            <textarea rows={5} value={form.description} onChange={e=>setField("description",e.target.value)} placeholder="Exposez les faits connus. JurisCoach pourra ensuite poser des questions pour compléter la situation." className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal resize-none"/>
          </label>
          <button disabled={saving||!form.title||!form.employee_name||!form.employer_name} className="w-full py-3.5 rounded-2xl bg-slate-900 text-white font-black text-sm disabled:opacity-50">{saving?"Création…":"Créer le dossier de préparation"}</button>
        </form>}

        <div className="grid lg:grid-cols-[280px_1fr] gap-5">
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-3 bg-slate-50 flex items-center justify-between"><span className="text-xs font-black">Mes préparations</span><button onClick={load} className="p-1.5"><RefreshCw className="w-3.5 h-3.5"/></button></div>
            {loading?<div className="p-5 text-xs text-slate-400">Chargement…</div>:cases.length?cases.map(c=><button key={c.id} onClick={()=>openCase(c.dossier_id)} className={"w-full text-left p-3 border-t border-slate-100 "+(selected?.dossier_id===c.dossier_id?"bg-emerald-50":"hover:bg-slate-50")}><p className="text-xs font-black">{c.dossier_number}</p><p className="text-sm font-bold mt-1">{c.title}</p><p className="text-[11px] text-slate-500 mt-1">{c.employee_name} · {c.employer_name}</p><span className="inline-block mt-2 text-[10px] font-bold bg-slate-100 rounded-full px-2 py-1">{c.current_step}</span></button>):<p className="p-5 text-xs text-slate-400">Aucune préparation.</p>}
          </div>

          <div className="min-h-[360px]">
            {!selected?<div className="h-full border border-dashed border-slate-300 rounded-2xl flex items-center justify-center text-sm text-slate-400 p-8 text-center">Sélectionnez une préparation ou créez-en une nouvelle.</div>:
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-2xl p-5">
                <div className="flex justify-between gap-3"><div><p className="text-[10px] uppercase text-emerald-700 font-black">{selected.dossier_number}</p><h3 className="text-xl font-black mt-1">{selected.title}</h3></div><span className="h-fit text-[10px] font-black bg-emerald-50 text-emerald-800 px-2.5 py-1.5 rounded-full">{selected.current_step}</span></div>
                <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm"><div><b>Salarié :</b> {selected.employee_name}</div><div><b>Employeur :</b> {selected.employer_name}</div><div><b>Contrat :</b> {selected.contract_type||"—"}</div><div><b>Litige :</b> {selected.dispute_type||"—"}</div><div><b>Début :</b> {selected.employment_start||"—"}</div><div><b>Fin / rupture :</b> {selected.employment_end||"—"}</div></div>
                {selected.description&&<div className="mt-4 bg-slate-50 rounded-xl p-3 text-xs leading-5">{selected.description}</div>}
              </div>

              <div className="border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3 mb-3"><p className="text-xs font-black">Parcours de préparation</p><button onClick={markReady} disabled={selected.current_step==="PRET_A_REVUE"} className="text-[11px] font-black px-3 py-2 rounded-xl bg-emerald-700 text-white disabled:opacity-40 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/>Marquer prêt pour revue</button></div>
                <div className="flex flex-wrap gap-1.5">{PREPARATION_STEPS.map(s=><span key={s} className={"text-[10px] px-2 py-1 rounded-full font-bold "+(s===selected.current_step?"bg-emerald-700 text-white":"bg-slate-100 text-slate-500")}>{s}</span>)}</div>
                <p className="text-[11px] text-slate-400 mt-3">Ces états décrivent uniquement votre préparation dans JurisCoach. Ils ne sont pas des statuts judiciaires.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <form onSubmit={addEvent} className="border border-slate-200 rounded-2xl p-4"><p className="text-xs font-black mb-3">Chronologie / événement</p>
                  <input value={event.title} onChange={e=>setEvent({...event,title:e.target.value})} placeholder="Titre de l'événement" className="w-full border rounded-xl px-3 py-2 text-xs mb-2"/>
                  <input type="date" value={event.event_date} onChange={e=>setEvent({...event,event_date:e.target.value})} className="w-full border rounded-xl px-3 py-2 text-xs mb-2"/>
                  <textarea value={event.description} onChange={e=>setEvent({...event,description:e.target.value})} placeholder="Ce qui s'est passé, preuve associée, point à vérifier…" rows={3} className="w-full border rounded-xl px-3 py-2 text-xs mb-2 resize-none"/>
                  <button className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black inline-flex justify-center items-center gap-1"><CalendarDays className="w-3.5 h-3.5"/>Ajouter à la chronologie</button>
                </form>

                <form onSubmit={addDocument} className="border border-slate-200 rounded-2xl p-4"><p className="text-xs font-black mb-3">Pièces justificatives</p>
                  <select value={doc.document_type} onChange={e=>setDoc({...doc,document_type:e.target.value})} className="w-full border rounded-xl px-3 py-2 text-xs mb-2"><option>CONTRAT</option><option>BULLETINS_SALAIRE</option><option>LETTRE_RUPTURE</option><option>CORRESPONDANCE</option><option>IDENTITE</option><option>PREUVES</option><option>ATTESTATION</option><option>AUTRE</option></select>
                  <input value={doc.document_name} onChange={e=>setDoc({...doc,document_name:e.target.value})} placeholder="Nom de la pièce" className="w-full border rounded-xl px-3 py-2 text-xs mb-2"/>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={e=>setDoc({...doc,file:e.target.files?.[0]||null})} className="w-full text-xs mb-2"/>
                  <label className="flex items-center gap-2 text-xs mb-2"><input type="checkbox" checked={doc.required} onChange={e=>setDoc({...doc,required:e.target.checked})}/> Pièce à vérifier / requise</label>
                  <button className="w-full py-2.5 rounded-xl bg-emerald-700 text-white text-xs font-black inline-flex justify-center items-center gap-1"><Upload className="w-3.5 h-3.5"/>Ajouter la pièce</button>
                </form>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5"><div className="flex items-center justify-between mb-3"><p className="text-xs font-black">Chronologie</p><span className="text-[10px] text-slate-400">{selected.events?.length||0} événement(s)</span></div>
                {selected.events?.length?selected.events.map((x:any)=><div key={x.id} className="border-l-2 border-slate-200 pl-3 mb-3"><p className="text-xs font-bold">{x.title}</p><p className="text-[11px] text-slate-500">{x.event_date} — {x.description||"—"}</p></div>):<p className="text-xs text-slate-400">Aucun événement.</p>}
              </div>
              <div className="border border-slate-200 rounded-2xl p-5"><p className="text-xs font-black mb-3">Pièces enregistrées</p>
                {selected.documents?.length?selected.documents.map((x:any)=><div key={x.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0"><span className="text-xs"><FileText className="inline w-3.5 h-3.5 mr-1"/>{x.document_name}</span><span className="text-[10px] text-slate-500">{x.document_type}{x.required?" · à vérifier":""}{x.file_size?" · "+Math.round(x.file_size/1024)+" Ko":""}</span></div>):<p className="text-xs text-slate-400">Aucune pièce enregistrée.</p>}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <button onClick={()=>window.scrollTo({top:0,behavior:"smooth"})} className="py-3 rounded-2xl border border-slate-200 text-slate-700 font-black text-sm inline-flex items-center justify-center gap-2"><Search className="w-4 h-4"/>Rechercher dans le Code du Travail</button>
                <div className="py-3 rounded-2xl bg-slate-50 text-slate-500 text-xs font-bold flex items-center justify-center text-center px-4">Utilisez le module « Code du travail » pour vérifier les textes applicables.</div>
              </div>
            </div>}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
