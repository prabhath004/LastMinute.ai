"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChecklistItem, HintLevel, MisconceptionLogEntry } from "@/types";
import { Check, MessageCircle, Sparkles, TriangleAlert } from "lucide-react";
import { TutorChat } from "@/components/workspace/tutor-chat";
import { useEffect } from "react";

interface SupportPanelProps {
  checklist: ChecklistItem[];
  onChecklistToggle: (id: string) => void;
  hints: HintLevel[];
  onRevealHint: (level: number) => void;
  misconceptions: MisconceptionLogEntry[];
  weakConcepts?: Array<{ name: string; misses: number }>;
  tutorContext: string;
  completedSteps: number;
  totalSteps: number;
  /** External trigger to open Voxi (e.g. from wake-word "Hey Voxi") */
  voxiOpenTrigger?: number;
  /** Callback so parent knows if Voxi is open (for disabling wake-word) */
  onVoxiOpenChange?: (open: boolean) => void;
  /** Current slide image for "Draw on slide" in Voxi chat */
  currentSlideImage?: { src: string; alt: string } | null;
  /** Topic draw mode: draw anywhere on the lesson */
  drawMode?: boolean;
  onDrawModeChange?: (on: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function SupportPanel({
  checklist,
  onChecklistToggle,
  hints,
  onRevealHint,
  misconceptions,
  weakConcepts = [],
  tutorContext,
  completedSteps,
  totalSteps,
  voxiOpenTrigger,
  onVoxiOpenChange,
  currentSlideImage,
  drawMode = false,
  onDrawModeChange,
  className,
  style,
}: SupportPanelProps) {
  const [tutorOpen, setTutorOpen] = useState(false);
  const handleDrawModeToggle = () => {
    onDrawModeChange?.(!drawMode);
  };

  // Open Voxi when wake-word fires (voxiOpenTrigger increments)
  useEffect(() => {
    if (voxiOpenTrigger && voxiOpenTrigger > 0) {
      setTutorOpen(true);
    }
  }, [voxiOpenTrigger]);

  // Notify parent of open state
  useEffect(() => {
    onVoxiOpenChange?.(tutorOpen);
  }, [tutorOpen, onVoxiOpenChange]);

  const progressPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div
      className={cn("flex h-full flex-col border-l border-border", className)}
      style={style}
    >
      {/* When Voxi is open: only chat. When closed: checklist + progress + Ask Voxi. */}
      {!tutorOpen && (
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* Progress summary */}
        <section>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Topics {completedSteps}/{totalSteps}
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-foreground transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </section>

        {weakConcepts.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Focus now
            </h3>
            <ul className="space-y-1.5">
              {weakConcepts.map((item) => (
                <li
                  key={item.name}
                  className="flex items-center justify-between rounded-md border border-border px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs text-foreground">{item.name}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {item.misses} miss{item.misses > 1 ? "es" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Checklist generated from pipeline */}
        <section>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Subtopics checklist
          </h3>
          <ul className="space-y-0.5">
            {checklist.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onChecklistToggle(item.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                      item.done
                        ? "border-foreground bg-foreground text-background"
                        : "border-border"
                    )}
                  >
                    {item.done && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      item.done && "text-muted-foreground line-through"
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Ask tutor toggle */}
        <section>
          <button
            type="button"
            onClick={() => {
              const next = !tutorOpen;
              setTutorOpen(next);
              if (next) onVoxiOpenChange?.(true);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
              tutorOpen
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:bg-muted"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {tutorOpen ? "Close Voxi" : "Ask Voxi"}
          </button>
        </section>

        {/* Misconceptions (only show when tutor closed) */}
        {misconceptions.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Misconceptions
            </h3>
            <ul className="space-y-1.5">
              {misconceptions.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
                >
                  <MessageCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">
                    {m.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      )}

      {/* Tutor chat: full height when open */}
      <div className={cn("min-h-0", tutorOpen ? "flex-1" : "hidden")}>
        <TutorChat
          context={tutorContext}
          open={tutorOpen}
          onClose={() => setTutorOpen(false)}
          drawMode={drawMode}
          onDrawModeToggle={onDrawModeChange ? handleDrawModeToggle : undefined}
          voxiOpenTrigger={voxiOpenTrigger ?? 0}
        />
      </div>
    </div>
  );
}
