"use client";

import { useRef, useEffect } from "react";
import type { TopicStorylineCard } from "@/types";
import type { StoryBeat } from "@/app/api/upload/route";
import { ChevronLeft, ChevronRight, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LessonViewProps {
  activeTopicId: string | null;
  missionTitle: string;
  missionStory: string;
  topicStorylines: TopicStorylineCard[];
  storyBeats: StoryBeat[];
  currentStoryIndex: number;
  totalStories: number;
  canGoPrevStory: boolean;
  canGoNextStory: boolean;
  onPrevStory: () => void;
  onNextStory: () => void;
  loading: boolean;
}

/** Try to find beat images relevant to this topic card's concepts */
function findBeatsForTopic(
  card: TopicStorylineCard,
  beats: StoryBeat[]
): StoryBeat[] {
  if (!beats || beats.length === 0) return [];
  const topicLabels = [
    ...card.topics.map((t) => t.toLowerCase().trim()),
    ...card.subtopics.map((s) => s.toLowerCase().trim()),
    card.title.toLowerCase().trim(),
  ].filter(Boolean);

  return beats.filter((beat) => {
    const beatLabel = beat.label.toLowerCase().trim();
    if (!beatLabel) return false;
    return topicLabels.some(
      (tl) => tl.includes(beatLabel) || beatLabel.includes(tl)
    );
  });
}

/** Render a single story beat with its images */
function StoryBeatImages({ beat }: { beat: StoryBeat }) {
  const images = beat.image_steps.filter((s) => s.image_data);
  if (images.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Visual — {beat.label}
        </p>
      </div>
      {beat.narrative && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {beat.narrative}
        </p>
      )}
      <div
        className={cn(
          "grid gap-3",
          images.length === 1
            ? "grid-cols-1"
            : images.length === 2
              ? "grid-cols-2"
              : "grid-cols-1 sm:grid-cols-3"
        )}
      >
        {images.map((step, idx) => (
          <div
            key={`${beat.label}-step-${idx}`}
            className="overflow-hidden rounded-lg border border-border bg-muted/20"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={step.image_data}
              alt={step.step_label || `${beat.label} diagram ${idx + 1}`}
              className="h-auto w-full object-contain"
            />
            {step.step_label && (
              <p className="border-t border-border bg-muted/30 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                {step.step_label}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LessonView({
  activeTopicId,
  missionTitle,
  missionStory,
  topicStorylines,
  storyBeats,
  currentStoryIndex,
  totalStories,
  canGoPrevStory,
  canGoNextStory,
  onPrevStory,
  onNextStory,
  loading,
}: LessonViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cleanCardTitle = (rawTitle: string, fallback: string) => {
    const cleaned = rawTitle
      .replace(/^explanation\s*[-—:]\s*/i, "")
      .replace(/^story\s*card\s*\d+\s*[-—:]\s*/i, "")
      .trim();
    return cleaned || fallback;
  };

  // Scroll to active topic when it changes
  useEffect(() => {
    if (activeTopicId && scrollRef.current) {
      const el = scrollRef.current.querySelector(
        `[data-topic-id="${activeTopicId}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [activeTopicId]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm text-foreground">
            Loading your story cards...
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Preparing your mission workspace
          </p>
        </div>
      </div>
    );
  }

  if (topicStorylines.length === 0 && !missionStory.trim()) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No story cards available. Upload study materials first.
        </p>
      </div>
    );
  }

  // Match beats to topics: first by label match, then by position (1:1), then round-robin
  const beatsByTopicIndex: Map<number, StoryBeat[]> = new Map();
  const usedBeatIndices = new Set<number>();

  // Pass 1: match by label (fuzzy)
  topicStorylines.forEach((card, topicIdx) => {
    const matched = findBeatsForTopic(card, storyBeats);
    if (matched.length > 0) {
      beatsByTopicIndex.set(topicIdx, [...matched]);
      matched.forEach((b) => {
        const bi = storyBeats.indexOf(b);
        if (bi >= 0) usedBeatIndices.add(bi);
      });
    }
  });

  // Pass 2: for topics with no label match, try positional (beat[i] → topic[i])
  topicStorylines.forEach((_, topicIdx) => {
    if (beatsByTopicIndex.has(topicIdx)) return;
    if (topicIdx < storyBeats.length && !usedBeatIndices.has(topicIdx)) {
      const beat = storyBeats[topicIdx];
      if (beat.image_steps.some((s) => s.image_data)) {
        beatsByTopicIndex.set(topicIdx, [beat]);
        usedBeatIndices.add(topicIdx);
      }
    }
  });

  // Pass 3: any remaining unmatched beats → distribute round-robin to topics without images
  const unmatchedBeats = storyBeats.filter(
    (_, i) => !usedBeatIndices.has(i) && storyBeats[i].image_steps.some((s) => s.image_data)
  );
  if (unmatchedBeats.length > 0) {
    const emptyTopicIndices = Array.from(
      { length: topicStorylines.length },
      (_, i) => i
    ).filter((i) => !beatsByTopicIndex.has(i));

    unmatchedBeats.forEach((beat, i) => {
      const targetIdx =
        emptyTopicIndices.length > 0
          ? emptyTopicIndices[i % emptyTopicIndices.length]
          : i % topicStorylines.length;
      const existing = beatsByTopicIndex.get(targetIdx) ?? [];
      existing.push(beat);
      beatsByTopicIndex.set(targetIdx, existing);
    });
  }

  const currentBeats = beatsByTopicIndex.get(currentStoryIndex) ?? [];

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {topicStorylines.length > 0 ? (
          <section className="mb-8 space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-5">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                {missionTitle}
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Story-driven revision guide for your exam prep.
              </p>
            </div>
            {topicStorylines
              .filter((_, idx) => idx === currentStoryIndex)
              .map((card) => {
              const absoluteIdx = currentStoryIndex;
              const importance = card.importance?.toLowerCase?.() ?? "medium";
              const importanceClass =
                importance === "high"
                  ? "border-foreground/50 bg-foreground/5 text-foreground"
                  : importance === "low"
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-border bg-background text-foreground";
              return (
                <article
                  key={`${card.title}-${absoluteIdx}`}
                  data-topic-id={`story-${absoluteIdx}`}
                  className="rounded-lg border border-border bg-background p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      Explanation —{" "}
                      {cleanCardTitle(card.title || "", `Focus Area ${absoluteIdx + 1}`)}
                    </h3>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                        importanceClass
                      )}
                    >
                      {importance.toUpperCase()}
                    </span>
                  </div>

                  {card.topics.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {card.topics.map((topic) => (
                        <span
                          key={topic}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}

                  {card.subtopics.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {card.subtopics.map((subtopic, subIdx) => (
                        <li
                          key={`${subtopic}-${subIdx}`}
                          className="text-sm text-muted-foreground"
                        >
                          • {subtopic}
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {card.story}
                  </p>

                  {/* ---- Story beat images for this topic ---- */}
                  {currentBeats.length > 0 && (
                    <div className="mt-5 space-y-4 border-t border-border pt-4">
                      {currentBeats.map((beat, beatIdx) => (
                        <StoryBeatImages
                          key={`beat-${beat.label}-${beatIdx}`}
                          beat={beat}
                        />
                      ))}
                    </div>
                  )}

                  {card.friend_explainers && card.friend_explainers.length > 0 && (
                    <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Friend-style explainers
                      </p>
                      <ul className="space-y-1.5">
                        {card.friend_explainers.map((line, lineIdx) => (
                          <li
                            key={`${line}-${lineIdx}`}
                            className="text-sm text-muted-foreground"
                          >
                            • {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Topic {Math.min(currentStoryIndex + 1, Math.max(totalStories, 1))} / {Math.max(totalStories, 1)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPrevStory}
                  disabled={!canGoPrevStory}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors",
                    canGoPrevStory
                      ? "border-border text-foreground hover:bg-muted"
                      : "cursor-not-allowed border-border text-muted-foreground/40"
                  )}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back Topic
                </button>
                <button
                  type="button"
                  onClick={onNextStory}
                  disabled={!canGoNextStory}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors",
                    canGoNextStory
                      ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
                      : "cursor-not-allowed border-border text-muted-foreground/40"
                  )}
                >
                  Next Topic
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </section>
        ) : missionStory.trim() && (
          <section className="mb-8 rounded-lg border border-border bg-muted/30 p-5">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {missionTitle}
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {missionStory}
            </p>
          </section>
        )}

      </div>
    </div>
  );
}
