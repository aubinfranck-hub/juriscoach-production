import React, { useState } from "react";
import { Scale, Phone, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";

interface LoginScreenProps {
  onLoginSuccess: (token: string) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [countryCode, setCountryCode] = useState("+225");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, countryCode, password }),
      });
      const data = await res.json();
      if (data.success) {
        onLoginSuccess(data.sessionToken);
      } else {
        setError(data.message || "Connexion impossible.");
      }
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-5 font-sans">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-7">
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 mb-3">
            <Scale className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-display font-bold text-white">JurisCoach</h1>
          <p className="text-xs text-slate-400 mt-1">Assistant juridique intelligent</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">Numéro de téléphone</label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-3 text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option value="+225">+225</option>
                <option value="+221">+221</option>
                <option value="+223">+223</option>
              </select>
              <div className="relative flex-1">
                <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  required
                  placeholder="07 12 34 56"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">Mot de passe</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="Votre mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-10 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-700 disabled:opacity-50 text-white font-semibold text-sm py-3.5 rounded-xl transition cursor-pointer"
          >
            {loading ? "Connexion..." : <>Se connecter <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>

        <p className="text-[11px] text-slate-500 text-center mt-5">
          Pas de compte ? Contactez-nous pour en créer un.
        </p>
      </div>
    </div>
  );
}
