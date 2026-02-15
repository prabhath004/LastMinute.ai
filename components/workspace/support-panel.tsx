"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChecklistItem, HintLevel, MisconceptionLogEntry } from "@/types";
import { Check, MessageSquare, MessageCircle } from "lucide-react";
import { TutorChat } from "@/components/workspace/tutor-chat";

interface SupportPanelProps {
  checklist: ChecklistItem[];
  onChecklistToggle: (id: string) => void;
  hints: HintLevel[];
  onRevealHint: (level: number) => void;
  misconceptions: MisconceptionLogEntry[];
  tutorContext: string;
  completedSteps: number;
  totalSteps: number;
}

export function SupportPanel({
  checklist,
  onChecklistToggle,
  hints,
  onRevealHint,
  misconceptions,
  tutorContext,
  completedSteps,
  totalSteps,
}: SupportPanelProps) {
  const [tutorOpen, setTutorOpen] = useState(false);

  const progressPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div className="flex h-full flex-col border-l border-border">
      {/* Scrollable top section — shrinks when tutor is open */}
      <div
        className={cn(
          "space-y-5 overflow-y-auto p-4 shrink-0",
          tutorOpen ? "max-h-[40%]" : "flex-1"
        )}
      >
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
            onClick={() => setTutorOpen(!tutorOpen)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
              tutorOpen
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:bg-muted"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {tutorOpen ? "Close tutor" : "Ask tutor"}
          </button>
        </section>

        {/* Misconceptions (only show when tutor closed) */}
        {!tutorOpen && misconceptions.length > 0 && (
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

      {/* Tutor chat (takes remaining space, min-h-0 lets flex child scroll) */}
      <div className={cn("min-h-0", tutorOpen ? "flex-1" : "hidden")}>
        <TutorChat
          context={tutorContext}
          open={tutorOpen}
          onClose={() => setTutorOpen(false)}
        />
      </div>
    </div>
  );
}
