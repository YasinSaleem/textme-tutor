import { ProblemContext } from "./context-builder.js";

export interface LessonResult {
  parent_message: string;
  replies: string[];
}

export interface ReviewResult {
  valid: boolean;
  issues?: string;
  suggested_fixes?: string;
}

export interface PipelineResult {
  lesson_markdown: string;
  teaching_score: number;
  review_reason: string;
  formatted_json: string;
}
