"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TopicNav } from "@/components/workspace/topic-nav";
import { MissionCanvas } from "@/components/workspace/mission-canvas";
import { SupportPanel } from "@/components/workspace/support-panel";
import { parseMissionContent, type MissionStep } from "@/lib/parse-story";
import { Loader2 } from "lucide-react";
import type {
  ChecklistItem,
  HintLevel,
  WorkspaceTopic,
  MisconceptionLogEntry,
} from "@/types";

type LoadState = "loading" | "ready" | "error";

interface WorkspaceUploadSnapshot {
  interactive_story: {
    title: string;
    opening: string;
    checkpoint: string;
    boss_level: string;
  };
  final_storytelling: string;
  concepts: string[];
  checklist: string[];
}

interface WorkspaceViewModel {
  missionTitle: string;
  concepts: string[];
  steps: MissionStep[];
  checklist: ChecklistItem[];
  hints: HintLevel[];
  tutorContext: string;
  fullNarrative: string;
  topics: WorkspaceTopic[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeUploadSnapshot(value: unknown): WorkspaceUploadSnapshot | null {
  const root = asRecord(value);
  if (!root) return null;

  const interactive = asRecord(root.interactive_story) ?? {};
  return {
    interactive_story: {
      title: asString(interactive.title),
      opening: asString(interactive.opening),
      checkpoint: asString(interactive.checkpoint),
      boss_level: asString(interactive.boss_level),
    },
    final_storytelling: asString(root.final_storytelling),
    concepts: asStringArray(root.concepts),
    checklist: asStringArray(root.checklist),
  };
}

function buildViewModel(upload: WorkspaceUploadSnapshot): WorkspaceViewModel {
  const parsed = parseMissionContent({
    title: upload.interactive_story.title,
    interactiveStory: upload.interactive_story,
    finalStorytelling: upload.final_storytelling,
  });

  const concepts = upload.concepts;
  const checklist: ChecklistItem[] = upload.checklist.map((label, index) => ({
    id: `cl-${index}`,
    label,
    done: false,
  }));
  const topics: WorkspaceTopic[] = concepts.map((name, index) => ({
    id: `t-${index}`,
    name,
    progress: 0,
    weak: false,
  }));

  const hints: HintLevel[] = parsed.fullNarrative
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 20)
    .slice(0, 6)
    .map((text, index) => ({
      level: index + 1,
      text,
      revealed: false,
    }));

  const tutorContext = [
    parsed.title,
    concepts.length > 0 ? `Concepts: ${concepts.join(", ")}` : "",
    parsed.fullNarrative,
    ...parsed.steps.map((step) => step.narrative),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    missionTitle: parsed.title,
    concepts,
    steps: parsed.steps,
    checklist,
    hints,
    tutorContext,
    fullNarrative: parsed.fullNarrative,
    topics,
  };
}

export default function WorkspacePage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");

  /* ---- data ---- */
  const [topics, setTopics] = useState<WorkspaceTopic[]>([]);
  const [missionTitle, setMissionTitle] = useState("");
  const [concepts, setConcepts] = useState<string[]>([]);
  const [steps, setSteps] = useState<MissionStep[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [hints, setHints] = useState<HintLevel[]>([]);
  const [misconceptions] = useState<MisconceptionLogEntry[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [tutorContext, setTutorContext] = useState("");
  const [fullNarrative, setFullNarrative] = useState("");

  /* ---- load from sessionStorage ---- */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lastminute_upload");
      if (!raw) {
        setLoadState("error");
        return;
      }

      const uploads = JSON.parse(raw) as unknown;
      if (!Array.isArray(uploads) || uploads.length === 0) {
        setLoadState("error");
        return;
      }

      const upload = normalizeUploadSnapshot(uploads[0]);
      if (!upload) {
        setLoadState("error");
        return;
      }

      const model = buildViewModel(upload);
      setTopics(model.topics);
      setSelectedTopicId(model.topics[0]?.id ?? null);
      setConcepts(model.concepts);
      setMissionTitle(model.missionTitle);
      setSteps(model.steps);
      setChecklist(model.checklist);
      setHints(model.hints);
      setTutorContext(model.tutorContext);
      setFullNarrative(model.fullNarrative);

      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  /* ---- step completion ---- */
  const handleStepComplete = useCallback(
    (stepId: string, choice: string | null, answer: string | null) => {
      setSteps((prevSteps) => {
        const nextSteps = prevSteps.map((step) =>
          step.id === stepId
            ? {
                ...step,
                completed: true,
                userChoice: choice,
                userAnswer: answer,
              }
            : step
        );

        const completedCount = nextSteps.filter((step) => step.completed).length;
        const totalSteps = Math.max(nextSteps.length, 1);
        const nextProgress = Math.min(1, completedCount / totalSteps);

        setTopics((previousTopics) => {
          if (previousTopics.length === 0) return previousTopics;
          const focusTopicId = selectedTopicId ?? previousTopics[0].id;
          return previousTopics.map((topic) =>
            topic.id === focusTopicId
              ? { ...topic, progress: nextProgress }
              : topic
          );
        });

        return nextSteps;
      });
    },
    [selectedTopicId]
  );

  /* ---- mission reset ---- */
  const handleReset = useCallback(() => {
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        completed: false,
        userChoice: null,
        userAnswer: null,
      }))
    );
    setTopics((prev) => prev.map((topic) => ({ ...topic, progress: 0 })));
  }, []);

  /* ---- checklist ---- */
  const handleChecklistToggle = useCallback((id: string) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
      )
    );
  }, []);

  /* ---- hints ---- */
  const handleRevealHint = useCallback((level: number) => {
    setHints((prev) =>
      prev.map((h) => (h.level === level ? { ...h, revealed: true } : h))
    );
  }, []);

  /* ---- loading ---- */
  if (loadState === "loading") {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  /* ---- error ---- */
  if (loadState === "error") {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <h1 className="font-mono text-lg font-bold tracking-tighter text-foreground">
          lastminute<span className="text-muted-foreground">.ai</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          No study materials found. Upload something first.
        </p>
        <Link
          href="/"
          className="rounded-md border border-foreground px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Go back and upload
        </Link>
      </main>
    );
  }

  /* ---- workspace ---- */
  const completedSteps = steps.filter((s) => s.completed).length;

  return (
    <main className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-sm font-bold tracking-tighter text-foreground">
          lastminute<span className="text-muted-foreground">.ai</span>
        </span>
        <Link
          href="/"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Back
        </Link>
      </header>

      <div className="grid flex-1 grid-cols-[200px_1fr_260px] overflow-hidden">
        <TopicNav
          topics={topics}
          selectedId={selectedTopicId ?? topics[0]?.id ?? null}
          onSelect={setSelectedTopicId}
        />
        <MissionCanvas
          title={missionTitle}
          concepts={concepts}
          steps={steps}
          fullNarrative={fullNarrative}
          onStepComplete={handleStepComplete}
          onReset={handleReset}
        />
        <SupportPanel
          checklist={checklist}
          onChecklistToggle={handleChecklistToggle}
          hints={hints}
          onRevealHint={handleRevealHint}
          misconceptions={misconceptions}
          tutorContext={tutorContext}
          completedSteps={completedSteps}
          totalSteps={steps.length}
        />
      </div>
    </main>
  );
}
