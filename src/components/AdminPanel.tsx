import React, { useState, useEffect, useCallback } from "react";
import { UserPlus, Users, BookOpen, Scale } from "lucide-react";

interface Account {
  phone: string;
  createdAt: number;
  isAdmin: boolean;
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
  const [seedResult, setSeedResult] = useState<string | null>(null);

  const [extractText, setExtractText] = useState("");
  const [extractSourceTitle, setExtractSourceTitle] = useState("");
  const [extractDomain, setExtractDomain] = useState("PENAL");
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<string | null>(null);

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
    } catch {
      setExtractResult("Erreur réseau.");
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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setAccounts(data.accounts);
    } catch {
      // silencieux
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

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
            </select>
          </div>
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
              <button onClick={() => resetPassword(a.phone)} className="text-[10px] font-medium bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full cursor-pointer hover:bg-slate-700">
                Réinitialiser
              </button>
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
