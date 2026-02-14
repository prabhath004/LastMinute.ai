import { NextResponse } from "next/server";

/**
 * POST /api/chat
 *
 * Accepts a user message and returns a tutor response.
 * Will integrate with the tutor agent.
 */
export async function POST(request: Request) {
  const { message } = (await request.json()) as { message: string };

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // TODO: call tutor agent with conversation context
  return NextResponse.json({
    role: "assistant" as const,
    content: "Tutor agent not yet connected.",
  });
}
