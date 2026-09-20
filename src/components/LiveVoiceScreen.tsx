import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Headphones, Loader2, Mic, Phone, PhoneOff, Radio, RotateCcw, Scale, ShieldCheck, Sparkles } from "lucide-react";

type LiveMode = "pro" | "sponsored";
type LiveStatus = "idle" | "ad" | "connecting" | "connected" | "error" | "disconnected" | "ended";

function LiveLogo() {
  return <div className="flex items-center gap-2.5">
    <div className="relative w-11 h-11 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-emerald-100">
      <Scale className="w-5 h-5 text-slate-900" />
      <span className="absolute bottom-1 left-2 right-2 h-1 rounded-full bg-gradient-to-r from-emerald-600 via-white to-orange-500" />
    </div>
    <div><div className="font-black text-[18px]">Juris<span className="text-orange-500">Coach</span></div><div className="text-[9px] text-slate-400">Live juridique Côte d'Ivoire</div></div>
  </div>;
}

export default function LiveVoiceScreen({ token, isPro }: { token: string; isPro: boolean }) {
  const [mode, setMode] = useState<LiveMode>(isPro ? "pro" : "sponsored");
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [sponsoredSessionId, setSponsoredSessionId] = useState<string | null>(null);
  const [sponsoredAd, setSponsoredAd] = useState<any | null>(null);
  const [, setChallengeDigit] = useState<number | null>(null);
  const [challengeMessage, setChallengeMessage] = useState("");
  const [adReady, setAdReady] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxInputRef = useRef<AudioContext | null>(null);
  const audioCtxOutputRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef(0);
  const adAudioRef = useRef<HTMLAudioElement | null>(null);
  const countdownRef = useRef<number | null>(null);

  const pcmToBase64 = (float32Array: Float32Array): string => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const stopAllAudioPlayback = () => {
    activeSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  const cleanup = () => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((t) => t.stop()); micStreamRef.current = null; }
    if (processorRef.current) { try { processorRef.current.disconnect(); } catch {} processorRef.current = null; }
    if (audioCtxInputRef.current) { try { audioCtxInputRef.current.close(); } catch {} audioCtxInputRef.current = null; }
    stopAllAudioPlayback();
    if (audioCtxOutputRef.current) { try { audioCtxOutputRef.current.close(); } catch {} audioCtxOutputRef.current = null; }
    if (adAudioRef.current) { adAudioRef.current.pause(); adAudioRef.current = null; }
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    countdownRef.current = null;
  };

  const playAudioChunk = (base64Data: string) => {
    const ctx = audioCtxOutputRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer; source.connect(ctx.destination);
      activeSourcesRef.current.push(source);
      source.onended = () => { activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source); };
      const now = ctx.currentTime; let startTime = nextStartTimeRef.current;
      if (startTime < now) startTime = now + 0.02;
      source.start(startTime); nextStartTimeRef.current = startTime + buffer.duration;
    } catch (err) { console.error("[Live] Lecture audio échouée:", err); }
  };

  const startMicrophoneAndLive = async (liveMode: LiveMode, sessionId?: string) => {
    setStatus("connecting"); setError(null); setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxInputRef.current = inputCtx; audioCtxOutputRef.current = outputCtx; nextStartTimeRef.current = 0;
      if (inputCtx.state === "suspended") await inputCtx.resume();
      if (outputCtx.state === "suspended") await outputCtx.resume();

      const ticketResponse = await fetch("/api/live-ticket", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(liveMode === "sponsored" ? { mode: "sponsored", sessionId } : { mode: "pro" }),
      });
      const ticketData = await ticketResponse.json();
      if (!ticketResponse.ok || !ticketData.ticket) throw new Error(ticketData.message || "Impossible d’obtenir le ticket Live.");

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live-ws?ticket=${encodeURIComponent(ticketData.ticket)}`);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "start", mode: liveMode }));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "connected") setStatus("connected");
        else if (msg.type === "audio") playAudioChunk(msg.audio);
        else if (msg.type === "interrupted") stopAllAudioPlayback();
        else if (msg.type === "userTranscript") setTranscript((prev) => (prev.trim() ? prev + "\n" : "") + "Vous : " + msg.text);
        else if (msg.type === "text") setTranscript((prev) => {
          const cleaned = prev.trim(); const lastLine = cleaned.includes("\n") ? cleaned.substring(cleaned.lastIndexOf("\n") + 1) : cleaned;
          if (lastLine.startsWith("JurisCoach :")) return prev + msg.text;
          return (cleaned ? cleaned + "\n" : "") + "JurisCoach : " + msg.text;
        });
        else if (msg.type === "consultationStarted") {
          setRemaining(msg.durationSeconds || 180);
          if (countdownRef.current) window.clearInterval(countdownRef.current);
          countdownRef.current = window.setInterval(() => setRemaining((v) => v === null ? v : Math.max(0, v - 1)), 1000);
        } else if (msg.type === "subscriptionWarning") setChallengeMessage("Votre session arrive à son terme. Pour continuer, passez à Pro.");
        else if (msg.type === "consultationEnding") setChallengeMessage("JurisCoach termine naturellement sa réponse...");
        else if (msg.type === "error") { setError(msg.message); setStatus("error"); }
        else if (msg.type === "closed") { if (countdownRef.current) window.clearInterval(countdownRef.current); setStatus("ended"); }
      };
      ws.onerror = () => { setError("La connexion en temps réel a échoué."); setStatus("error"); };
      ws.onclose = () => setStatus((s) => s === "connected" ? "disconnected" : s);

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor; source.connect(processor); processor.connect(inputCtx.destination);
      processor.onaudioprocess = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio", audio: pcmToBase64(e.inputBuffer.getChannelData(0)) })); };
    } catch (err: any) { setError(err.message || "Impossible d'accéder au micro ou de se connecter."); setStatus("error"); cleanup(); }
  };

  const startSponsored = async () => {
    setError(null); setChallengeMessage(""); setStatus("ad");
    try {
      const res = await fetch("/api/sponsored/start", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Aucune session sponsorisée disponible.");
      setSponsoredSessionId(data.sessionId); setSponsoredAd(data.ad); setChallengeDigit(data.challengeDigit); setAdReady(false);
      const startRes = await fetch("/api/sponsored/ad-start", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: data.sessionId }) });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.success) throw new Error(startData.message || "Impossible de démarrer l'écoute.");
      const audio = new Audio(data.audioUrl); adAudioRef.current = audio;
      audio.onended = async () => {
        try {
          const completeRes = await fetch("/api/sponsored/ad-complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: data.sessionId }) });
          const completeData = await completeRes.json();
          if (!completeRes.ok || !completeData.success) { setChallengeMessage(completeData.message || "Écoute non confirmée."); return; }
          setAdReady(true); setChallengeMessage(`Publicité terminée. Appuyez sur le chiffre ${data.challengeDigit} pour confirmer votre écoute.`);
        } catch { setChallengeMessage("Impossible de confirmer l'écoute. Réessayez."); }
      };
      await audio.play();
    } catch (err: any) { setError(err.message || "Impossible de lancer la publicité."); setStatus("error"); }
  };

  const validateSponsored = async (digit: number) => {
    if (!sponsoredSessionId || !adReady) return;
    setChallengeMessage("Vérification...");
    try {
      const res = await fetch("/api/sponsored/validate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: sponsoredSessionId, digit }) });
      const data = await res.json();
      if (!res.ok || !data.verified) { setChallengeMessage(data.message || "Réponse incorrecte."); return; }
      setChallengeMessage("Publicité validée. La consultation commencera à votre première vraie question.");
      setTimeout(() => startMicrophoneAndLive("sponsored", sponsoredSessionId), 900);
    } catch { setChallengeMessage("Erreur de vérification. Réessayez."); }
  };

  const stopSession = () => {
    cleanup();
    if (sponsoredSessionId) fetch("/api/sponsored/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: sponsoredSessionId }) }).catch(() => {});
    setStatus("disconnected"); setRemaining(null);
  };

  useEffect(() => () => cleanup(), []);

  const connected = status === "connected";
  const busy = status === "connecting";
  const action = connected || busy ? stopSession : mode === "pro" ? () => startMicrophoneAndLive("pro") : startSponsored;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <section className="overflow-hidden rounded-[30px] bg-gradient-to-br from-[#061f2c] via-[#063f32] to-[#08745b] text-white shadow-xl">
        <div className="p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div><LiveLogo />
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"><Sparkles className="w-3.5 h-3.5 text-orange-300" /> Consultation vocale</div>
            <h1 className="mt-3 text-2xl sm:text-4xl font-black tracking-tight">Parlez à JurisCoach.</h1>
            <p className="mt-2 text-sm text-emerald-50/85 max-w-xl">Expliquez votre situation naturellement. L'assistant vous répond à voix haute et affiche simultanément la transcription.</p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-4 min-w-[190px]">
            <div className="text-[10px] text-emerald-100 uppercase tracking-wider font-bold">Mode</div>
            <div className="text-lg font-black mt-1">{mode === "pro" ? "Pro" : "Sponsorisé"}</div>
            <div className="text-[10px] text-emerald-100/70 mt-1">Mobile & tablette</div>
          </div>
        </div>
      </section>

      <div className="mt-5 flex gap-2 p-1.5 bg-white border border-slate-200 rounded-2xl shadow-sm">
        <button onClick={() => setMode("pro")} disabled={!isPro} className={`flex-1 rounded-xl py-2.5 text-xs font-black cursor-pointer ${mode === "pro" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"} ${!isPro ? "opacity-40 cursor-not-allowed" : ""}`}>PRO {!isPro && "🔒"}</button>
        <button onClick={() => setMode("sponsored")} className={`flex-1 rounded-xl py-2.5 text-xs font-black cursor-pointer ${mode === "sponsored" ? "bg-emerald-700 text-white" : "text-slate-500 hover:bg-slate-50"}`}>SESSION SPONSORISÉE</button>
      </div>

      {mode === "sponsored" && status === "idle" && (
        <div className="mt-4 rounded-2xl bg-orange-50 border border-orange-200 p-4 text-xs text-orange-900">
          <b>Accès sponsorisé :</b> écoutez le message partenaire, confirmez l'écoute, puis démarrez votre consultation. Le compteur de consultation est géré par le serveur.
        </div>
      )}

      {error && <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl p-3 text-xs text-red-700 flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}

      {mode === "sponsored" && status === "ad" ? (
        <div className="mt-5 rounded-[28px] bg-white border border-slate-200 shadow-sm p-5 sm:p-7">
          <div className="max-w-xl mx-auto text-center">
            <div className="mx-auto w-16 h-16 rounded-3xl bg-orange-50 flex items-center justify-center"><Headphones className="w-8 h-8 text-orange-500" /></div>
            <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-black mt-5">Message partenaire</p>
            <h2 className="text-xl font-black text-slate-900 mt-1">{sponsoredAd?.title || "Publicité sponsorisée"}</h2>
            <p className="text-xs text-slate-500 mt-2">{sponsoredAd?.description || "Écoutez entièrement le message sponsorisé pour poursuivre."}</p>
            <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-white"><div className="flex items-center justify-center gap-2 text-xs font-bold"><Radio className="w-4 h-4 text-orange-400" /> Lecture audio en cours</div><div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden"><div className={`h-full bg-gradient-to-r from-emerald-500 to-orange-400 ${adReady ? "w-full" : "w-2/3"}`} /></div></div>
            <div className="mt-5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{adReady ? "Confirmez votre écoute" : "Le clavier sera disponible après l'écoute"}</p>
              <div className="grid grid-cols-5 gap-2 max-w-xs mx-auto">{Array.from({length:10},(_,n)=><button key={n} disabled={!adReady} onClick={()=>validateSponsored(n)} className="h-11 rounded-xl bg-slate-100 hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-900 hover:text-white font-black cursor-pointer">{n}</button>)}</div>
            </div>
            <p className="text-xs text-orange-600 min-h-5 mt-3">{challengeMessage}</p>
          </div>
        </div>
      ) : (
        <>
          {remaining !== null && mode === "sponsored" && <div className="mt-5 rounded-2xl bg-orange-50 border border-orange-200 p-4 text-center"><div className="text-3xl font-black text-orange-600">{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,"0")}</div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">Temps de consultation sponsorisée</div></div>}

          <div className="mt-5 grid lg:grid-cols-[.8fr_1.2fr] gap-5">
            <div className="rounded-[28px] bg-white border border-slate-200 shadow-sm p-6 flex flex-col items-center justify-center min-h-[360px]">
              <div className={`relative w-32 h-32 rounded-full flex items-center justify-center shadow-xl transition ${connected ? "bg-red-600 shadow-red-200" : "bg-emerald-700 shadow-emerald-200"}`}>
                {busy ? <Loader2 className="w-10 h-10 text-white animate-spin" /> : connected ? <PhoneOff className="w-10 h-10 text-white" /> : mode === "sponsored" ? <Radio className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
                {connected && <span className="absolute -inset-3 rounded-full border-2 border-emerald-200 animate-pulse" />}
              </div>
              <p className="mt-5 text-sm font-black text-slate-900">{busy ? "Connexion sécurisée..." : connected ? "Conversation en direct" : status === "ended" ? "Session terminée" : mode === "sponsored" ? "Lancer le sponsoring" : "Commencer la consultation"}</p>
              <p className="text-xs text-slate-500 mt-1 text-center max-w-xs">{connected ? "Touchez le bouton pour raccrocher." : "Votre micro est utilisé uniquement pendant la consultation."}</p>
              <button onClick={action} className={`mt-5 w-full max-w-xs py-3.5 rounded-2xl text-sm font-black text-white cursor-pointer ${connected ? "bg-red-600 hover:bg-red-700" : "bg-emerald-700 hover:bg-emerald-800"}`}>{busy ? "Connexion..." : connected ? "Terminer" : mode === "sponsored" ? "Écouter le sponsor" : "Parler à JurisCoach"}</button>
              <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-400"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Connexion Live protégée</div>
            </div>

            <div className="rounded-[28px] bg-white border border-slate-200 shadow-sm overflow-hidden min-h-[360px]">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-emerald-700 font-black">Conversation</p><p className="text-sm font-black text-slate-900">Transcription en direct</p></div><span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full ${connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}><span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />{connected ? "EN DIRECT" : "PRÊT"}</span></div>
              <div className="p-5 max-h-[390px] overflow-y-auto">{transcript ? <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{transcript}</div> : <div className="h-64 flex flex-col items-center justify-center text-center"><div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center"><Mic className="w-6 h-6 text-emerald-700" /></div><p className="mt-3 text-sm font-bold text-slate-700">Votre conversation apparaîtra ici</p><p className="text-xs text-slate-400 mt-1 max-w-xs">Vous parlez, JurisCoach écoute et répond vocalement.</p></div>}</div>
            </div>
          </div>

          {status === "ended" && mode === "sponsored" && <div className="mt-5 rounded-[24px] bg-slate-900 text-white p-5 text-center space-y-3"><CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400" /><p className="text-sm font-black">Votre session sponsorisée est terminée.</p><p className="text-xs text-slate-400">Pour poursuivre votre consultation, contactez JurisCoach.</p><div className="flex gap-2 max-w-md mx-auto"><a href="tel:0707312797" className="flex-1 flex items-center justify-center gap-2 bg-orange-500 rounded-xl py-3 text-xs font-black text-white"><Phone className="w-4 h-4" /> Appeler</a><a href="https://wa.me/2250707312797" target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 rounded-xl py-3 text-xs font-black text-white">WhatsApp</a></div><button onClick={() => { setStatus("idle"); setSponsoredSessionId(null); setSponsoredAd(null); setChallengeDigit(null); setChallengeMessage(""); setRemaining(null); }} className="text-xs text-slate-400 flex items-center gap-1 mx-auto cursor-pointer"><RotateCcw className="w-3 h-3" /> Nouvelle session</button></div>}

          {challengeMessage && mode === "sponsored" && status !== "ad" && <p className="mt-3 text-xs text-orange-600 text-center">{challengeMessage}</p>}
        </>
      )}

      <div className="mt-5 rounded-2xl bg-white border border-slate-200 p-4 flex gap-3 items-start"><Scale className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" /><p className="text-[11px] leading-5 text-slate-500">JurisCoach fournit une aide informative. Pour une stratégie ou une représentation, rapprochez-vous d'un avocat ou d'un professionnel du droit.</p></div>
    </div>
  );
}
