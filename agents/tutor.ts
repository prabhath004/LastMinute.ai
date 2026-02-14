/**
 * Tutor Agent
 *
 * Handles explanations and voice/text interaction when the student
 * gets stuck or has questions mid-scenario. Provides:
 * - Natural doubt resolution
 * - Concept clarification
 * - Step-by-step reasoning
 * - Adaptive explanations based on difficulty
 */

import type { ChatMessage, Concept, Difficulty } from "@/types";

export interface TutorContext {
  difficulty: Difficulty;
  /** Concepts relevant to the current scenario */
  activeConcepts: Concept[];
  /** Conversation so far */
  history: ChatMessage[];
}

/**
 * Get a tutor response to a student's question.
 *
 * TODO: integrate with LLM for conversational tutoring
 */
export async function getTutorResponse(
  _userMessage: string,
  _context: TutorContext
): Promise<string> {
  // placeholder
  return "";
}
