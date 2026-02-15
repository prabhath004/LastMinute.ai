"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Square,
  X,
} from "lucide-react";
import { useVoiceInput } from "@/hooks/use-voice-input";

/* ------------------------------------------------------------------ */
/*  Silent WAV to unlock Chrome autoplay on first user gesture         */
/* ------------------------------------------------------------------ */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

type AgentState = "idle" | "listening" | "thinking" | "speaking";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface TutorChatProps {
  context: string;
  open: boolean;
  onClose: () => void;
}

export function TutorChat({ context, open, onClose }: TutorChatProps) {
  /* ---- core state ---- */
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ---- voice input ---- */
  const {
    isSupported: sttSupported,
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    clearTranscript,
  } = useVoiceInput();

  /* ---- refs: always-current values (never stale) ---- */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const speakEnabledRef = useRef(speakEnabled);
  speakEnabledRef.current = speakEnabled;
  const contextRef = useRef(context);
  contextRef.current = context;
  const agentStateRef = useRef(agentState);
  agentStateRef.current = agentState;
  // Use a ref for "busy" so voice-triggered sends are never blocked
  // by a stale `loading` closure
  const busyRef = useRef(false);

  /* ---- audio refs ---- */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioUnlockedRef = useRef(false);
  // AbortController to cancel in-flight TTS fetches on interrupt
  const ttsAbortRef = useRef<AbortController | null>(null);

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
  }, [messages, agentState]);

  /* ---- focus input when opening ---- */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* ---- sync listening → agentState ---- */
  useEffect(() => {
    if (isListening && agentStateRef.current !== "listening") {
      setAgentState("listening");
    }
    if (!isListening && agentStateRef.current === "listening" && !transcript) {
      setAgentState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  /* ---- when voice transcript finalizes → auto-send ---- */
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

  /* ---- cleanup on unmount ---- */
  useEffect(() => {
    return () => { stopAllAudio(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================================================================ */
  /*  AUDIO: stop / cleanup / speak                                    */
  /* ================================================================ */

  const stopAllAudio = useCallback(() => {
    // 1. Cancel any in-flight TTS fetch
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    // 2. Stop any playing audio
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    }
    // 3. Clean URL
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    // 4. Reset state only if we were speaking
    if (agentStateRef.current === "speaking") {
      setAgentState("idle");
    }
  }, []);

  const speakAnswer = useCallback(async (text: string) => {
    // Always stop previous audio first
    stopAllAudio();

    if (!speakEnabledRef.current) return;

    setAgentState("speaking");

    const controller = new AbortController();
    ttsAbortRef.current = controller;

    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      // If we were aborted while waiting, bail
      if (controller.signal.aborted) return;

      if (!resp.ok) {
        console.warn("TTS unavailable, text-only mode");
        setAgentState("idle");
        return;
      }

      const blob = await resp.blob();
      if (controller.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;

      let audio = audioRef.current;
      if (!audio) { audio = new Audio(); audioRef.current = audio; }

      audio.onended = () => {
        setAgentState("idle");
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
      };
      audio.onerror = () => {
        setAgentState("idle");
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
      };

      audio.src = url;
      audio.volume = 1;
      await audio.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Expected when interrupted — not an error
        return;
      }
      console.warn("TTS playback failed:", err);
      if (agentStateRef.current === "speaking") setAgentState("idle");
    }
  }, [stopAllAudio]);

  /* ================================================================ */
  /*  SEND: works for both typed and voice input                       */
  /* ================================================================ */

  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text) return;

      // If already busy, don't double-send (but voice interrupts are
      // handled by stopAllAudio before we get here)
      if (busyRef.current) return;

      // ALWAYS stop any playing audio when a new question arrives
      stopAllAudio();

      clearTranscript();
      if (!overrideText) setInput("");
      busyRef.current = true;

      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setAgentState("thinking");

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

        // TTS (speakAnswer handles its own state)
        await speakAnswer(answerText);

        // If TTS was skipped/disabled, go idle
        if (agentStateRef.current === "thinking") {
          setAgentState("idle");
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong. Try again." },
        ]);
        setAgentState("idle");
      } finally {
        busyRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, clearTranscript, stopAllAudio, speakAnswer]
  );

  /* ---- mic toggle: ALWAYS interrupts ---- */
  const toggleMic = useCallback(() => {
    unlockAudio();
    // Always stop audio first — this is the interrupt
    stopAllAudio();

    if (isListening) {
      stopListening();
    } else {
      clearTranscript();
      startListening();
      setAgentState("listening");
    }
  }, [isListening, unlockAudio, stopAllAudio, stopListening, clearTranscript, startListening]);

  /* ---- keyboard ---- */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      unlockAudio();
      send();
    }
  };

  if (!open) return null;

  /* ================================================================ */
  /*  RENDER: Agent-style UI                                           */
  /* ================================================================ */

  const stateLabel: Record<AgentState, string> = {
    idle: "Ask me anything",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
  };

  return (
    <div className="flex h-full flex-col border-t border-border">
      {/* ── Agent State Header ── */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Animated orb */}
          <span
            className={cn(
              "relative flex h-2.5 w-2.5 shrink-0 rounded-full",
              agentState === "idle" && "bg-muted-foreground/40",
              agentState === "listening" && "bg-red-500",
              agentState === "thinking" && "bg-amber-500",
              agentState === "speaking" && "bg-green-500"
            )}
          >
            {agentState !== "idle" && (
              <span
                className={cn(
                  "absolute inset-0 rounded-full animate-ping",
                  agentState === "listening" && "bg-red-400",
                  agentState === "thinking" && "bg-amber-400",
                  agentState === "speaking" && "bg-green-400"
                )}
              />
            )}
          </span>
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
            {stateLabel[agentState]}
          </span>
        </div>
        <div className="flex items-center gap-1">
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

      {/* ── Messages ── */}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full",
                "bg-muted text-muted-foreground"
              )}
            >
              <Mic className="h-5 w-5" />
            </div>
            <p className="text-center text-xs text-muted-foreground leading-relaxed">
              {sttSupported
                ? "Press the mic below or type to ask\nyour study tutor anything."
                : "Type a question to ask your\nstudy tutor anything."}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed",
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
          <div className="ml-auto max-w-[92%] rounded-lg bg-foreground/70 px-3 py-2 text-xs text-background italic">
            {interimTranscript || transcript}...
          </div>
        )}

        {/* Thinking indicator */}
        {agentState === "thinking" && (
          <div className="mr-auto flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <div className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
            </div>
            <span className="text-[11px] text-muted-foreground">Thinking...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Stop speaking bar (only when speaking) ── */}
      {agentState === "speaking" && (
        <div className="px-3 py-1.5">
          <button
            type="button"
            onClick={stopAllAudio}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Square className="h-2.5 w-2.5" />
            Stop speaking
          </button>
        </div>
      )}

      {/* ── Input Area: Mic hero + text secondary ── */}
      <div className="border-t border-border px-3 pb-3 pt-2">
        {/* Big mic button */}
        {sttSupported && (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              onClick={toggleMic}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200",
                "shadow-sm",
                isListening
                  ? "bg-red-500 text-white ring-4 ring-red-200 scale-110"
                  : agentState === "speaking"
                    ? "bg-green-500/10 text-green-600 ring-2 ring-green-200 hover:bg-green-500/20"
                    : "bg-foreground text-background hover:scale-105"
              )}
              title={
                isListening
                  ? "Stop listening"
                  : agentState === "speaking"
                    ? "Interrupt & ask"
                    : "Press to speak"
              }
            >
              {isListening ? (
                <MicOff className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>
          </div>
        )}

        {/* Text input row */}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Or type here..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { unlockAudio(); send(); }}
            disabled={!input.trim() || busyRef.current}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
