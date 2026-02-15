import { NextResponse } from "next/server";
import { createSession, getSession } from "@/lib/session-store";
import type { StoryBeat } from "@/app/api/upload/route";
import type { TopicQuiz } from "@/types";

export const runtime = "nodejs";

function parseStoryBeatsFromBody(raw: unknown): StoryBeat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => {
      const steps = Array.isArray(b.image_steps)
        ? (b.image_steps as Array<Record<string, unknown>>).map((s) => ({
            step_label: String(s?.step_label ?? "").trim(),
            prompt: typeof s?.prompt === "string" ? s.prompt.trim() : undefined,
            image_data: String(s?.image_data ?? "").trim(),
          }))
        : [];
      return {
        label: String(b.label ?? "").trim(),
        narrative: typeof b.narrative === "string" ? b.narrative.trim() : undefined,
        image_steps: steps,
      };
    });
}

function parseTopicQuiz(raw: unknown): TopicQuiz | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const options = Array.isArray(value.options)
    ? value.options.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (options.length < 2) return undefined;

  const parsedIndex = Number.parseInt(String(value.correct_index ?? value.correctIndex ?? 0), 10);
  const correctIndex = Number.isFinite(parsedIndex)
    ? Math.max(0, Math.min(options.length - 1, parsedIndex))
    : 0;

  const question = String(value.question ?? "").trim();
  if (!question) return undefined;

  return {
    question,
    options,
    correctIndex,
    explanation: String(value.explanation ?? "").trim() || "Good work. Keep moving.",
    misconception:
      String(value.misconception ?? "").trim() ||
      "Not quite yet. Re-check the core logic and try again.",
    focusConcept: String(value.focus_concept ?? value.focusConcept ?? "").trim() || undefined,
    openQuestion: String(value.open_question ?? value.openQuestion ?? "").trim() || undefined,
    openModelAnswer:
      String(value.open_model_answer ?? value.openModelAnswer ?? "").trim() || undefined,
  };
}

/**
 * POST /api/session — create a new session from upload data
 *
 * Body: the full upload API response
 * Returns: { sessionId, ...sessionData }
 */
export async function POST(request: Request) {
  const body = await request.json();

  const session = createSession({
    filename: body.filename ?? "",
    concepts: Array.isArray(body.concepts) ? body.concepts : [],
    checklist: Array.isArray(body.checklist) ? body.checklist : [],
    interactive_story: {
      title: body.interactive_story?.title ?? "",
      opening: body.interactive_story?.opening ?? "",
      checkpoint: body.interactive_story?.checkpoint ?? "",
      boss_level: body.interactive_story?.boss_level ?? "",
      topic_storylines: Array.isArray(body.interactive_story?.topic_storylines)
        ? body.interactive_story.topic_storylines
            .filter(
              (item: unknown) => !!item && typeof item === "object"
            )
            .map((item: Record<string, unknown>) => {
              const rawMicro = item.micro_explanations ?? item.microExplanations;
              const microExplanations = Array.isArray(rawMicro)
                ? rawMicro.map((entry) => String(entry).trim()).filter(Boolean)
                : [];
              return {
                title: String(item.title ?? "").trim(),
                topics: Array.isArray(item.topics)
                  ? item.topics.map((t) => String(t).trim()).filter(Boolean)
                  : [],
                importance: String(item.importance ?? "medium").trim().toLowerCase(),
                subtopics: Array.isArray(item.subtopics)
                  ? item.subtopics.map((s) => String(s).trim()).filter(Boolean)
                  : [],
                story: String(item.story ?? "").trim(),
                micro_explanations: microExplanations,
                friend_explainers: Array.isArray(item.friend_explainers)
                  ? item.friend_explainers
                      .map((s) => String(s).trim())
                      .filter(Boolean)
                  : [],
                quiz: parseTopicQuiz(item.quiz ?? item.topic_quiz),
              };
            })
        : [],
    },
    final_storytelling: body.final_storytelling ?? "",
    story_beats: parseStoryBeatsFromBody(body.story_beats),
    llm_used: Boolean(body.llm_used),
    llm_status: body.llm_status ?? "",
    source_text: body.text ?? body.final_storytelling ?? "",
  });

  return NextResponse.json({ sessionId: session.id, ...session });
}

/**
 * GET /api/session?id=<sessionId> — retrieve session data
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing session id" }, { status: 400 });
  }

  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  return NextResponse.json(session);
}
