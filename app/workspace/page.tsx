"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopicNav } from "@/components/workspace/topic-nav";
import { LessonView } from "@/components/workspace/lesson-view";
import { SupportPanel } from "@/components/workspace/support-panel";
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

      <div
        className={cn(
          "grid flex-1 overflow-hidden",
          sidebarCollapsed
            ? "grid-cols-[64px_1fr_260px]"
            : "grid-cols-[200px_1fr_260px]"
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
        {sessionId ? (
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
        ) : (
          <div className="flex h-full items-center justify-center overflow-y-auto px-6 py-8">
            <VercelV0Chat />
          </div>
        )}
        <SupportPanel
          checklist={checklist}
          onChecklistToggle={handleChecklistToggle}
          hints={hints}
          onRevealHint={handleRevealHint}
          misconceptions={misconceptions}
          tutorContext={tutorContext}
          completedSteps={completedCount}
          totalSteps={topicStorylines.length}
        />
      </div>
    </main>
  );
}
