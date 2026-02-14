"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MissionStep } from "@/lib/parse-story";
import {
  BookOpen,
  Target,
  Swords,
  ChevronRight,
  ChevronDown,
  Check,
  Trophy,
  RotateCcw,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface MissionCanvasProps {
  title: string;
  concepts: string[];
  steps: MissionStep[];
  fullNarrative: string;
  onStepComplete: (stepId: string, choice: string | null, answer: string | null) => void;
  onReset: () => void;
}

/* ------------------------------------------------------------------ */
/*  Simple markdown-like renderer (bold, italic)                       */
/* ------------------------------------------------------------------ */

function RichText({ text }: { text: string }) {
  // Convert **text** → <strong> and *text* → <em>
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Step icon                                                          */
/* ------------------------------------------------------------------ */

function StepIcon({ type }: { type: MissionStep["type"] }) {
  const cls = "h-4 w-4";
  switch (type) {
    case "briefing":
      return <BookOpen className={cls} />;
    case "checkpoint":
      return <Target className={cls} />;
    case "boss":
      return <Swords className={cls} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Step indicator (top bar)                                           */
/* ------------------------------------------------------------------ */

function StepIndicator({
  steps,
  currentIndex,
}: {
  steps: MissionStep[];
  currentIndex: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-colors",
              step.completed
                ? "border-foreground bg-foreground text-background"
                : i === currentIndex
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground"
            )}
          >
            {step.completed ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              i + 1
            )}
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "h-px w-8 transition-colors",
                step.completed ? "bg-foreground" : "bg-border"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Active step view                                                   */
/* ------------------------------------------------------------------ */

function ActiveStep({
  step,
  onComplete,
}: {
  step: MissionStep;
  onComplete: (choice: string | null, answer: string | null) => void;
}) {
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");

  const hasChoices = step.choices.length > 0;
  const isBoss = step.type === "boss";
  const isCheckpoint = step.type === "checkpoint";

  // For checkpoint / boss: require answer text.  For briefing: require choice.
  const canProceed = hasChoices
    ? selectedChoice !== null
    : isBoss || isCheckpoint
      ? answer.trim().length > 0
      : true;

  const handleSubmit = () => {
    onComplete(selectedChoice, answer.trim() || null);
    setSelectedChoice(null);
    setAnswer("");
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Step header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-foreground">
          <StepIcon type={step.type} />
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {step.title}
          </p>
          <p className="text-sm font-medium text-foreground">{step.subtitle}</p>
        </div>
      </div>

      {/* Narrative */}
      <div className="rounded-lg border border-border p-4">
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          <RichText text={step.narrative} />
        </p>
      </div>

      {/* Choices (if any) */}
      {hasChoices && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Choose your path
          </p>
          {step.choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              onClick={() => setSelectedChoice(choice.label)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                selectedChoice === choice.label
                  ? "border-foreground bg-foreground/5"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                  selectedChoice === choice.label
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground"
                )}
              >
                {choice.label.slice(-1)}
              </span>
              <span className="text-sm leading-relaxed text-foreground">
                <RichText text={choice.text} />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Answer input (for checkpoint/boss when no choices) */}
      {!hasChoices && (isBoss || isCheckpoint) && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {isBoss ? "Your response" : "Your answer"}
          </p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={
              isBoss
                ? "Write your response to the challenge..."
                : "Type your answer..."
            }
            rows={isBoss ? 6 : 3}
            className="w-full rounded-lg border border-border bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
        </div>
      )}

      {/* Continue button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canProceed}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity disabled:opacity-30"
      >
        {isBoss ? "Complete Mission" : "Continue"}
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Completed step summary (collapsed)                                 */
/* ------------------------------------------------------------------ */

function CompletedStep({ step }: { step: MissionStep }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Check className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{step.title}</p>
        {step.userChoice && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            You chose: {step.userChoice}
          </p>
        )}
        {step.userAnswer && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            &ldquo;{step.userAnswer}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mission complete screen                                            */
/* ------------------------------------------------------------------ */

function MissionComplete({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-foreground">
        <Trophy className="h-8 w-8 text-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">
        Mission complete
      </h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        You&apos;ve worked through all three acts. Check off your to-do items on
        the right, or restart the mission for another run.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Restart mission
      </button>
    </div>
  );
}

function FullNarrativePanel({ narrative }: { narrative: string }) {
  const [expanded, setExpanded] = useState(true);

  if (!narrative.trim()) return null;

  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Full Study Narrative
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            expanded ? "rotate-180" : "rotate-0"
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            <RichText text={narrative} />
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function MissionCanvas({
  title,
  concepts,
  steps,
  fullNarrative,
  onStepComplete,
  onReset,
}: MissionCanvasProps) {
  const currentIndex = steps.findIndex((s) => !s.completed);
  const allDone = currentIndex === -1;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">
              {title || "Your Mission"}
            </h2>
            {concepts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {concepts.map((c) => (
                  <span
                    key={c}
                    className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
          <StepIndicator steps={steps} currentIndex={currentIndex} />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 space-y-5 p-5">
        <div>
          {allDone ? (
            <MissionComplete onReset={onReset} />
          ) : (
            <div className="space-y-3">
              {/* Already completed steps (collapsed) */}
              {steps.slice(0, currentIndex).map((step) => (
                <CompletedStep key={step.id} step={step} />
              ))}

              {/* Current step */}
              {currentIndex >= 0 && (
                <ActiveStep
                  key={steps[currentIndex].id}
                  step={steps[currentIndex]}
                  onComplete={(choice, answer) =>
                    onStepComplete(steps[currentIndex].id, choice, answer)
                  }
                />
              )}
            </div>
          )}
        </div>
        <FullNarrativePanel narrative={fullNarrative} />
      </div>
    </div>
  );
}
