/**
 * Media Agent
 *
 * Produces visual aids that support reasoning and intuition:
 * - Diagrams and concept maps
 * - GIFs and animations
 * - Scenario illustrations
 *
 * Called by story and tutor agents when visuals would help.
 */

export interface MediaRequest {
  type: "diagram" | "gif" | "image";
  description: string;
  /** Concept IDs this media illustrates */
  conceptIds: string[];
}

export interface MediaResult {
  url: string;
  alt: string;
  type: "diagram" | "gif" | "image";
}

/**
 * Generate a visual aid from a description.
 *
 * TODO: integrate with image generation API
 */
export async function generateMedia(
  _request: MediaRequest
): Promise<MediaResult> {
  // placeholder
  return {
    url: "",
    alt: _request.description,
    type: _request.type,
  };
}
