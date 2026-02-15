"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [misconceptions] = useState<MisconceptionLogEntry[]>([]);
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
  const [drawMode, setDrawMode] = useState(false);

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
    disabled: voxiIsOpen,
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
        const cards = Array.isArray(session.interactive_story?.topic_storylines)
          ? session.interactive_story.topic_storylines
              .filter(
                (item: unknown) => !!item && typeof item === "object"
              )
              .map((item: Record<string, unknown>, idx: number) => ({
                title: String(item.title ?? `Story Card ${idx + 1}`),
                topics: Array.isArray(item.topics)
                  ? item.topics.map((t) => String(t).trim()).filter(Boolean)
                  : [],
                importance: String(item.importance ?? "medium").toLowerCase(),
                subtopics: Array.isArray(item.subtopics)
                  ? item.subtopics.map((s) => String(s).trim()).filter(Boolean)
                  : [],
                story: String(item.story ?? "").trim(),
                friend_explainers: Array.isArray(item.friend_explainers)
                  ? item.friend_explainers
                      .map((s) => String(s).trim())
                      .filter(Boolean)
                  : [],
              }))
              .filter((item: TopicStorylineCard) => item.story.length > 0)
          : [];
        setTopicStorylines(cards);
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
  const canGoNextStory = currentStoryIndex < topicStorylines.length - 1;

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

  const handleNextStory = useCallback(() => {
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
  }, [topicStorylines.length]);

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
  const completedCount = checklist.filter((item) => item.done).length;

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
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {sessionId ? (
              <>
                <LessonView
                  activeTopicId={activeTopicId}
                  missionTitle={storyTitle}
                  missionStory={storytelling}
                  topicStorylines={topicStorylines}
                  storyBeats={storyBeats}
                  currentStoryIndex={currentStoryIndex}
                  totalStories={topicStorylines.length}
                  canGoPrevStory={canGoPrevStory}
                  canGoNextStory={canGoNextStory}
                  onPrevStory={handlePrevStory}
                  onNextStory={handleNextStory}
                  loading={false}
                />
                {drawMode && (
                  <TopicDrawingOverlay
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
