import React, { useState, useEffect, useCallback } from "react";
import { UserPlus, Users, BookOpen, Scale, Megaphone, Volume2, Trash2, Power } from "lucide-react";

interface Account {
  phone: string;
  createdAt: number;
  isAdmin: boolean;
  isPro: boolean;
}

export default function AdminPanel({ token }: { token: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [countryCode, setCountryCode] = useState("+225");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ phone: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<{ phone: string; password: string } | null>(null);
  const [seedingPenal, setSeedingPenal] = useState(false);
  const [seedingOhada, setSeedingOhada] = useState(false);
  const [seedingPenal2, setSeedingPenal2] = useState(false);
  const [seedingOhadaSuretes, setSeedingOhadaSuretes] = useState(false);
  const [seedingOhadaRemaining, setSeedingOhadaRemaining] = useState(false);
  const [seedingCodeTravail, setSeedingCodeTravail] = useState(false);
  const [seedingCodeFoncier, setSeedingCodeFoncier] = useState(false);
  const [seedingLoiMariage, setSeedingLoiMariage] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [sponsoredAds, setSponsoredAds] = useState<any[]>([]);
  const [sponsoredStats, setSponsoredStats] = useState<any | null>(null);
  const [adTitle, setAdTitle] = useState("");
  const [adDescription, setAdDescription] = useState("");
  const [adPriority, setAdPriority] = useState("0");
  const [adMaxPlays, setAdMaxPlays] = useState("1");
  const [adAdvertiser, setAdAdvertiser] = useState("");
  const [adCampaignRef, setAdCampaignRef] = useState("");
  const [adPrice1000, setAdPrice1000] = useState("50000");
  const [sponsorReport, setSponsorReport] = useState<any | null>(null);
  const [adFile, setAdFile] = useState<File | null>(null);
  const [adUploading, setAdUploading] = useState(false);
  const [adResult, setAdResult] = useState<string | null>(null);
  const [crmCustomers, setCrmCustomers] = useState<any[]>([]);
  const [crmSearch, setCrmSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [crmEvents, setCrmEvents] = useState<any[]>([]);
  const [crmNote, setCrmNote] = useState("");
  const [crmFollowup, setCrmFollowup] = useState("");
  const [crmStatus, setCrmStatus] = useState("A_FAIRE");
  const [crmLoading, setCrmLoading] = useState(false);

  const [extractText, setExtractText] = useState("");
  const [extractSourceTitle, setExtractSourceTitle] = useState("");
  const [extractDomain, setExtractDomain] = useState("PENAL");
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<string | null>(null);

  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfSourceTitle, setPdfSourceTitle] = useState("");
  const [pdfDomain, setPdfDomain] = useState("PENAL");
  const [pdfStartPage, setPdfStartPage] = useState("");
  const [pdfEndPage, setPdfEndPage] = useState("");
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [pdfResult, setPdfResult] = useState<string | null>(null);
  const [sourcesOverview, setSourcesOverview] = useState<any[] | null>(null);

  const loadSourcesOverview = async () => {
    try {
      const res = await fetch("/api/admin/sources-overview", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSourcesOverview(data.sources || []);
    } catch {
      setSourcesOverview([]);
    }
  };

  const handleExtractFromPdfUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setExtractingPdf(true);
    setPdfResult("Démarrage...");
    try {
      const res = await fetch("/api/admin/extract-from-pdf-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pdfUrl, sourceTitle: pdfSourceTitle, domain: pdfDomain,
          startPage: pdfStartPage ? Number(pdfStartPage) : undefined,
          endPage: pdfEndPage ? Number(pdfEndPage) : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.jobId) {
        setPdfResult(data.message || "Échec.");
        setExtractingPdf(false);
        return;
      }
      // La tâche tourne en arrière-plan côté serveur — on vérifie l'avancement toutes les
      // 4 secondes, sans jamais laisser une seule requête ouverte plusieurs minutes.
      const poll = async () => {
        try {
          const jobRes = await fetch(`/api/admin/extract-job/${data.jobId}`, { headers: { Authorization: `Bearer ${token}` } });
          const job = await jobRes.json();
          if (!job.success) {
            setPdfResult(job.message || "Tâche introuvable.");
            setExtractingPdf(false);
            return;
          }
          if (job.status === "running") {
            setPdfResult(`${job.message} ${job.progress}`.trim());
            setTimeout(poll, 4000);
          } else {
            setPdfResult(job.message);
            setExtractingPdf(false);
          }
        } catch {
          setPdfResult("Connexion perdue pendant le suivi — le traitement continue peut-être en arrière-plan, réessayez de vérifier dans une minute.");
          setExtractingPdf(false);
        }
      };
      poll();
    } catch (err: any) {
      setPdfResult(`Échec réseau : ${err?.message || "cause inconnue"}.`);
      setExtractingPdf(false);
    }
  };

  const [imageSourceTitle, setImageSourceTitle] = useState("");
  const [imageDomain, setImageDomain] = useState("PENAL");
  const [extractingImage, setExtractingImage] = useState(false);
  const [imageExtractResult, setImageExtractResult] = useState<string | null>(null);
  const imageFileInputRef = React.useRef<HTMLInputElement>(null);
  const textFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleTextFileImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setExtractText((reader.result as string) || "");
    reader.readAsText(file, "utf-8");
  };

  const handleExtractFromImage = (file: File) => {
    if (!imageSourceTitle.trim()) {
      setImageExtractResult("Indiquez d'abord le titre de la source.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setExtractingImage(true);
      setImageExtractResult(null);
      try {
        const res = await fetch("/api/admin/extract-from-image", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ imageBase64: reader.result, sourceTitle: imageSourceTitle, domain: imageDomain }),
        });
        const data = await res.json();
        setImageExtractResult(data.message || "Échec.");
      } catch {
        setImageExtractResult("Erreur réseau.");
      } finally {
        setExtractingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    setExtracting(true);
    setExtractResult(null);
    try {
      const res = await fetch("/api/admin/extract-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rawText: extractText, sourceTitle: extractSourceTitle, domain: extractDomain }),
      });
      const data = await res.json();
      setExtractResult(data.message || "Échec.");
      if (data.success) setExtractText("");
    } catch (err: any) {
      // Message précis au lieu de "Erreur réseau" générique, pour diagnostiquer sans aller-retour.
      setExtractResult(`Échec réseau : ${err?.message || err?.name || "cause inconnue"}. Vérifiez la connexion et réessayez.`);
    } finally {
      setExtracting(false);
    }
  };

  const handleSeed = async (endpoint: string, setLoading: (v: boolean) => void) => {
    setLoading(true);
    setSeedResult(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSeedResult(data.message || (data.success ? "Terminé." : "Échec."));
    } catch {
      setSeedResult("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pwd = "";
    for (let i = 0; i < 8; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  };

  const loadCrm = useCallback(async () => {
    setCrmLoading(true);
    try { const r=await fetch("/api/admin/crm/customers?q="+encodeURIComponent(crmSearch),{headers:{Authorization:`Bearer ${token}`}}); const d=await r.json(); if(d.success)setCrmCustomers(d.customers||[]); } catch {} finally { setCrmLoading(false); }
  },[token,crmSearch]);
  const selectCustomer = async (c:any) => { setSelectedCustomer(c); setCrmNote(c.notes||""); setCrmFollowup(c.next_followup_at?String(c.next_followup_at).slice(0,16):""); setCrmStatus(c.followup_status||"A_FAIRE"); try { const r=await fetch("/api/admin/crm/contacts/"+encodeURIComponent(c.phone),{headers:{Authorization:`Bearer ${token}`}}); const d=await r.json(); setCrmEvents(d.events||[]); } catch { setCrmEvents([]); } };
  const saveCustomerCrm = async () => { if(!selectedCustomer)return; await fetch("/api/admin/crm/customers/"+encodeURIComponent(selectedCustomer.phone),{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({notes:crmNote,nextFollowupAt:crmFollowup||null,followupStatus:crmStatus})}); loadCrm(); };
  const logCustomerContact = async () => { if(!selectedCustomer)return; await fetch("/api/admin/crm/contact",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({phone:selectedCustomer.phone,channel:"WHATSAPP",eventType:"RELANCE",subject:"Relance client",notes:crmNote})}); selectCustomer(selectedCustomer); loadCrm(); };
  const loadSponsoredAds = useCallback(async () => {
    try {
      const [adsRes, statsRes] = await Promise.all([
        fetch("/api/admin/sponsored-ads", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/sponsored-stats", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const adsData = await adsRes.json();
      const statsData = await statsRes.json();
      if (adsData.success) setSponsoredAds(adsData.ads || []);
      if (statsData.success) setSponsoredStats(statsData.stats);
    } catch {}
  }, [token]);

  const handleAdUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adFile || !adTitle.trim()) { setAdResult("Titre et fichier audio requis."); return; }
    if (adFile.size > 12 * 1024 * 1024) { setAdResult("Fichier trop volumineux : 12 Mo maximum."); return; }
    setAdUploading(true); setAdResult(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(adFile);
      });
      const res = await fetch("/api/admin/sponsored-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: adTitle.trim(), description: adDescription.trim(),
          audioBase64: dataUrl, mimeType: adFile.type || "audio/mpeg",
          durationSeconds: 0, priority: Number(adPriority) || 0, maxPlaysPerUser: Number(adMaxPlays) || 1, advertiserName: adAdvertiser.trim(), campaignRef: adCampaignRef.trim(), pricePer1000Xaf: Number(adPrice1000) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Échec de l'ajout.");
      setAdResult("Publicité audio ajoutée.");
      setAdTitle(""); setAdDescription(""); setAdAdvertiser(""); setAdCampaignRef(""); setAdFile(null);
      const input = document.getElementById("juriscoach-ad-file") as HTMLInputElement | null;
      if (input) input.value = "";
      loadSponsoredAds();
    } catch (err: any) {
      setAdResult(err.message || "Erreur réseau.");
    } finally { setAdUploading(false); }
  };

  const toggleSponsoredAd = async (ad: any) => {
    await fetch(`/api/admin/sponsored-ads/${ad.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active: !ad.active }),
    });
    loadSponsoredAds();
  };

  const loadSponsorReport = async (id:number) => { try { const r=await fetch(`/api/admin/sponsored-report/${id}`,{headers:{Authorization:`Bearer ${token}`}}); const d=await r.json(); if(d.success)setSponsorReport(d); } catch {} };

  const deleteSponsoredAd = async (id: number) => {
    if (!confirm("Supprimer cette publicité audio ?")) return;
    await fetch(`/api/admin/sponsored-ads/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    loadSponsoredAds();
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setAccounts(data.accounts);
    } catch {
      // silencieux
    }
  }, [token]);

  useEffect(() => { load(); loadSponsoredAds(); loadCrm(); }, [load, loadSponsoredAds, loadCrm]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const generatedPwd = generatePassword();
    const fullPhone = `${countryCode}${phone.replace(/\s+/g, "")}`;
    try {
      const res = await fetch("/api/admin/create-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: fullPhone, password: generatedPwd }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedInfo({ phone: data.normalizedPhone || fullPhone, password: generatedPwd });
        setPhone("");
        load();
      } else {
        setError(data.message || "Échec de la création.");
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (accPhone: string) => {
    try {
      const res = await fetch(`/api/admin/accounts/${encodeURIComponent(accPhone)}/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setResetInfo({ phone: accPhone, password: data.newPassword });
    } catch {
      // silencieux
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 space-y-5">
      <h2 className="text-2xl font-display font-bold text-white">Administration</h2>

      <div className="bg-slate-900 border border-sky-700/50 rounded-2xl p-5 space-y-4">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-wider text-sky-400 font-semibold"><Users className="w-4 h-4"/> CRM — clients & relances</h3>
        <div className="flex gap-2"><input value={crmSearch} onChange={e=>setCrmSearch(e.target.value)} placeholder="Rechercher téléphone, nom ou email..." className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"/><button onClick={loadCrm} className="bg-sky-700 text-white text-xs px-4 rounded-xl">Actualiser</button></div>
        <div className="max-h-64 overflow-auto space-y-1.5">{crmLoading?<p className="text-xs text-slate-500">Chargement...</p>:crmCustomers.map(c=><button key={c.phone} onClick={()=>selectCustomer(c)} className={"w-full text-left bg-slate-950 border rounded-xl p-3 "+(selectedCustomer?.phone===c.phone?"border-sky-500":"border-slate-800")}><div className="flex justify-between"><span className="text-xs text-white font-mono">{c.phone}</span><span className="text-[10px] text-sky-400">{c.followup_status||"A_FAIRE"}</span></div><div className="text-xs text-slate-400">{c.full_name||"Client sans nom"}{c.next_followup_at?" • relance "+new Date(c.next_followup_at).toLocaleString("fr-FR"):""}</div></button>)}</div>
        {selectedCustomer && <div className="border-t border-slate-800 pt-4 space-y-2.5"><div className="text-xs text-white font-semibold">{selectedCustomer.full_name||selectedCustomer.phone}</div><textarea value={crmNote} onChange={e=>setCrmNote(e.target.value)} rows={3} placeholder="Notes CRM..." className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white"/><div className="grid grid-cols-3 gap-2"><input type="number" min="0" value={adPrice1000} onChange={e=>setAdPrice1000(e.target.value)} placeholder="Prix / 1000 écoutes (FCFA)" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"/><input type="number" min="0" max="1000" value={adPriority} onChange={e=>setAdPriority(e.target.value)} placeholder="Priorité" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"/><input type="number" min="1" max="100" value={adMaxPlays} onChange={e=>setAdMaxPlays(e.target.value)} placeholder="Max/user" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"/></div><div className="hidden"><input type="datetime-local" value={crmFollowup} onChange={e=>setCrmFollowup(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white"/><select value={crmStatus} onChange={e=>setCrmStatus(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white"><option>A_FAIRE</option><option>FAIT</option><option>ANNULEE</option></select></div><div className="flex gap-2"><button onClick={saveCustomerCrm} className="flex-1 bg-sky-700 text-white text-xs font-bold py-2.5 rounded-xl">Enregistrer</button><button onClick={logCustomerContact} className="flex-1 bg-emerald-700 text-white text-xs font-bold py-2.5 rounded-xl">Journaliser relance</button></div><div className="max-h-32 overflow-auto space-y-1">{crmEvents.map(e=><div key={e.id} className="text-[10px] text-slate-500 bg-slate-950 rounded-lg p-2">{new Date(e.created_at).toLocaleString("fr-FR")} • {e.channel} • {e.event_type}<br/>{e.notes||e.subject||""}</div>)}</div></div>}
      </div>

      <div className="bg-slate-900 border border-amber-600/50 rounded-2xl p-5 space-y-4">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-400 font-semibold">
          <Megaphone className="w-4 h-4" /> Publicités audio — sessions sponsorisées
        </h3>
        <p className="text-[11px] text-slate-500">
          Ajoutez les spots audio qui seront proposés avant les consultations sponsorisées de 3 minutes. La validation interactive est gérée automatiquement par JurisCoach.
        </p>

        {sponsoredStats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              ["Pubs actives", sponsoredStats.active_ads],
              ["Sessions", sponsoredStats.total_sessions],
              ["Validées", sponsoredStats.verified_sessions],
              ["Terminées", sponsoredStats.completed_sessions],
              ["En cours", sponsoredStats.active_consultations],
            ].map(([label,value]) => (
              <div key={String(label)} className="bg-slate-950 rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-amber-400">{value ?? 0}</div>
                <div className="text-[9px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAdUpload} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
          <div className="grid sm:grid-cols-2 gap-2"><input value={adAdvertiser} onChange={e=>setAdAdvertiser(e.target.value)} placeholder="Client / annonceur" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"/><input value={adCampaignRef} onChange={e=>setAdCampaignRef(e.target.value)} placeholder="Référence campagne" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"/></div><div className="grid sm:grid-cols-2 gap-2">
            <input required value={adTitle} onChange={e=>setAdTitle(e.target.value)} placeholder="Titre de la publicité"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"/>
            <input value={adDescription} onChange={e=>setAdDescription(e.target.value)} placeholder="Description / annonceur"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"/>
          </div>
          <input id="juriscoach-ad-file" required type="file" accept="audio/*" onChange={e=>setAdFile(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-400"/>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" max="1000" 
            <input type="number" min="1" max="100" 
          </div>
          <button disabled={adUploading} className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl">
            <Volume2 className="w-3.5 h-3.5 inline mr-1"/> {adUploading ? "Envoi..." : "Ajouter la publicité audio"}
          </button>
          {adResult && <p className="text-xs text-slate-400">{adResult}</p>}
        </form>

        {sponsorReport && <div className="bg-slate-950 border border-sky-800 rounded-xl p-4 space-y-2"><div className="flex justify-between"><b className="text-sm text-white">Rapport campagne — {sponsorReport.summary?.title}</b><button onClick={()=>setSponsorReport(null)} className="text-xs text-slate-500">Fermer</button></div><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{[["Écoutes confirmées",sponsorReport.summary?.confirmed_listens],["Sessions",sponsorReport.summary?.sessions],["Terminées",sponsorReport.summary?.completed_sessions],["Numéros uniques",sponsorReport.summary?.unique_phones],["Facturation FCFA",Number(sponsorReport.summary?.billable_plays||0)/1000*Number(sponsorReport.summary?.price_per_1000_xaf||0)].map(([l,v])=><div className="bg-slate-900 rounded-lg p-2 text-center" key={String(l)}><b className="text-sky-400 text-sm">{typeof v==="number"?Math.round(v):v}</b><div className="text-[9px] text-slate-500">{l}</div></div>)}</div><div className="max-h-48 overflow-auto">{(sponsorReport.details||[]).map((d:any)=><div key={d.id} className="text-[10px] text-slate-500 border-b border-slate-800 py-1.5"><span className="font-mono text-white">{d.phone}</span> • {d.challenge_verified?"ÉCOUTE CONFIRMÉE":"Non confirmée"} • {d.status} • {new Date(d.created_at).toLocaleString("fr-FR")}</div>)}</div></div>}
        <div className="space-y-2">
          {sponsoredAds.map(ad => (
            <div key={ad.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center"><Volume2 className="w-4 h-4 text-amber-400"/></div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">{ad.title}</div>
                <div className="text-[10px] text-slate-500">{ad.active ? "Active" : "Inactive"} · priorité {ad.priority} · max {ad.max_plays_per_user}/utilisateur</div>
              </div>
              <audio controls preload="none" src={`/api/sponsored/ads/${ad.id}/audio`} className="w-32 h-8"/>
              <button onClick={()=>loadSponsorReport(ad.id)} className="text-sky-400 text-xs mr-2">Rapport</button><button onClick={()=>toggleSponsoredAd(ad)} title={ad.active ? "Désactiver" : "Activer"} className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white"><Power className="w-4 h-4"/></button>
              <button onClick={()=>deleteSponsoredAd(ad.id)} title="Supprimer" className="p-2 rounded-lg bg-red-950 text-red-300 hover:text-red-200"><Trash2 className="w-4 h-4"/></button>
            </div>
          ))}
          {!sponsoredAds.length && <p className="text-xs text-slate-500">Aucune publicité audio enregistrée.</p>}
        </div>
      </div>

      <div className="bg-slate-900 border-2 border-amber-600 rounded-2xl p-5">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-amber-500 font-semibold mb-3">
          <BookOpen className="w-3.5 h-3.5" /> Extraction depuis un lien PDF (méthode recommandée)
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Collez juste le lien du PDF — le serveur le télécharge et le lit lui-même, sans passer par votre téléphone. Fonctionne même si le PDF contient des pages scannées avec OCR.
        </p>
        <form onSubmit={handleExtractFromPdfUrl} className="space-y-2.5">
          <input
            type="url" required placeholder="https://...code-penal.pdf"
            value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"
          />
          <div className="flex gap-2">
            <input
              type="text" required placeholder="Titre de la source (ex: Code pénal ivoirien)"
              value={pdfSourceTitle} onChange={(e) => setPdfSourceTitle(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"
            />
            <select value={pdfDomain} onChange={(e) => setPdfDomain(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2.5 text-xs text-white">
              <option value="PENAL">Pénal</option>
              <option value="AFFAIRES">Affaires</option>
              <option value="TRAVAIL">Travail</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input type="number" placeholder="Page début (optionnel)" value={pdfStartPage} onChange={(e) => setPdfStartPage(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500" />
            <input type="number" placeholder="Page fin (optionnel)" value={pdfEndPage} onChange={(e) => setPdfEndPage(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500" />
          </div>
          <button type="submit" disabled={extractingPdf}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer">
            {extractingPdf ? "Téléchargement + extraction en cours (peut prendre 1-2 min)..." : "Traiter ce PDF"}
          </button>
        </form>
        {pdfResult && <p className="text-xs text-slate-400 mt-2.5">{pdfResult}</p>}
        <button
          type="button"
          onClick={async () => {
            setPdfResult("Fusion en cours...");
            try {
              const res = await fetch("/api/admin/merge-sources", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ fromTitle: "CODE PENAL", toTitle: "Code pénal ivoirien" }),
              });
              const data = await res.json();
              setPdfResult(data.message || "Échec.");
            } catch (err: any) {
              setPdfResult(`Erreur : ${err?.message || "cause inconnue"}`);
            }
          }}
          className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold py-2 rounded-xl cursor-pointer"
        >
          🔀 Fusionner "CODE PENAL" dans "Code pénal ivoirien"
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirm('Fusionner TOUTES les sources PENAL (Code, Code penal, Code pénal, etc.) en une seule "Code pénal ivoirien" ?')) return;
            setPdfResult("Fusion générale en cours...");
            try {
              const res = await fetch("/api/admin/merge-all-in-domain", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ domain: "PENAL", canonicalTitle: "Code pénal ivoirien" }),
              });
              const data = await res.json();
              setPdfResult(data.message || "Échec.");
            } catch (err: any) {
              setPdfResult(`Erreur : ${err?.message || "cause inconnue"}`);
            }
          }}
          className="w-full mt-2 bg-red-800 hover:bg-red-700 text-white text-xs font-semibold py-2 rounded-xl cursor-pointer"
        >
          🔀 Fusionner TOUTES les sources PENAL en une seule
        </button>
        <button
          type="button" onClick={loadSourcesOverview}
          className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold py-2 rounded-xl cursor-pointer"
        >
          📊 Voir l'état actuel de la base
        </button>
        {sourcesOverview && (
          <div className="mt-2.5 space-y-1.5">
            {sourcesOverview.length === 0 ? (
              <p className="text-xs text-slate-500">Aucune source en base.</p>
            ) : sourcesOverview.map((s) => (
              <div key={s.id} className="flex justify-between text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                <span className="text-slate-300">{s.title} <span className="text-slate-600">({s.domain})</span></span>
                <span className="text-amber-500 font-bold">{s.article_count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
          <BookOpen className="w-3.5 h-3.5" /> Base juridique
        </h3>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            onClick={() => handleSeed("/api/admin/seed-legal-data", setSeedingPenal)}
            disabled={seedingPenal}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" /> {seedingPenal ? "..." : "Alimenter Code pénal CI"}
          </button>
          <button
            onClick={() => handleSeed("/api/admin/seed-ohada-data", setSeedingOhada)}
            disabled={seedingOhada}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" /> {seedingOhada ? "..." : "Alimenter droit OHADA"}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5 mt-2.5">
          <button
            onClick={() => handleSeed("/api/admin/seed-legal-data-2", setSeedingPenal2)}
            disabled={seedingPenal2}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" /> {seedingPenal2 ? "..." : "Code pénal (lot 2 : coups/voie de fait)"}
          </button>
          <button
            onClick={() => handleSeed("/api/admin/seed-ohada-suretes", setSeedingOhadaSuretes)}
            disabled={seedingOhadaSuretes}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" /> {seedingOhadaSuretes ? "..." : "OHADA : Sûretés"}
          </button>
        </div>
        <button
          onClick={() => handleSeed("/api/admin/seed-ohada-remaining", setSeedingOhadaRemaining)}
          disabled={seedingOhadaRemaining}
          className="w-full mt-2.5 flex items-center justify-center gap-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
        >
          <Scale className="w-3.5 h-3.5" /> {seedingOhadaRemaining ? "..." : "OHADA : 5 actes restants (procédures collectives, arbitrage, comptable, transport, coopératives)"}
        </button>
        <button
          onClick={() => handleSeed("/api/admin/seed-code-travail", setSeedingCodeTravail)}
          disabled={seedingCodeTravail}
          className="w-full mt-2.5 flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
        >
          <Scale className="w-3.5 h-3.5" /> {seedingCodeTravail ? "..." : "Code du travail ivoirien (droit national, 4 articles)"}
        </button>
        <button
          onClick={() => handleSeed("/api/admin/seed-code-foncier", setSeedingCodeFoncier)}
          disabled={seedingCodeFoncier}
          className="w-full mt-2.5 flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
        >
          <Scale className="w-3.5 h-3.5" /> {seedingCodeFoncier ? "..." : "Code foncier rural ivoirien (droit national, 4 articles)"}
        </button>
        <button
          onClick={() => handleSeed("/api/admin/seed-loi-mariage", setSeedingLoiMariage)}
          disabled={seedingLoiMariage}
          className="w-full mt-2.5 flex items-center justify-center gap-2 bg-pink-700 hover:bg-pink-800 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
        >
          <Scale className="w-3.5 h-3.5" /> {seedingLoiMariage ? "..." : "Loi relative au mariage (droit famille, 4 articles)"}
        </button>
        {seedResult && <p className="text-xs text-slate-400 mt-2.5">{seedResult}</p>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
          <BookOpen className="w-3.5 h-3.5" /> Extraction automatique par IA
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Collez un extrait de texte de loi (OHADA, code, etc.) — Gemini repère et enregistre automatiquement chaque article, sans les taper à la main.
        </p>
        <form onSubmit={handleExtract} className="space-y-2.5">
          <div className="flex gap-2">
            <input
              type="text" required placeholder="Titre de la source (ex: Acte uniforme sur le droit du travail)"
              value={extractSourceTitle} onChange={(e) => setExtractSourceTitle(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"
            />
            <select value={extractDomain} onChange={(e) => setExtractDomain(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2.5 text-xs text-white">
              <option value="PENAL">Pénal</option>
              <option value="AFFAIRES">Affaires</option>
              <option value="TRAVAIL">Travail</option>
            </select>
          </div>
          <input
            ref={textFileInputRef} type="file" accept=".txt,text/plain" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleTextFileImport(e.target.files[0])}
          />
          <button
            type="button" onClick={() => textFileInputRef.current?.click()}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold py-2.5 rounded-xl cursor-pointer"
          >
            📄 Importer un fichier .txt (au lieu de coller à la main)
          </button>
          <textarea
            required placeholder="Collez ici le texte brut de la loi (jusqu'à ~45 000 caractères par envoi)..."
            value={extractText} onChange={(e) => setExtractText(e.target.value)}
            rows={6}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 resize-none"
          />
          <p className="text-[10px] text-slate-500">{extractText.length.toLocaleString("fr-FR")} caractères</p>
          <button type="submit" disabled={extracting}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer">
            {extracting ? "Extraction en cours (peut prendre 20-30s)..." : "Extraire et enregistrer les articles"}
          </button>
        </form>
        {extractResult && <p className="text-xs text-slate-400 mt-2.5">{extractResult}</p>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
          <BookOpen className="w-3.5 h-3.5" /> Extraction depuis une photo/scan (OCR NVIDIA)
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Prenez une photo d'une page de loi (ou un scan) — Nemotron Parse (NVIDIA) lit le texte, puis Gemini structure les articles automatiquement.
        </p>
        <div className="flex gap-2 mb-2.5">
          <input
            type="text" placeholder="Titre de la source" value={imageSourceTitle} onChange={(e) => setImageSourceTitle(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500"
          />
          <select value={imageDomain} onChange={(e) => setImageDomain(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2.5 text-xs text-white">
            <option value="PENAL">Pénal</option>
            <option value="AFFAIRES">Affaires</option>
              <option value="TRAVAIL">Travail</option>
          </select>
        </div>
        <input
          ref={imageFileInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && handleExtractFromImage(e.target.files[0])}
        />
        <button
          type="button" onClick={() => imageFileInputRef.current?.click()} disabled={extractingImage}
          className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
        >
          {extractingImage ? "Extraction en cours (OCR + IA, peut prendre 30-60s)..." : "Choisir une photo de page"}
        </button>
        {imageExtractResult && <p className="text-xs text-slate-400 mt-2.5">{imageExtractResult}</p>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
          <UserPlus className="w-3.5 h-3.5" /> Créer un compte
        </h3>
        <form onSubmit={handleCreate} className="flex gap-2">
          <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2.5 text-xs text-white">
            <option value="+225">+225</option>
            <option value="+221">+221</option>
          </select>
          <input type="tel" required placeholder="07 12 34 56" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500" />
          <button type="submit" disabled={creating}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer whitespace-nowrap">
            {creating ? "..." : "Créer"}
          </button>
        </form>
        {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
        {createdInfo && (
          <div className="mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
            <p className="text-xs text-emerald-300">Numéro : <strong className="font-mono">{createdInfo.phone}</strong></p>
            <p className="text-xs text-emerald-300">Mot de passe : <strong className="font-mono text-base">{createdInfo.password}</strong></p>
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
          <Users className="w-3.5 h-3.5" /> Comptes ({accounts.length})
        </h3>
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.phone} className="bg-slate-950 rounded-xl p-3 flex items-center justify-between">
              <span className="text-xs font-mono text-white">{a.phone}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={async () => {
                    await fetch("/api/admin/toggle-pro", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ phone: a.phone }),
                    });
                    load();
                  }}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full cursor-pointer ${
                    a.isPro ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {a.isPro ? "✓ Pro" : "Activer Pro"}
                </button>
                <button onClick={() => resetPassword(a.phone)} className="text-[10px] font-medium bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full cursor-pointer hover:bg-slate-700">
                  Réinitialiser
                </button>
              </div>
            </div>
          ))}
        </div>
        {resetInfo && (
          <div className="mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
            <p className="text-xs text-emerald-300">Nouveau mot de passe pour {resetInfo.phone} : <strong className="font-mono">{resetInfo.password}</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}
