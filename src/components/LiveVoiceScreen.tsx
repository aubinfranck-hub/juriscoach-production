import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Headphones, Loader2, Lock, Mic, Phone, PhoneOff, Radio, RotateCcw } from "lucide-react";

type LiveMode = "pro" | "sponsored";
type LiveStatus = "idle" | "ad" | "connecting" | "connected" | "error" | "disconnected" | "ended";

export default function LiveVoiceScreen({ token, isPro }: { token: string; isPro: boolean }) {
  const [mode, setMode] = useState<LiveMode>(isPro ? "pro" : "sponsored");
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [sponsoredSessionId, setSponsoredSessionId] = useState<string | null>(null);
  const [sponsoredAd, setSponsoredAd] = useState<any | null>(null);
  const [, setChallengeDigit] = useState<number | null>(null);
  const [challengeMessage, setChallengeMessage] = useState("");
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
      source.buffer = buffer;
      source.connect(ctx.destination);
      activeSourcesRef.current.push(source);
      source.onended = () => { activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source); };
      const now = ctx.currentTime;
      let startTime = nextStartTimeRef.current;
      if (startTime < now) startTime = now + 0.02;
      source.start(startTime);
      nextStartTimeRef.current = startTime + buffer.duration;
    } catch (err) {
      console.error("[Live] Lecture audio échouée:", err);
    }
  };

  const startMicrophoneAndLive = async (liveMode: LiveMode, sessionId?: string) => {
    setStatus("connecting");
    setError(null);
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxInputRef.current = inputCtx;
      audioCtxOutputRef.current = outputCtx;
      nextStartTimeRef.current = 0;
      if (inputCtx.state === "suspended") await inputCtx.resume();
      if (outputCtx.state === "suspended") await outputCtx.resume();

      const ticketResponse = await fetch("/api/live-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
        else if (msg.type === "userTranscript") {
          setTranscript((prev) => (prev.trim() ? prev + "\n" : "") + "Vous : " + msg.text);
        } else if (msg.type === "text") {
          setTranscript((prev) => {
            const cleaned = prev.trim();
            const lastLine = cleaned.includes("\n") ? cleaned.substring(cleaned.lastIndexOf("\n") + 1) : cleaned;
            if (lastLine.startsWith("JurisCoach :")) return prev + msg.text;
            return (cleaned ? cleaned + "\n" : "") + "JurisCoach : " + msg.text;
          });
        } else if (msg.type === "consultationStarted") {
          setRemaining(msg.durationSeconds || 180);
          if (countdownRef.current) window.clearInterval(countdownRef.current);
          countdownRef.current = window.setInterval(() => {
            setRemaining((v) => {
              if (v === null) return v;
              return Math.max(0, v - 1);
            });
          }, 1000);
        } else if (msg.type === "subscriptionWarning") {
          setChallengeMessage("Votre session arrive à son terme. Pour continuer, passez à Pro.");
        } else if (msg.type === "consultationEnding") {
          setChallengeMessage("JurisCoach termine naturellement sa réponse...");
        } else if (msg.type === "error") {
          setError(msg.message);
          setStatus("error");
        } else if (msg.type === "closed") {
          if (countdownRef.current) window.clearInterval(countdownRef.current);
          setStatus("ended");
        }
      };
      ws.onerror = () => { setError("La connexion en temps réel a échoué."); setStatus("error"); };
      ws.onclose = () => setStatus((s) => (s === "connected" ? "disconnected" : s));

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(inputCtx.destination);
      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio", audio: pcmToBase64(e.inputBuffer.getChannelData(0)) }));
      };
    } catch (err: any) {
      setError(err.message || "Impossible d'accéder au micro ou de se connecter.");
      setStatus("error");
      cleanup();
    }
  };

  const startSponsored = async () => {
    setError(null);
    setChallengeMessage("");
    setStatus("ad");
    try {
      const res = await fetch("/api/sponsored/start", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Aucune session sponsorisée disponible.");
      setSponsoredSessionId(data.sessionId);
      setSponsoredAd(data.ad);
      setChallengeDigit(data.challengeDigit);
      const audio = new Audio(data.audioUrl);
      adAudioRef.current = audio;
      audio.onended = () => setChallengeMessage(`Publicité terminée. Appuyez maintenant sur le chiffre ${data.challengeDigit} pour confirmer votre écoute.`);
      await audio.play();
    } catch (err: any) {
      setError(err.message || "Impossible de lancer la publicité.");
      setStatus("error");
    }
  };

  const validateSponsored = async (digit: number) => {
    if (!sponsoredSessionId) return;
    setChallengeMessage("Vérification...");
    try {
      const res = await fetch("/api/sponsored/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: sponsoredSessionId, digit }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        setChallengeMessage(data.message || "Réponse incorrecte.");
        return;
      }
      setChallengeMessage("Publicité validée. La consultation de 3 minutes commencera à votre première vraie question.");
      setTimeout(() => startMicrophoneAndLive("sponsored", sponsoredSessionId), 900);
    } catch {
      setChallengeMessage("Erreur de vérification. Réessayez.");
    }
  };

  const startPro = () => startMicrophoneAndLive("pro");

  const stopSession = () => {
    cleanup();
    if (sponsoredSessionId) {
      fetch("/api/sponsored/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: sponsoredSessionId }),
      }).catch(() => {});
    }
    setStatus("disconnected");
    setRemaining(null);
  };

  useEffect(() => () => cleanup(), []);

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 space-y-5">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Live — JurisCoach</h2>
        <p className="text-sm text-slate-400 mt-1">Consultation juridique vocale en direct.</p>
      </div>

      {isPro ? (
        <div className="flex gap-2">
          <button onClick={() => setMode("pro")} className={`flex-1 py-2 rounded-xl text-xs font-bold ${mode === "pro" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400"}`}>Pro</button>
          <button onClick={() => setMode("sponsored")} className={`flex-1 py-2 rounded-xl text-xs font-bold ${mode === "sponsored" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400"}`}>Session sponsorisée</button>
        </div>
      ) : (
        <div className="bg-slate-900 border border-amber-700/50 rounded-2xl p-4">
          <p className="text-xs text-slate-300"><strong className="text-amber-400">Session sponsorisée gratuite</strong> : écoutez une publicité interactive, validez le chiffre demandé, puis bénéficiez de 3 minutes de consultation. Le compteur démarre à votre première vraie question.</p>
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {mode === "sponsored" && status === "ad" ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <Headphones className="w-10 h-10 mx-auto text-amber-500" />
          <h3 className="font-bold text-white">{sponsoredAd?.title || "Publicité sponsorisée"}</h3>
          <p className="text-xs text-slate-400">Écoutez toute la publicité. Un chiffre vous sera demandé ensuite pour confirmer votre écoute.</p>
          <div className="grid grid-cols-5 gap-2 max-w-xs mx-auto">
            {Array.from({length:10},(_,n)=>n).map((n)=><button key={n} onClick={()=>validateSponsored(n)} className="h-11 rounded-xl bg-slate-800 hover:bg-amber-600 text-white font-bold">{n}</button>)}
          </div>
          <p className="text-xs text-amber-300 min-h-5">{challengeMessage}</p>
        </div>
      ) : (
        <>
          {remaining !== null && mode === "sponsored" && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,"0")}</div>
              <div className="text-[11px] text-slate-400">Consultation sponsorisée — 3 minutes</div>
            </div>
          )}

          <div className="flex flex-col items-center py-6">
            <button
              onClick={status === "connected" || status === "connecting" ? stopSession : mode === "pro" ? startPro : startSponsored}
              className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors ${status === "connected" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}
            >
              {status === "connecting" ? <Loader2 className="w-9 h-9 text-white animate-spin" /> : status === "connected" ? <PhoneOff className="w-9 h-9 text-white" /> : mode === "sponsored" ? <Radio className="w-9 h-9 text-white" /> : <Mic className="w-9 h-9 text-white" />}
            </button>
            <p className="text-xs text-slate-400 mt-3">
              {status === "connecting" ? "Connexion..." : status === "connected" ? "En communication — touchez pour raccrocher" : status === "ended" ? "Session terminée" : mode === "sponsored" ? "Touchez pour lancer la publicité" : "Touchez pour commencer"}
            </p>
          </div>

          {status === "ended" && mode === "sponsored" && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center space-y-3">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400" />
              <p className="text-sm text-white font-semibold">Votre session sponsorisée est terminée.</p>
              <p className="text-xs text-slate-400">Pour poursuivre votre consultation avec JurisCoach, contactez-nous.</p>
              <div className="flex gap-2">
                <a href="tel:0707312797" className="flex-1 flex items-center justify-center gap-2 bg-amber-600 rounded-xl py-3 text-xs font-bold text-white"><Phone className="w-4 h-4" /> Appeler</a>
                <a href="https://wa.me/2250707312797" target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 rounded-xl py-3 text-xs font-bold text-white">WhatsApp</a>
              </div>
              <button onClick={() => { setStatus("idle"); setSponsoredSessionId(null); setSponsoredAd(null); setChallengeDigit(null); setChallengeMessage(""); setRemaining(null); }} className="text-xs text-slate-400 flex items-center gap-1 mx-auto"><RotateCcw className="w-3 h-3"/> Nouvelle session</button>
            </div>
          )}

          {challengeMessage && mode === "sponsored" && status !== "ad" && <p className="text-xs text-amber-300 text-center">{challengeMessage}</p>}

          {transcript && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 whitespace-pre-wrap text-xs text-slate-300 max-h-80 overflow-y-auto">{transcript}</div>
          )}

          {mode === "pro" && !isPro && (
            <div className="text-center text-xs text-slate-500"><Lock className="w-4 h-4 inline mr-1"/>Pro requis.</div>
          )}
        </>
      )}

      <p className="text-[11px] text-slate-500 text-center px-4">
        Ce service est une aide informative et ne remplace pas l'avis d'un avocat.
      </p>
    </div>
  );
}
