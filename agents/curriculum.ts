/**
 * Curriculum Strategy Agent
 *
 * Takes extracted concepts + chosen difficulty and produces a prioritized
 * learning path. Decides what to teach first, how deep to go, and when
 * to move on.
 */

import type { Concept, Difficulty } from "@/types";

export interface LearningPath {
  /** Ordered list of concept IDs to cover */
  order: string[];
  /** Per-concept depth setting */
  depth: Record<string, "overview" | "standard" | "deep">;
}

/**
 * Build a learning path from concepts and difficulty.
 *
 * TODO: integrate with LLM for intelligent ordering
 */
export async function buildLearningPath(
  _concepts: Concept[],
  _difficulty: Difficulty
): Promise<LearningPath> {
  // placeholder
  return {
    order: [],
    depth: {},
  };
}
