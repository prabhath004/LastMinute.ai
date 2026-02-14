/**
 * Evaluation Agent
 *
 * Scores student responses, tracks per-concept mastery, adjusts
 * difficulty dynamically, and decides what happens next:
 * - Continue current path
 * - Review weak concepts
 * - Advance to harder material
 */

import type { EvaluationResult, ScenarioStep } from "@/types";

export interface StudentResponse {
  scenarioId: string;
  stepId: string;
  /** Index of the choice the student picked */
  choiceIndex: number;
  /** Optional free-text reasoning */
  reasoning?: string;
}

/**
 * Evaluate a student's response to a scenario step.
 *
 * TODO: integrate with LLM for reasoning quality assessment
 */
export async function evaluateResponse(
  _response: StudentResponse,
  _step: ScenarioStep
): Promise<EvaluationResult> {
  // placeholder
  return {
    scenarioId: _response.scenarioId,
    score: 0,
    conceptScores: {},
    feedback: "",
    nextAction: "continue",
  };
}
