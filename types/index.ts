/* ------------------------------------------------------------------
   Core domain types for LastMinute.ai
   ------------------------------------------------------------------ */

export type Difficulty = "easy" | "medium" | "hard";

export interface Concept {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  weight: number;
}

export interface StudyDocument {
  id: string;
  filename: string;
  type: string;
  content: string;
  uploadedAt: Date;
}

export interface Course {
  id: string;
  name: string;
  difficulty: Difficulty;
  documents: StudyDocument[];
  concepts: Concept[];
  createdAt: Date;
}

export interface ScenarioStep {
  id: string;
  narrative: string;
  conceptIds: string[];
  choices?: { label: string; isCorrect: boolean; feedback: string }[];
  media?: { type: "image" | "gif" | "diagram"; url: string; alt: string };
}

export interface Scenario {
  id: string;
  courseId: string;
  title: string;
  steps: ScenarioStep[];
}

export interface EvaluationResult {
  scenarioId: string;
  score: number;
  conceptScores: Record<string, number>;
  feedback: string;
  nextAction: "continue" | "review" | "advance";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/* ------------------------------------------------------------------
   Workspace types
   ------------------------------------------------------------------ */

export interface WorkspaceTopic {
  id: string;
  name: string;
  progress: number;
  weak: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface HintLevel {
  level: number;
  text: string;
  revealed: boolean;
}

export interface MisconceptionLogEntry {
  id: string;
  text: string;
  topicId: string;
}

/* ------------------------------------------------------------------
   Lesson types — structured per-topic content
   ------------------------------------------------------------------ */

export type LessonSectionType =
  | "explanation"
  | "keyTerms"
  | "example"
  | "diagram"
  | "practice";

export interface LessonSection {
  id: string;
  type: LessonSectionType;
  title: string;
  content: string;
  /** For practice sections */
  questionType?: "open" | "mcq";
  options?: string[];
  hint?: string;
  /** For diagram sections */
  diagramAlt?: string;
  /** Interaction state (mutated client-side + by evaluate-answer API) */
  userAnswer?: string;
  aiFeedback?: string;
  answered: boolean;
}

export type TopicLessonStatus = "locked" | "active" | "completed";

export interface TopicLesson {
  topicId: string;
  topicName: string;
  status: TopicLessonStatus;
  sections: LessonSection[];
}

/* ------------------------------------------------------------------
   Upload result – exact shape the API returns, stored in sessionStorage
   ------------------------------------------------------------------ */

export interface InteractiveStory {
  title: string;
  opening: string;
  checkpoint: string;
  boss_level: string;
  topic_storylines?: TopicStorylineCard[];
}

export interface TopicQuiz {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  misconception: string;
  focusConcept?: string;
  openQuestion?: string;
  openModelAnswer?: string;
}

export interface TopicStorylineCard {
  title: string;
  topics: string[];
  importance: "high" | "medium" | "low" | string;
  subtopics: string[];
  story: string;
  micro_explanations?: string[];
  friend_explainers?: string[];
  quiz?: TopicQuiz;
}

export interface UploadResult {
  filename: string;
  chars: number;
  concepts: string[];
  checklist: string[];
  interactive_story: InteractiveStory;
  final_storytelling: string;
  llm_used: boolean;
  llm_status: string;
}
