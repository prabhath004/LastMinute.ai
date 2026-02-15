"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import type { TopicStorylineCard } from "@/types";
import type { StoryBeat } from "@/app/api/upload/route";
import { ChevronLeft, ChevronRight, Loader2, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/use-voice-input";

interface LessonViewProps {
  activeTopicId: string | null;
  missionTitle: string;
  missionStory: string;
  topicStorylines: TopicStorylineCard[];
  quizAttempts: Record<
    number,
    {
      selectedIndex: number | null;
      submitted: boolean;
      isCorrect: boolean | null;
      feedback: string;
      openAnswer: string;
      openSubmitted: boolean;
      openPassed: boolean;
      openFeedback: string;
    }
  >;
  storyBeats: StoryBeat[];
  currentStoryIndex: number;
  totalStories: number;
  canGoPrevStory: boolean;
  canGoNextStory: boolean;
  currentTopicPassed: boolean;
  requireQuizToAdvance: boolean;
  onPrevStory: () => void;
  onNextStory: () => void;
  onQuizOptionSelect: (topicIdx: number, optionIdx: number) => void;
  onQuizSubmit: (topicIdx: number) => void;
  onOpenAnswerChange: (topicIdx: number, value: string) => void;
  onOpenAnswerSubmit: (topicIdx: number) => void;
  disableVoiceInput?: boolean;
  onVoiceListeningChange?: (isListening: boolean) => void;
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

export function LessonView({
  activeTopicId,
  missionTitle,
  missionStory,
  topicStorylines,
  quizAttempts,
  storyBeats,
  currentStoryIndex,
  totalStories,
  canGoPrevStory,
  canGoNextStory,
  currentTopicPassed,
  requireQuizToAdvance,
  onPrevStory,
  onNextStory,
  onQuizOptionSelect,
  onQuizSubmit,
  onOpenAnswerChange,
  onOpenAnswerSubmit,
  disableVoiceInput = false,
  onVoiceListeningChange,
  loading,
}: LessonViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const {
    isSupported: voiceSupported,
    isListening: isVoiceListening,
    transcript: voiceTranscript,
    startListening: startVoiceListening,
    stopListening: stopVoiceListening,
    clearTranscript: clearVoiceTranscript,
  } = useVoiceInput();
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

  useEffect(() => {
    if (isVoiceListening || !voiceTranscript.trim()) return;
    onOpenAnswerChange(currentStoryIndex, voiceTranscript.trim());
    clearVoiceTranscript();
  }, [
    isVoiceListening,
    voiceTranscript,
    currentStoryIndex,
    onOpenAnswerChange,
    clearVoiceTranscript,
  ]);

  useEffect(() => {
    onVoiceListeningChange?.(isVoiceListening);
  }, [isVoiceListening, onVoiceListeningChange]);

  useEffect(() => {
    return () => onVoiceListeningChange?.(false);
  }, [onVoiceListeningChange]);

  useEffect(() => {
    if (disableVoiceInput && isVoiceListening) {
      stopVoiceListening();
    }
  }, [disableVoiceInput, isVoiceListening, stopVoiceListening]);

  useEffect(() => {
    setActiveSlideIndex(0);
  }, [currentStoryIndex]);

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
  const currentBeatImages = currentBeats
    .flatMap((beat) => beat.image_steps)
    .filter((step) => step.image_data)
    .slice(0, 4);
  const currentCard = topicStorylines[currentStoryIndex];
  const storySlides = useMemo(() => {
    const storyText = String(currentCard?.story ?? "").trim();
    if (!storyText) return [];
    const paragraphs = storyText
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter((line) => line.length > 25);
    if (paragraphs.length > 0) return paragraphs.slice(0, 8);

    const sentences = storyText
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 15);
    const grouped: string[] = [];
    for (let idx = 0; idx < sentences.length; idx += 2) {
      grouped.push([sentences[idx], sentences[idx + 1]].filter(Boolean).join(" "));
    }
    return grouped.slice(0, 8);
  }, [currentCard?.story]);
  const safeSlideIndex = Math.max(0, Math.min(activeSlideIndex, Math.max(storySlides.length - 1, 0)));
  const onLastSlide = storySlides.length === 0 || safeSlideIndex >= storySlides.length - 1;

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
              const quizAttempt = quizAttempts[absoluteIdx];
              const currentSlide = storySlides[safeSlideIndex] || "";
              return (
                <article
                  key={`${card.title}-${absoluteIdx}`}
                  data-topic-id={`story-${absoluteIdx}`}
                  className="rounded-lg border border-border bg-background p-5"
                >
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    {cleanCardTitle(card.title || "", `Focus Area ${absoluteIdx + 1}`)}
                  </h3>

                  <div className="mt-4 rounded-md border border-border bg-muted/20 p-4">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                      {currentSlide || card.story}
                    </p>
                    {currentBeatImages[safeSlideIndex]?.image_data && (
                      <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={currentBeatImages[safeSlideIndex].image_data}
                          alt={
                            currentBeatImages[safeSlideIndex].step_label ||
                            `${card.title} visual ${safeSlideIndex + 1}`
                          }
                          className="h-auto w-full object-contain"
                          draggable={false}
                        />
                      </div>
                    )}
                    {storySlides.length > 1 && (
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Story slide {safeSlideIndex + 1} / {storySlides.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                            disabled={safeSlideIndex === 0}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs transition-colors",
                              safeSlideIndex === 0
                                ? "cursor-not-allowed border-border text-muted-foreground/40"
                                : "border-border text-foreground hover:bg-muted"
                            )}
                          >
                            Prev Slide
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSlideIndex((prev) =>
                                Math.min(storySlides.length - 1, prev + 1)
                              )
                            }
                            disabled={safeSlideIndex >= storySlides.length - 1}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs transition-colors",
                              safeSlideIndex >= storySlides.length - 1
                                ? "cursor-not-allowed border-border text-muted-foreground/40"
                                : "border-border text-foreground hover:bg-muted"
                            )}
                          >
                            Next Slide
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {card.quiz && onLastSlide && (
                    <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4">
                      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                        Checkpoint Quiz
                      </p>
                      <p className="mt-2 text-sm text-foreground">{card.quiz.question}</p>
                      <div className="mt-3 space-y-2">
                        {card.quiz.options.map((option, optionIdx) => {
                          const selected = quizAttempt?.selectedIndex === optionIdx;
                          return (
                            <button
                              key={`${absoluteIdx}-quiz-option-${optionIdx}`}
                              type="button"
                              onClick={() => onQuizOptionSelect(absoluteIdx, optionIdx)}
                              className={cn(
                                "w-full rounded-md border px-3 py-2 text-left text-xs transition-colors",
                                selected
                                  ? "border-foreground bg-foreground/5 text-foreground"
                                  : "border-border text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <span className="font-medium text-foreground">{optionIdx + 1}.</span>{" "}
                              {option}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onQuizSubmit(absoluteIdx)}
                          disabled={quizAttempt?.selectedIndex === null || quizAttempt?.selectedIndex === undefined}
                          className={cn(
                            "rounded-md border px-3 py-1.5 text-xs transition-colors",
                            quizAttempt?.selectedIndex === null || quizAttempt?.selectedIndex === undefined
                              ? "cursor-not-allowed border-border text-muted-foreground/40"
                              : "border-foreground bg-foreground text-background hover:bg-foreground/90"
                          )}
                        >
                          Check Answer
                        </button>
                        {quizAttempt?.submitted && (
                          <span
                            className={cn(
                              "text-xs",
                              quizAttempt.isCorrect ? "text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {quizAttempt.isCorrect ? "Correct, topic unlocked." : "Not yet, review and retry."}
                          </span>
                        )}
                      </div>
                      {quizAttempt?.submitted && quizAttempt.feedback && (
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {quizAttempt.feedback}
                        </p>
                      )}
                      {card.quiz.openQuestion && (
                        <div className="mt-4 space-y-2 border-t border-border pt-3">
                          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                            Open Answer
                          </p>
                          <p className="text-xs text-foreground">{card.quiz.openQuestion}</p>
                          <div className="flex items-start gap-2">
                            <textarea
                              value={quizAttempt?.openAnswer ?? ""}
                              onChange={(e) =>
                                onOpenAnswerChange(absoluteIdx, e.target.value)
                              }
                              placeholder="Type your 2-4 line answer or use voice..."
                              className="min-h-[88px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
                            />
                            {voiceSupported && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (disableVoiceInput) return;
                                  if (isVoiceListening) stopVoiceListening();
                                  else startVoiceListening();
                                }}
                                disabled={disableVoiceInput}
                                className={cn(
                                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors",
                                  isVoiceListening
                                    ? "border-foreground bg-foreground text-background"
                                    : disableVoiceInput
                                      ? "cursor-not-allowed border-border text-muted-foreground/40"
                                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                                title={
                                  disableVoiceInput
                                    ? "Voice capture is paused while Voxi is open"
                                    : isVoiceListening
                                      ? "Stop voice capture"
                                      : "Record voice answer"
                                }
                              >
                                {isVoiceListening ? (
                                  <MicOff className="h-4 w-4" />
                                ) : (
                                  <Mic className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenAnswerSubmit(absoluteIdx)}
                            disabled={!(quizAttempt?.openAnswer ?? "").trim()}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-xs transition-colors",
                              (quizAttempt?.openAnswer ?? "").trim()
                                ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
                                : "cursor-not-allowed border-border text-muted-foreground/40"
                            )}
                          >
                            Check Open Answer
                          </button>
                          {quizAttempt?.openSubmitted && (
                            <p className="text-xs text-muted-foreground">
                              {quizAttempt.openFeedback}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {card.quiz && !onLastSlide && (
                    <p className="mt-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      Finish the story slides to unlock the checkpoint.
                    </p>
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
            {requireQuizToAdvance && !currentTopicPassed && (
              <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Complete the checkpoint (mcq + open answer) to unlock the next topic.
              </p>
            )}
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
