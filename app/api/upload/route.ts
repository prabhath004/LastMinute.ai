import { NextResponse } from "next/server";

/**
 * POST /api/upload
 *
 * Accepts file uploads (syllabus, slides, notes, etc.)
 * and feeds them to the document analysis agent.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // TODO: parse file, call document analysis agent
  return NextResponse.json({
    filename: file.name,
    size: file.size,
    status: "received",
  });
}
