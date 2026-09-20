import React, { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Loader2, AlertTriangle, Lock, PhoneOff } from "lucide-react";

type LiveStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

export default function LiveVoiceScreen({ token, isPro }: { token: string; isPro: boolean }) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxInputRef = useRef<AudioContext | null>(null);
  const audioCtxOutputRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef(0);

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
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

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

  const stopSession = () => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((t) => t.stop()); micStreamRef.current = null; }
    if (processorRef.current) { try { processorRef.current.disconnect(); } catch {} processorRef.current = null; }
    if (audioCtxInputRef.current) { try { audioCtxInputRef.current.close(); } catch {} audioCtxInputRef.current = null; }
    stopAllAudioPlayback();
    if (audioCtxOutputRef.current) { try { audioCtxOutputRef.current.close(); } catch {} audioCtxOutputRef.current = null; }
    setStatus("disconnected");
  };

  const startSession = async () => {
    setStatus("connecting");
    setError(null);
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioCtxInputRef.current = inputCtx;
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxOutputRef.current = outputCtx;
      nextStartTimeRef.current = 0;
      if (inputCtx.state === "suspended") await inputCtx.resume();
      if (outputCtx.state === "suspended") await outputCtx.resume();

      const ticketResponse = await fetch("/api/live-ticket", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const ticketData = await ticketResponse.json();
      if (!ticketResponse.ok || !ticketData.ticket) {
        throw new Error(ticketData.message || "Impossible d’obtenir le ticket Live.");
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live-ws?ticket=${encodeURIComponent(ticketData.ticket)}`);
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: "start" }));

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "connected") {
          setStatus("connected");
        } else if (msg.type === "audio") {
          playAudioChunk(msg.audio);
        } else if (msg.type === "interrupted") {
          stopAllAudioPlayback();
        } else if (msg.type === "userTranscript") {
          setTranscript((prev) => (prev.trim() ? prev + "\n" : "") + "Vous : " + msg.text);
        } else if (msg.type === "text") {
          setTranscript((prev) => {
            const cleaned = prev.trim();
            const lastNewline = cleaned.lastIndexOf("\n");
            const lastLine = lastNewline !== -1 ? cleaned.substring(lastNewline + 1) : cleaned;
            if (lastLine.startsWith("JurisCoach :")) return prev + msg.text;
            return (cleaned ? cleaned + "\n" : "") + "JurisCoach : " + msg.text;
          });
        } else if (msg.type === "error") {
          setError(msg.message);
          setStatus("error");
        } else if (msg.type === "closed") {
          stopSession();
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
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "audio", audio: pcmToBase64(e.inputBuffer.getChannelData(0)) }));
        }
      };
    } catch (err: any) {
      setError(err.message || "Impossible d'accéder au micro ou de se connecter.");
      setStatus("error");
      stopSession();
    }
  };

  useEffect(() => () => stopSession(), []);

  if (!isPro) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-16 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800 mb-4">
          <Lock className="w-8 h-8 text-slate-500" />
        </div>
        <h2 className="text-xl font-display font-bold text-white mb-2">Fonctionnalité Pro</h2>
        <p className="text-sm text-slate-400">
          Le Live vocal (parler directement à JurisCoach comme à un avocat au téléphone) est réservé aux comptes Pro.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-5 py-8 space-y-5">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Live — Parler à JurisCoach</h2>
        <p className="text-sm text-slate-400 mt-1">Posez votre question juridique à voix haute, en direct.</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex flex-col items-center py-8">
        <button
          onClick={status === "connected" || status === "connecting" ? stopSession : startSession}
          className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            status === "connected" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
          }`}
        >
          {status === "connecting" ? (
            <Loader2 className="w-9 h-9 text-white animate-spin" />
          ) : status === "connected" ? (
            <PhoneOff className="w-9 h-9 text-white" />
          ) : (
            <Mic className="w-9 h-9 text-white" />
          )}
        </button>
        <p className="text-xs text-slate-400 mt-3">
          {status === "connecting" ? "Connexion..." : status === "connected" ? "En communication — touchez pour raccrocher" : "Touchez pour commencer"}
        </p>
      </div>

      {transcript && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 whitespace-pre-wrap text-xs text-slate-300 max-h-80 overflow-y-auto">
          {transcript}
        </div>
      )}

      <p className="text-[11px] text-slate-500 text-center px-4">
        Ce diagnostic vocal est une aide informative et ne remplace pas l'avis d'un avocat.
      </p>
    </div>
  );
}
