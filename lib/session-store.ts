/**
 * In-memory session store.
 *
 * Stores upload results + generated lessons keyed by session ID.
 * Good enough for dev / single-server. Swap for Redis / DB later.
 */

import { randomUUID } from "crypto";
import type { TopicLesson, LessonSection, TopicStorylineCard } from "@/types";
import type { StoryBeat } from "@/app/api/upload/route";

export interface SessionData {
  id: string;
  createdAt: number;
  filename: string;
  concepts: string[];
  checklist: string[];
  interactive_story: {
    title: string;
    opening: string;
    checkpoint: string;
    boss_level: string;
    topic_storylines?: TopicStorylineCard[];
  };
  final_storytelling: string;
  /** Story beats with optional images to show between topics */
  story_beats: StoryBeat[];
  llm_used: boolean;
  llm_status: string;
  /** Full extracted source text — context for tutor + lesson generation */
  source_text: string;
  /** Generated per-topic lessons */
  lessons: TopicLesson[];
}

// Use globalThis to survive Next.js hot-reloads in dev
const globalKey = "__lastminute_sessions__";
const globalObj = globalThis as unknown as Record<
  string,
  Map<string, SessionData>
>;

if (!globalObj[globalKey]) {
  globalObj[globalKey] = new Map<string, SessionData>();
}

const store = globalObj[globalKey];

// Auto-expire sessions after 2 hours
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [id, session] of store) {
    if (now - session.createdAt > MAX_AGE_MS) {
      store.delete(id);
    }
  }
}

export function createSession(
  data: Omit<SessionData, "id" | "createdAt" | "lessons">
): SessionData {
  cleanup();
  const session: SessionData = {
    ...data,
    id: randomUUID(),
    createdAt: Date.now(),
    lessons: [],
  };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): SessionData | null {
  cleanup();
  return store.get(id) ?? null;
}

export function setLessons(sessionId: string, lessons: TopicLesson[]): boolean {
  const session = store.get(sessionId);
  if (!session) return false;
  session.lessons = lessons;
  return true;
}

export function updateSection(
  sessionId: string,
  topicId: string,
  sectionId: string,
  update: Partial<Pick<LessonSection, "userAnswer" | "aiFeedback" | "answered">>
): LessonSection | null {
  const session = store.get(sessionId);
  if (!session) return null;

  const topic = session.lessons.find((l) => l.topicId === topicId);
  if (!topic) return null;

  const section = topic.sections.find((s) => s.id === sectionId);
  if (!section) return null;

  Object.assign(section, update);
  return section;
}

export function completeTopicAndAdvance(
  sessionId: string,
  topicId: string
): boolean {
  const session = store.get(sessionId);
  if (!session) return false;

  const idx = session.lessons.findIndex((l) => l.topicId === topicId);
  if (idx === -1) return false;

  session.lessons[idx].status = "completed";

  // Unlock the next topic
  if (idx + 1 < session.lessons.length) {
    session.lessons[idx + 1].status = "active";
  }

  return true;
}
