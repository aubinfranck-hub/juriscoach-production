import React, { useEffect, useState } from "react";
import { LogOut, ShieldCheck, Radio, Scale, BookOpen } from "lucide-react";
import LoginScreen from "./components/LoginScreen";
import AdminPanel from "./components/AdminPanel";
import DiagnosticScreen from "./components/DiagnosticScreen";
import LiveVoiceScreen from "./components/LiveVoiceScreen";
import WorkCodePanel from "./components/WorkCodePanel";
import LaborCasePanel from "./components/LaborCasePanel";

function JurisLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-10 h-10 rounded-2xl bg-white border border-emerald-200 shadow-sm flex items-center justify-center overflow-hidden">
        <div className="absolute inset-x-1 top-1 h-1 rounded-full bg-gradient-to-r from-emerald-600 via-white to-orange-500" />
        <Scale className="w-5 h-5 text-slate-900" />
        <span className="absolute bottom-0.5 left-1.5 right-1.5 h-1 rounded-full bg-gradient-to-r from-emerald-600 to-orange-500" />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[18px] font-black tracking-tight">
            Juris<span className="text-orange-500">Coach</span>
          </div>
          <div className="text-[9px] font-medium text-slate-400 mt-1">Le droit, plus proche de vous</div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem("juriscoach_token"));
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [activeTab, setActiveTab] = useState<"accueil" | "admin" | "live" | "code-travail" | "dossiers-travail">("accueil");

  useEffect(() => {
    if (!sessionToken) return;
    fetch("/api/user/status", { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) { setIsAdmin(Boolean(data.isAdmin)); setIsPro(Boolean(data.isPro)); }
        else { localStorage.removeItem("juriscoach_token"); setSessionToken(null); }
      })
      .catch(() => {});
  }, [sessionToken]);

  const handleLoginSuccess = (token: string) => {
    localStorage.setItem("juriscoach_token", token);
    setSessionToken(token);
  };

  const handleLogout = async () => {
    const token = sessionToken;
    try {
      if (token) await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch {}
    localStorage.removeItem("juriscoach_token");
    setSessionToken(null);
  };

  if (!sessionToken) return <LoginScreen onLoginSuccess={handleLoginSuccess} />;

  return (
    <div className="min-h-screen bg-[#f6f8f7] font-sans text-slate-900">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <button onClick={() => setActiveTab("accueil")} className="cursor-pointer">
            <JurisLogo />
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab(activeTab === "live" ? "accueil" : "live")}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer transition ${
                activeTab === "live" ? "bg-emerald-700 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Radio className="w-3.5 h-3.5" /> Live {!isPro && <span className="text-[10px]">GRATUIT*</span>}
            </button>
            <button
              onClick={() => setActiveTab(activeTab === "code-travail" ? "accueil" : "code-travail")}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer transition ${
                activeTab === "code-travail" ? "bg-emerald-700 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Code du travail
            </button>
            <button onClick={() => setActiveTab(activeTab === "dossiers-travail" ? "accueil" : "dossiers-travail")} className={"flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer transition " + (activeTab === "dossiers-travail" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}><Scale className="w-3.5 h-3.5" /> Préparer un dossier</button>
            {isAdmin && (
              <button onClick={() => setActiveTab(activeTab === "admin" ? "accueil" : "admin")}
                className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 px-3 py-2.5 rounded-xl cursor-pointer">
                <ShieldCheck className="w-3.5 h-3.5" /> Admin
              </button>
            )}
            <button onClick={handleLogout} aria-label="Déconnexion" className="text-slate-500 hover:text-slate-900 cursor-pointer p-2">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-[calc(100vh-68px)]">
        {activeTab === "admin" && isAdmin ? (
          <AdminPanel token={sessionToken} />
        ) : activeTab === "live" ? (
          <LiveVoiceScreen token={sessionToken} isPro={isPro} />
        ) : activeTab === "code-travail" ? (
          <WorkCodePanel token={sessionToken} />
        ) : activeTab === "dossiers-travail" ? (
          <LaborCasePanel token={sessionToken} />
        ) : (
          <DiagnosticScreen token={sessionToken} onLive={() => setActiveTab("live")} />
        )}
      </main>
    </div>
  );
}
