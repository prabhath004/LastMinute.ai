"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopicNav } from "@/components/workspace/topic-nav";
import { LessonView } from "@/components/workspace/lesson-view";
import { SupportPanel } from "@/components/workspace/support-panel";
import { TopicDrawingOverlay } from "@/components/workspace/topic-drawing-overlay";
import { VercelV0Chat } from "@/components/ui/v0-ai-chat";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type {
  ChecklistItem,
  HintLevel,
  MisconceptionLogEntry,
  TopicQuiz,
  TopicStorylineCard,
} from "@/types";
import type { StoryBeat } from "@/app/api/upload/route";
import {
  AnnotationStoreContext,
  useCreateAnnotationStore,
} from "@/hooks/use-annotation-store";
import { useWakeWord } from "@/hooks/use-wake-word";

type LoadState = "loading" | "generating" | "ready" | "error";
const RECENT_SESSIONS_KEY = "lastminute_recent_sessions";

interface RecentSessionItem {
  id: string;
  title: string;
  updatedAt: number;
}

interface QuizAttemptState {
  selectedIndex: number | null;
  submitted: boolean;
  isCorrect: boolean | null;
  feedback: string;
  openAnswer: string;
  openSubmitted: boolean;
  openPassed: boolean;
  openFeedback: string;
  attempts: number;
}

interface WeakConceptItem {
  name: string;
  misses: number;
}

function defaultQuizAttempt(): QuizAttemptState {
  return {
    selectedIndex: null,
    submitted: false,
    isCorrect: null,
    feedback: "",
    openAnswer: "",
    openSubmitted: false,
    openPassed: false,
    openFeedback: "",
    attempts: 0,
  };
}

function normalizeQuizFromRaw(
  raw: unknown,
  fallbackFocus: string,
  fallbackTitle: string
): TopicQuiz | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const question = String(value.question ?? "").trim();
  const options = Array.isArray(value.options)
    ? value.options.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!question || options.length < 2) return undefined;

  const parsedCorrectIndex = Number.parseInt(
    String(value.correctIndex ?? value.correct_index ?? 0),
    10
  );
  const correctIndex = Number.isFinite(parsedCorrectIndex)
    ? Math.max(0, Math.min(options.length - 1, parsedCorrectIndex))
    : 0;

  return {
    question,
    options,
    correctIndex,
    explanation:
      String(value.explanation ?? "").trim() ||
      "Great correction. Keep this reasoning pattern.",
    misconception:
      String(value.misconception ?? "").trim() ||
      "Not quite yet. Re-check the concept chain and try once more.",
    focusConcept:
      String(value.focusConcept ?? value.focus_concept ?? "").trim() ||
      fallbackFocus ||
      fallbackTitle,
    openQuestion:
      String(value.openQuestion ?? value.open_question ?? "").trim() ||
      `In 2-4 lines, explain how you would solve ${fallbackFocus || fallbackTitle} in an exam.`,
    openModelAnswer:
      String(value.openModelAnswer ?? value.open_model_answer ?? "").trim() ||
      "",
  };
}

function buildFallbackQuiz(
  card: Pick<TopicStorylineCard, "title" | "topics" | "subtopics">
): TopicQuiz {
  const leadTopic = card.topics[0] || card.subtopics[0] || "this concept";
  const secondTopic = card.topics[1] || leadTopic;
  return {
    question: `In a timed question combining ${leadTopic} and ${secondTopic}, what should you do first?`,
    options: [
      `Anchor your reasoning in ${leadTopic}, then connect to ${secondTopic}.`,
      "Jump to a final answer without building the logic chain.",
      "Ignore one of the two topics and solve with shortcuts only.",
      "Memorize one definition and skip the worked reasoning.",
    ],
    correctIndex: 0,
    explanation:
      "Correct. Build from the core concept first, then connect the paired concept with clear steps.",
    misconception:
      "This misses the reasoning sequence. Start from the core concept and then connect both topics explicitly.",
    focusConcept: leadTopic,
    openQuestion: `In 2-4 lines, explain how you would apply ${leadTopic} and ${secondTopic} step-by-step in an exam question.`,
    openModelAnswer:
      `Start from ${leadTopic}, then connect it to ${secondTopic} with one concrete reasoning step and a clear conclusion.`,
  };
}

export default function WorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  /* ---- data ---- */
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [hints, setHints] = useState<HintLevel[]>([]);
  const [misconceptions, setMisconceptions] = useState<MisconceptionLogEntry[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<Record<number, QuizAttemptState>>(
    {}
  );
  const [weakConceptMisses, setWeakConceptMisses] = useState<Record<string, number>>(
    {}
  );
  const [tutorContext, setTutorContext] = useState("");
  const [storytelling, setStorytelling] = useState("");
  const [storyTitle, setStoryTitle] = useState("Mission Story");
  const [topicStorylines, setTopicStorylines] = useState<TopicStorylineCard[]>(
    []
  );
  const [storyBeats, setStoryBeats] = useState<StoryBeat[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentSessionItem[]>([]);

  /* ---- Voxi: annotation store + wake word ---- */
  const annotationStore = useCreateAnnotationStore();
  const [voxiOpenTrigger, setVoxiOpenTrigger] = useState(0);
  const [voxiIsOpen, setVoxiIsOpen] = useState(false);
  const [lessonVoiceListening, setLessonVoiceListening] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const lessonColumnRef = useRef<HTMLDivElement>(null);

  /* ---- resizable right panel (Voxi + checklist) ---- */
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const MIN_RIGHT = 260;
  const MAX_RIGHT = 560;
  const handleResize = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = rightPanelWidth;
    const onMove = (e2: MouseEvent) => {
      const delta = startX - e2.clientX;
      setRightPanelWidth((w) => Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, startW + delta)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rightPanelWidth]);

  const handleWakeWord = useCallback(() => {
    setVoxiOpenTrigger((prev) => prev + 1);
  }, []);

  useWakeWord({
    onWake: handleWakeWord,
    disabled: voxiIsOpen || lessonVoiceListening,
  });

  const readRecentSessions = useCallback((): RecentSessionItem[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(RECENT_SESSIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          title: String(item.title ?? "").trim(),
          updatedAt: Number(item.updatedAt ?? 0),
        }))
        .filter((item) => !!item.id && !!item.title && Number.isFinite(item.updatedAt))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }, []);

  const upsertRecentSession = useCallback(
    (entry: RecentSessionItem) => {
      if (typeof window === "undefined") return;
      const previous = readRecentSessions().filter((item) => item.id !== entry.id);
      const next = [entry, ...previous].slice(0, 100);
      window.localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(next));
      setRecentChats(next);
    },
    [readRecentSessions]
  );

  const removeRecentSession = useCallback(
    (id: string) => {
      if (typeof window === "undefined") return;
      const next = readRecentSessions().filter((item) => item.id !== id);
      window.localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(next));
      setRecentChats(next);
    },
    [readRecentSessions]
  );

  const clearRecentSessions = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify([]));
    setRecentChats([]);
  }, []);

  useEffect(() => {
    setRecentChats(readRecentSessions());
  }, [readRecentSessions, sessionId]);

  /* ---- load session & generate lessons ---- */
  useEffect(() => {
    if (!sessionId) {
      setErrorMsg("");
      setChecklist([]);
      setHints([]);
      setMisconceptions([]);
      setQuizAttempts({});
      setWeakConceptMisses({});
      setTutorContext("");
      setStorytelling("");
      setStoryTitle("Mission Story");
      setTopicStorylines([]);
      setActiveTopicId(null);
      setLoadState("ready");
      return;
    }

    let cancelled = false;
    const currentSessionId = sessionId;

    async function init() {
      try {
        // 1. Fetch session
        const sessionRes = await fetch(`/api/session?id=${sessionId}`);
        if (!sessionRes.ok) {
          const data = await sessionRes.json();
          throw new Error(data.error ?? "Failed to load session");
        }

        const session = await sessionRes.json();
        if (cancelled) return;

        const sessionChecklist = Array.isArray(session.checklist)
          ? session.checklist
              .map((item: unknown) => String(item).trim())
              .filter((item: string) => item.length > 0)
          : [];
        const fallbackChecklist = Array.isArray(session.concepts)
          ? session.concepts
              .map((item: unknown) => String(item).trim())
              .filter((item: string) => item.length > 0)
              .slice(0, 6)
          : [];
        const checklistItems = (
          sessionChecklist.length > 0 ? sessionChecklist : fallbackChecklist
        )
          .slice(0, 10)
          .map((label: string, idx: number) => ({
            id: `subtopic-${idx}`,
            label,
            done: false,
          }));
        setChecklist(checklistItems);

        const storytellingText =
          typeof session.final_storytelling === "string"
            ? session.final_storytelling
            : "";
        setStorytelling(storytellingText);
        setStoryTitle(
          typeof session.interactive_story?.title === "string" &&
            session.interactive_story.title.trim()
            ? session.interactive_story.title.trim()
            : "Mission Story"
        );
        const cards: TopicStorylineCard[] = Array.isArray(
          session.interactive_story?.topic_storylines
        )
          ? session.interactive_story.topic_storylines
              .filter(
                (item: unknown) => !!item && typeof item === "object"
              )
              .map((item: Record<string, unknown>, idx: number) => {
                const baseCard: TopicStorylineCard = {
                  title: String(item.title ?? `Story Card ${idx + 1}`),
                  topics: Array.isArray(item.topics)
                    ? item.topics.map((t) => String(t).trim()).filter(Boolean)
                    : [],
                  importance: String(item.importance ?? "medium").toLowerCase(),
                  subtopics: Array.isArray(item.subtopics)
                    ? item.subtopics.map((s) => String(s).trim()).filter(Boolean)
                    : [],
                  story: String(item.story ?? "").trim(),
                  micro_explanations: (() => {
                    const rawMicro = item.micro_explanations ?? item.microExplanations;
                    return Array.isArray(rawMicro)
                      ? rawMicro.map((entry) => String(entry).trim()).filter(Boolean)
                      : [];
                  })(),
                  friend_explainers: Array.isArray(item.friend_explainers)
                    ? item.friend_explainers
                        .map((s) => String(s).trim())
                        .filter(Boolean)
                    : [],
                };
                const parsedQuiz = normalizeQuizFromRaw(
                  item.quiz ?? item.topic_quiz,
                  baseCard.topics[0] ?? "",
                  baseCard.title
                );
                return {
                  ...baseCard,
                  quiz: parsedQuiz ?? buildFallbackQuiz(baseCard),
                };
              })
              .filter((item: TopicStorylineCard) => item.story.length > 0)
          : [];
        setTopicStorylines(cards);
        setQuizAttempts(() => {
          const next: Record<number, QuizAttemptState> = {};
          cards.forEach((card, idx) => {
            if (card.quiz) {
              next[idx] = defaultQuizAttempt();
            }
          });
          return next;
        });
        setMisconceptions([]);
        setWeakConceptMisses({});
        setStoryBeats(Array.isArray(session.story_beats) ? session.story_beats : []);
        setActiveTopicId(cards[0] ? `story-${0}` : null);
        upsertRecentSession({
          id: currentSessionId,
          title:
            (typeof session.interactive_story?.title === "string" &&
              session.interactive_story.title.trim()) ||
            (typeof session.filename === "string" && session.filename.trim()) ||
            "Untitled chat",
          updatedAt: Date.now(),
        });

        // Build tutor context
        setTutorContext(
          [
            session.interactive_story?.title,
            `Concepts: ${(session.concepts || []).join(", ")}`,
            session.final_storytelling,
            session.source_text?.slice(0, 4000),
          ]
            .filter(Boolean)
            .join("\n\n")
        );

        // Build hints from storytelling
        if (storytellingText) {
          const paragraphs = storytellingText
            .split("\n\n")
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 20)
            .slice(0, 5);
          setHints(
            paragraphs.map((text: string, i: number) => ({
              level: i + 1,
              text,
              revealed: false,
            }))
          );
        }

        // Story cards are the primary content; no lesson generation API call.
        setLoadState("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to load session"
        );
        setLoadState("error");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [sessionId, upsertRecentSession]);

  /* ---- handlers ---- */
  const handleChecklistToggle = useCallback((id: string) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
      )
    );
  }, []);

  const handleRevealHint = useCallback((level: number) => {
    setHints((prev) =>
      prev.map((h) => (h.level === level ? { ...h, revealed: true } : h))
    );
  }, []);

  const handleChatSelect = useCallback(
    (targetSessionId: string) => {
      if (!targetSessionId || targetSessionId === sessionId) return;
      setLoadState("loading");
      router.push(`/workspace?session=${encodeURIComponent(targetSessionId)}`);
    },
    [router, sessionId]
  );

  const handleDeleteChat = useCallback(
    (targetSessionId: string) => {
      if (!targetSessionId) return;
      removeRecentSession(targetSessionId);
      if (targetSessionId === sessionId) {
        setErrorMsg("");
        setChecklist([]);
        setHints([]);
        setMisconceptions([]);
        setQuizAttempts({});
        setWeakConceptMisses({});
        setTutorContext("");
        setStorytelling("");
        setStoryTitle("Mission Story");
        setTopicStorylines([]);
        setActiveTopicId(null);
        setLoadState("ready");
        router.push("/workspace");
      }
    },
    [removeRecentSession, sessionId, router]
  );

  const handleClearHistory = useCallback(() => {
    clearRecentSessions();
    setErrorMsg("");
    setChecklist([]);
    setHints([]);
    setMisconceptions([]);
    setQuizAttempts({});
    setWeakConceptMisses({});
    setTutorContext("");
    setStorytelling("");
    setStoryTitle("Mission Story");
    setTopicStorylines([]);
    setActiveTopicId(null);
    setLoadState("ready");
    router.push("/workspace");
  }, [clearRecentSessions, router]);

  const handleNewChat = useCallback(() => {
    setErrorMsg("");
    setChecklist([]);
    setHints([]);
    setMisconceptions([]);
    setQuizAttempts({});
    setWeakConceptMisses({});
    setTutorContext("");
    setStorytelling("");
    setStoryTitle("Mission Story");
    setTopicStorylines([]);
    setActiveTopicId(null);
    setLoadState("ready");
    router.push("/workspace");
  }, [router]);

  const parsedStoryIndex =
    activeTopicId && activeTopicId.startsWith("story-")
      ? Number.parseInt(activeTopicId.replace("story-", ""), 10)
      : NaN;
  const currentStoryIndex =
    Number.isFinite(parsedStoryIndex) &&
    parsedStoryIndex >= 0 &&
    parsedStoryIndex < topicStorylines.length
      ? parsedStoryIndex
      : 0;
  const canGoPrevStory = currentStoryIndex > 0;
  const currentCard = topicStorylines[currentStoryIndex];
  const currentCardQuiz = currentCard?.quiz;
  const currentQuizAttempt = quizAttempts[currentStoryIndex];
  const currentTopicPassed =
    !currentCardQuiz ||
    (currentQuizAttempt?.isCorrect === true &&
      (!currentCardQuiz.openQuestion || currentQuizAttempt?.openPassed === true));
  const canGoNextStory =
    currentStoryIndex < topicStorylines.length - 1 && currentTopicPassed;

  const weakConcepts: WeakConceptItem[] = useMemo(
    () =>
      Object.entries(weakConceptMisses)
        .filter(([, misses]) => misses > 0)
        .map(([name, misses]) => ({ name, misses }))
        .sort((a, b) => b.misses - a.misses)
        .slice(0, 8),
    [weakConceptMisses]
  );

  /** Current slide image for Voxi "Draw on slide" (first image of current topic) */
  const currentSlideImage = useMemo(() => {
    const card = topicStorylines[currentStoryIndex];
    if (!card || !storyBeats?.length) return null;
    const topicLabels = [
      ...(card.topics ?? []).map((t) => t.toLowerCase().trim()),
      ...(card.subtopics ?? []).map((s) => s.toLowerCase().trim()),
      (card.title ?? "").toLowerCase().trim(),
    ].filter(Boolean);
    const beat = storyBeats.find((b) => {
      const label = (b.label ?? "").toLowerCase().trim();
      return label && topicLabels.some((tl) => tl.includes(label) || label.includes(tl));
    });
    const step = beat?.image_steps?.find((s) => s.image_data);
    if (!step?.image_data) return null;
    return {
      src: step.image_data,
      alt: step.step_label || beat?.label || "Current slide",
    };
  }, [topicStorylines, currentStoryIndex, storyBeats]);

  const handlePrevStory = useCallback(() => {
    setActiveTopicId((prev) => {
      const idx =
        prev && prev.startsWith("story-")
          ? Number.parseInt(prev.replace("story-", ""), 10)
          : 0;
      const safeIdx = Number.isFinite(idx) ? idx : 0;
      return `story-${Math.max(0, safeIdx - 1)}`;
    });
  }, []);

  const handleQuizOptionSelect = useCallback((topicIdx: number, optionIdx: number) => {
    setQuizAttempts((prev) => ({
      ...prev,
      [topicIdx]: {
        ...(prev[topicIdx] ?? defaultQuizAttempt()),
        selectedIndex: optionIdx,
        submitted: false,
        isCorrect: null,
        feedback: "",
      },
    }));
  }, []);

  const handleOpenAnswerChange = useCallback((topicIdx: number, value: string) => {
    setQuizAttempts((prev) => ({
      ...prev,
      [topicIdx]: {
        ...(prev[topicIdx] ?? defaultQuizAttempt()),
        openAnswer: value,
        openSubmitted: false,
        openPassed: false,
        openFeedback: "",
      },
    }));
  }, []);

  const handleOpenAnswerSubmit = useCallback(
    (topicIdx: number) => {
      const card = topicStorylines[topicIdx];
      if (!card?.quiz) return;
      const attempt = quizAttempts[topicIdx] ?? defaultQuizAttempt();
      const rawAnswer = attempt.openAnswer.trim();
      if (!rawAnswer) return;

      const normalizedAnswer = rawAnswer.toLowerCase();
      const words = normalizedAnswer
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
      const focusTerm = (card.quiz.focusConcept || card.topics[0] || "").toLowerCase();
      const topicTerms = [focusTerm, ...card.topics.map((topic) => topic.toLowerCase())].filter(
        Boolean
      );
      const hasTopicReference = topicTerms.some((term) => normalizedAnswer.includes(term));
      const genericTokens = new Set([
        "this",
        "that",
        "with",
        "from",
        "your",
        "into",
        "then",
        "than",
        "give",
        "example",
        "would",
        "should",
        "could",
        "model",
        "models",
        "training",
        "accuracy",
        "classification",
        "data",
        "task",
        "using",
        "used",
        "answer",
        "question",
        "concept",
        "concepts",
      ]);
      const extractKeywords = (text: string, minLen: number) =>
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((token) => token.length >= minLen && !genericTokens.has(token));
      const keywordSource = [
        card.quiz.openQuestion ?? "",
        card.quiz.openModelAnswer ?? "",
        card.quiz.question ?? "",
        ...card.topics,
        ...card.subtopics,
      ]
        .join(" ");
      const keywordSet = new Set(extractKeywords(keywordSource, 4));
      const modelSignalKeywords = extractKeywords(
        [
          card.quiz.openModelAnswer ?? "",
          card.quiz.explanation ?? "",
          card.quiz.misconception ?? "",
          focusTerm,
        ].join(" "),
        6
      );
      const keywordHits = words.filter((token) => keywordSet.has(token)).length;
      const modelKeywordHits = new Set(
        words.filter((token) =>
          modelSignalKeywords.some(
            (signal) =>
              token === signal || token.startsWith(signal) || signal.startsWith(token)
          )
        )
      ).size;
      const hasReasoningSignal =
        /because|therefore|then|so that|which means|first|next|finally/.test(
          normalizedAnswer
        );
      const longEnough = rawAnswer.length >= 45 || words.length >= 8;
      const standardPass =
        longEnough &&
        (hasTopicReference || hasReasoningSignal || keywordHits >= 2);
      const conciseConceptPass =
        !longEnough && words.length <= 4 && modelKeywordHits >= 1;
      const isPass = standardPass || conciseConceptPass;

      const openFeedback = isPass
        ? conciseConceptPass
          ? "Correct core concept. Add one supporting sentence next time for full reasoning."
          : "Good open response. You explained the reasoning chain clearly."
        : card.quiz.openModelAnswer
          ? `Remember: ${card.quiz.openModelAnswer}`
          : "Remember: start from the core concept, then explain each step in order.";

      setQuizAttempts((prev) => ({
        ...prev,
        [topicIdx]: {
          ...(prev[topicIdx] ?? defaultQuizAttempt()),
          openAnswer: rawAnswer,
          openSubmitted: true,
          openPassed: isPass,
          openFeedback,
        },
      }));

      if (isPass) {
        if (focusTerm) {
          setWeakConceptMisses((prev) => {
            const current = prev[focusTerm] ?? 0;
            if (current <= 1) {
              const next = { ...prev };
              delete next[focusTerm];
              return next;
            }
            return { ...prev, [focusTerm]: current - 1 };
          });
        }
        setChecklist((items) =>
          items.map((item, checklistIdx) =>
            checklistIdx === topicIdx ? { ...item, done: true } : item
          )
        );
        return;
      }

      if (focusTerm) {
        setWeakConceptMisses((prev) => ({
          ...prev,
          [focusTerm]: (prev[focusTerm] ?? 0) + 1,
        }));
      }

      const misconceptionText = `Open response needs stronger reasoning. ${openFeedback}`;
      setMisconceptions((prev) => [
        {
          id: `${topicIdx}-open-${Date.now()}`,
          text: misconceptionText,
          topicId: `story-${topicIdx}`,
        },
        ...prev,
      ].slice(0, 20));
    },
    [quizAttempts, topicStorylines]
  );

  const handleQuizSubmit = useCallback(
    (topicIdx: number) => {
      const card = topicStorylines[topicIdx];
      if (!card?.quiz) return;
      const attempt = quizAttempts[topicIdx] ?? defaultQuizAttempt();
      if (attempt.selectedIndex === null) return;

      const isCorrect = attempt.selectedIndex === card.quiz.correctIndex;
      const feedback = isCorrect ? card.quiz.explanation : card.quiz.misconception;
      const focusConcept = (card.quiz.focusConcept || card.topics[0] || card.title || "")
        .trim()
        .toLowerCase();

      setQuizAttempts((prev) => ({
        ...prev,
        [topicIdx]: {
          ...(prev[topicIdx] ?? defaultQuizAttempt()),
          selectedIndex: attempt.selectedIndex,
          submitted: true,
          isCorrect,
          feedback,
          attempts: (prev[topicIdx]?.attempts ?? 0) + 1,
        },
      }));

      if (isCorrect) {
        if (!card.quiz.openQuestion) {
          setChecklist((items) =>
            items.map((item, checklistIdx) =>
              checklistIdx === topicIdx ? { ...item, done: true } : item
            )
          );
        }
        if (focusConcept) {
          setWeakConceptMisses((prev) => {
            const current = prev[focusConcept] ?? 0;
            if (current <= 1) {
              const next = { ...prev };
              delete next[focusConcept];
              return next;
            }
            return { ...prev, [focusConcept]: current - 1 };
          });
        }
        return;
      }

      if (focusConcept) {
        setWeakConceptMisses((prev) => ({
          ...prev,
          [focusConcept]: (prev[focusConcept] ?? 0) + 1,
        }));
      }

      const misconceptionText = card.quiz.misconception || "Review this topic and try once more.";
      const rememberNote = card.quiz.explanation
        ? ` Remember: ${card.quiz.explanation}`
        : "";
      setMisconceptions((prev) => [
        {
          id: `${topicIdx}-${Date.now()}`,
          text: `${misconceptionText}${rememberNote}`,
          topicId: `story-${topicIdx}`,
        },
        ...prev,
      ].slice(0, 20));
    },
    [quizAttempts, topicStorylines]
  );

  const handleNextStory = useCallback(() => {
    if (!currentTopicPassed) return;
    setActiveTopicId((prev) => {
      const idx =
        prev && prev.startsWith("story-")
          ? Number.parseInt(prev.replace("story-", ""), 10)
          : 0;
      const safeIdx = Number.isFinite(idx) ? idx : 0;
      setChecklist((items) =>
        items.map((item, checklistIdx) =>
          checklistIdx === safeIdx ? { ...item, done: true } : item
        )
      );
      const next = Math.min(topicStorylines.length - 1, safeIdx + 1);
      return `story-${Math.max(0, next)}`;
    });
  }, [currentTopicPassed, topicStorylines.length]);

  /* ---- loading ---- */
  if (loadState === "loading") {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading session...</p>
        </div>
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
        <p className="text-sm text-muted-foreground">{errorMsg}</p>
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
  const completedCount = topicStorylines.reduce((acc, card, idx) => {
    if (!card.quiz) return acc + 1;
    const attempt = quizAttempts[idx];
    const openReady = !card.quiz.openQuestion || attempt?.openPassed;
    return acc + (attempt?.isCorrect && openReady ? 1 : 0);
  }, 0);

  return (
    <AnnotationStoreContext.Provider value={annotationStore}>
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

        <div className="flex flex-1 overflow-hidden">
          <div
            className={cn(
              "flex shrink-0 flex-col",
              sidebarCollapsed ? "w-16" : "w-[200px]"
            )}
          >
            <TopicNav
              chats={recentChats}
              selectedId={sessionId}
              onSelectChat={handleChatSelect}
              onDeleteChat={handleDeleteChat}
              onClearHistory={handleClearHistory}
              onNewChat={handleNewChat}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
            />
          </div>
          <div
            ref={lessonColumnRef}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {sessionId ? (
              <>
                <LessonView
                  activeTopicId={activeTopicId}
                  missionTitle={storyTitle}
                  missionStory={storytelling}
                  topicStorylines={topicStorylines}
                  quizAttempts={quizAttempts}
                  storyBeats={storyBeats}
                  currentStoryIndex={currentStoryIndex}
                  totalStories={topicStorylines.length}
                  canGoPrevStory={canGoPrevStory}
                  canGoNextStory={canGoNextStory}
                  currentTopicPassed={currentTopicPassed}
                  requireQuizToAdvance={Boolean(currentCardQuiz)}
                  onPrevStory={handlePrevStory}
                  onNextStory={handleNextStory}
                  onQuizOptionSelect={handleQuizOptionSelect}
                  onQuizSubmit={handleQuizSubmit}
                  onOpenAnswerChange={handleOpenAnswerChange}
                  onOpenAnswerSubmit={handleOpenAnswerSubmit}
                  disableVoiceInput={voxiIsOpen}
                  onVoiceListeningChange={setLessonVoiceListening}
                  loading={false}
                />
                {drawMode && (
                  <TopicDrawingOverlay
                    captureContainerRef={lessonColumnRef}
                    currentSlideImage={currentSlideImage}
                    onExit={() => setDrawMode(false)}
                  />
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center overflow-y-auto px-6 py-8">
                <VercelV0Chat />
              </div>
            )}
          </div>
          <div
            role="separator"
            aria-label="Resize support panel"
            onMouseDown={handleResize}
            className="w-1.5 shrink-0 cursor-col-resize border-l border-border bg-border/50 transition-colors hover:bg-primary/20"
          />
          <SupportPanel
            checklist={checklist}
            onChecklistToggle={handleChecklistToggle}
            hints={hints}
            onRevealHint={handleRevealHint}
            misconceptions={misconceptions}
            weakConcepts={weakConcepts}
            tutorContext={tutorContext}
            completedSteps={completedCount}
            totalSteps={topicStorylines.length}
            voxiOpenTrigger={voxiOpenTrigger}
            onVoxiOpenChange={setVoxiIsOpen}
            currentSlideImage={currentSlideImage}
            drawMode={drawMode}
            onDrawModeChange={setDrawMode}
            className="shrink-0"
            style={{ width: rightPanelWidth, minWidth: rightPanelWidth }}
          />
        </div>
      </main>
    </AnnotationStoreContext.Provider>
  );
}
