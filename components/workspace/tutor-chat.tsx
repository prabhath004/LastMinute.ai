"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, Loader2, Mic, MicOff, Volume2, VolumeX, Square, X } from "lucide-react";
import { useVoiceInput } from "@/hooks/use-voice-input";

/* ------------------------------------------------------------------ */
/*  Silent WAV to unlock Chrome autoplay on first user gesture         */
/* ------------------------------------------------------------------ */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface TutorChatProps {
  /** Study context sent to the API so the tutor knows what you're learning */
  context: string;
  open: boolean;
  onClose: () => void;
}

export function TutorChat({ context, open, onClose }: TutorChatProps) {
  /* ---- existing state ---- */
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ---- voice state ---- */
  const {
    isSupported: sttSupported,
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    clearTranscript,
  } = useVoiceInput();
  const [speakEnabled, setSpeakEnabled] = useState(true);

  /* ---- audio refs (persistent element, unlocked on gesture) ---- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioUnlockedRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  /* ---- refs for current values (no stale closures) ---- */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const speakEnabledRef = useRef(speakEnabled);
  speakEnabledRef.current = speakEnabled;
  const contextRef = useRef(context);
  contextRef.current = context;

  /* ---- unlock audio on user gesture ---- */
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    const el = new Audio(SILENT_WAV);
    el.volume = 0;
    el.play()
      .then(() => { el.pause(); audioUnlockedRef.current = true; })
      .catch(() => { /* best-effort */ });
    audioRef.current = el;
  }, []);

  /* ---- auto-scroll ---- */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  /* ---- focus input when opening ---- */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* ---- when voice transcript finalizes, auto-send ---- */
  const hasSentRef = useRef(false);
  useEffect(() => {
    if (!isListening && transcript && !hasSentRef.current) {
      hasSentRef.current = true;
      send(transcript);
    }
    if (isListening) {
      hasSentRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, transcript]);

  /* ---- cleanup audio on unmount ---- */
  useEffect(() => {
    return () => {
      stopAudioPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- send message (works for both typed and voice) ---- */
  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;

      clearTranscript();
      if (!overrideText) setInput("");

      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const currentMessages = messagesRef.current;
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...currentMessages, userMsg],
            context: contextRef.current,
          }),
        });
        const data = await res.json();
        const answerText = data.content ?? "I'm not sure how to answer that.";

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answerText },
        ]);

        // TTS if enabled
        if (speakEnabledRef.current) {
          await speakAnswer(answerText);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong. Try again." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, loading, clearTranscript]
  );

  /* ---- TTS via /api/tts ---- */
  const speakAnswer = useCallback(async (text: string) => {
    setIsSpeaking(true);
    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        console.warn("TTS unavailable, text-only mode");
        setIsSpeaking(false);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;

      let audio = audioRef.current;
      if (!audio) { audio = new Audio(); audioRef.current = audio; }

      audio.onended = () => { setIsSpeaking(false); cleanupAudioUrl(); };
      audio.onerror = () => { setIsSpeaking(false); cleanupAudioUrl(); };
      audio.src = url;
      audio.volume = 1;
      await audio.play();
    } catch {
      console.warn("TTS playback failed");
      setIsSpeaking(false);
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; audio.onended = null; audio.onerror = null; }
    cleanupAudioUrl();
    setIsSpeaking(false);
  }, []);

  const cleanupAudioUrl = () => {
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
  };

  /* ---- mic toggle ---- */
  const toggleMic = useCallback(() => {
    unlockAudio();
    if (isSpeaking) stopAudioPlayback();
    if (isListening) {
      stopListening();
    } else {
      clearTranscript();
      startListening();
    }
  }, [isListening, isSpeaking, unlockAudio, stopAudioPlayback, stopListening, clearTranscript, startListening]);

  /* ---- keyboard ---- */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      unlockAudio();
      send();
    }
  };

  if (!open) return null;

  return (
    <div className="flex h-full flex-col border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Tutor
        </span>
        <div className="flex items-center gap-1">
          {/* Speak toggle */}
          <button
            type="button"
            onClick={() => setSpeakEnabled(!speakEnabled)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title={speakEnabled ? "Mute voice replies" : "Enable voice replies"}
          >
            {speakEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {sttSupported
              ? "Ask anything — type or press the mic."
              : "Ask anything about the material."}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed",
              msg.role === "user"
                ? "ml-auto bg-foreground text-background"
                : "mr-auto border border-border text-foreground"
            )}
          >
            {msg.content}
          </div>
        ))}

        {/* Live transcript while listening */}
        {isListening && (interimTranscript || transcript) && (
          <div className="ml-auto max-w-[90%] rounded-lg bg-foreground/80 px-3 py-2 text-xs text-background italic">
            {interimTranscript || transcript}...
          </div>
        )}

        {loading && (
          <div className="mr-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Thinking...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Stop speaking bar */}
      {isSpeaking && (
        <div className="border-t border-border px-2 py-1.5">
          <button
            type="button"
            onClick={stopAudioPlayback}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Square className="h-3 w-3" />
            Stop speaking
          </button>
        </div>
      )}

      {/* Input row */}
      <div className="border-t border-border p-2">
        <div className="flex items-end gap-1.5">
          {/* Mic button */}
          {sttSupported && (
            <button
              type="button"
              onClick={toggleMic}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={isListening ? "Stop listening" : "Speak your question"}
            >
              {isListening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { unlockAudio(); send(); }}
            disabled={!input.trim() || loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
