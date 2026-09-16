import React, { useState, useEffect } from "react";
import { Scale, LogOut, ShieldCheck, Radio } from "lucide-react";
import LoginScreen from "./components/LoginScreen";
import AdminPanel from "./components/AdminPanel";
import DiagnosticScreen from "./components/DiagnosticScreen";
import LiveVoiceScreen from "./components/LiveVoiceScreen";

export default function App() {
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem("juriscoach_token"));
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [activeTab, setActiveTab] = useState<"accueil" | "admin" | "live">("accueil");

  useEffect(() => {
    if (!sessionToken) return;
    fetch("/api/user/status", { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) { setIsAdmin(data.isAdmin); setIsPro(data.isPro); }
        else { localStorage.removeItem("juriscoach_token"); setSessionToken(null); }
      })
      .catch(() => {});
  }, [sessionToken]);

  const handleLoginSuccess = (token: string) => {
    localStorage.setItem("juriscoach_token", token);
    setSessionToken(token);
  };

  const handleLogout = () => {
    localStorage.removeItem("juriscoach_token");
    setSessionToken(null);
  };

  if (!sessionToken) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#0f172a] font-sans text-white">
      <header className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-base">JurisCoach</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab(activeTab === "live" ? "accueil" : "live")}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl cursor-pointer ${
              activeTab === "live" ? "bg-amber-600 text-white" : "bg-slate-800 hover:bg-slate-700 text-white"
            }`}
          >
            <Radio className="w-3.5 h-3.5" /> Live {!isPro && "🔒"}
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab(activeTab === "admin" ? "accueil" : "admin")}
              className="flex items-center gap-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Admin
            </button>
          )}
          <button onClick={handleLogout} className="text-slate-400 hover:text-white cursor-pointer p-2">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {activeTab === "admin" && isAdmin ? (
        <AdminPanel token={sessionToken} />
      ) : activeTab === "live" ? (
        <LiveVoiceScreen token={sessionToken} isPro={isPro} />
      ) : (
        <DiagnosticScreen token={sessionToken} />
      )}
    </div>
  );
}
