# Implementation Tasks — Daily DSA Intuition Builder

Companion to `specs.md` and the updated implementation plan. Each task is scoped to be completable and verifiable on its own. Work top to bottom.

Checklist format: `[ ]` goal, then acceptance criteria as sub-bullets.

---

## Phase 0 — Project Scaffolding

- [x] **T0.1 — Repo & project structure**
  - Repo initialized with a clear folder layout (e.g. `/agents`, `/db`, `/orchestrator`, `/slack`, `/scripts`).
  - `.env.example` lists every config var with no real secrets committed.
  - README stub exists with project name, one-line description, and a "setup" placeholder section.

- [x] **T0.2 — Provision Postgres**
  - A Postgres instance exists (Supabase/Neon or equivalent) and is reachable via `DATABASE_URL`.
  - A local connection succeeds using the connection string from `.env`.

- [x] **T0.3 — OpenRouter setup**
  - Set up OpenRouter API key and confirm connection capability.

- [x] **T0.4 — Slack app setup**
  - A Slack app is created in the target workspace with `chat:write`, `channels:history` (or `im:history`), and event subscription scopes.
  - Bot token and signing secret are stored in `.env`, not committed.
  - A manual `chat.postMessage` call from a script successfully posts a test message to the target channel.

---

## Phase 1 — Database Layer (Redesigned)

- [x] **T1.1 — `user_lessons` table**
  - Migration creates the single `user_lessons` table per the simplified schema.
  - Schema includes columns: `difficulty`, `lesson_version` (default 1), and `teaching_score`.
  - Inserting one row and reading it back round-trips correctly.
  - Check constraint restricts `status` to `'pending' | 'understood' | 'vague'`.
  - `slack_message_ts` has a unique index.

- [x] **T1.2 — Seeding mock progress**
  - Seed script is updated to load dummy `user_lessons` rows with various states (`understood`, `vague`, `pending`) for local testing.
  - Re-running the seed script is idempotent (truncates/cascades first or updates conflicts).

- [x] **T1.3 — DB repository layer**
  - Typed functions exist in [repository.ts](file:///Users/yasinsaleem/Programming/Personal%20Projects/textme-tutor/db/src/repository.ts):
    - `getPendingLesson(userId)`: returns oldest pending lesson.
    - `getDueVagueLesson(userId, intervalDays)`: returns oldest vague lesson due for resend.
    - `createUserLesson(input)`: inserts a new lesson record.
    - `updateUserLessonStatus(slackMessageTs, status)`: updates status and updates `responded_at` to `NOW()`.
    - `getTopicProgress(userId)`: aggregates `understood` counts grouped by topic AND difficulty.
    - `hasProblemBeenSeen(leetcodeId, normalizedTitle, userId)`: returns boolean checking if a problem has already been delivered.
  - Each function has at least one test against a real DB instance in [repository.test.ts](file:///Users/yasinsaleem/Programming/Personal%20Projects/textme-tutor/db/tests/repository.test.ts) (no mocks).

---

## Phase 2 — Context Builder (Redesigned)

- [x] **T2.1 — Dynamic Context Builder**
  - Given `(leetcode_id, problem_title, topic, user_id)`, deterministically retrieves problem statement, constraints, examples, difficulty, topic, and tags from trusted sources (no LLM generation or invention).
  - Explicitly does **not** retrieve or provide official editorials or reference solutions.
  - Integrates the user's historical progress with this topic (from `getTopicProgress`).
  - Returns a structured context object for downstream agents.

---

## Phase 3 — Teaching Agent Pipeline

- [x] **T3.1 — Pattern Recognition Agent**
  - Given a context package, returns a list of signals and candidate approaches with confidence scores, and explicitly does not mention a final solution.
  - Test against 3 different problems produces plausible, differentiated output.

- [x] **T3.2 — Brute Force Agent**
  - Returns the naive approach, why it's the natural first instinct, complexity, and where it breaks down.
  - Output does not contain the optimal solution.

- [x] **T3.3 — Insight Discovery Agent**
  - Returns the single observation that bridges brute force to optimal, phrased as a discovery ("notice that...").

- [x] **T3.4 — Data Structure Reasoning Agent**
  - Returns a justification for the chosen structure, ruling out at least one plausible alternative.

- [x] **T3.5 — Complexity Reasoning Agent**
  - Returns a step-by-step derivation of time/space complexity, not a bare Big-O statement.

- [x] **T3.6 — Beginner Mistakes Agent**
  - Returns at least one concrete, problem-specific mistake.

- [x] **T3.7 — Recognition Checklist Agent**
  - Returns a short "when you see X, think Y" list generalizing to other problems of this topic.

- [x] **T3.8 — Teaching Agent**
  - Consumes outputs of T3.1–T3.7 and produces a single narrative, walkthrough style.
  - Word count lands within the ~5-minute-read target range (e.g., 600–900 words).

- [x] **T3.9 — Reviewer Agent + rejection loop**
  - Scores the lesson and returns a `teaching_score`.
  - If score is below threshold, re-runs Teaching Agent rather than publishing.

- [x] **T3.10 — Formatter Agent**
  - Converts the lesson into Slack markdown, respecting character limits.

- [x] **T3.11 — Full pipeline wiring**
  - A single function runs T3.1 → T3.10 in sequence for a given unique problem and returns a publish-ready lesson.

---

## Phase 4 — Problem Selection & Resend Priority Logic (Redesigned)

- [x] **T4.1 — Priority 1: pending lookup**
  - Calls `getPendingLesson(userId)` and returns the lesson record, or `null`.

- [x] **T4.2 — Priority 2: vague-due lookup**
  - Calls `getDueVagueLesson(userId, intervalDays)` and returns the lesson record, or `null`.

- [x] **T4.3 — Priority 3: curriculum-driven problem selection**
  - Logic checks `CURRICULUM` array configuration with nested difficulty targets (`Easy`, `Medium`, `Hard`).
  - Queries `getTopicProgress(userId)` to find the active topic and current target difficulty.
  - Invokes Problem Selection Agent, passing the active topic and target difficulty as prompt constraints, to generate a batch of **5 candidate LeetCode problems** (leetcode_id + problem_title).
  - Normalizes candidate titles.
  - Runs uniqueness check (`hasProblemBeenSeen`) with `leetcode_id` as primary check, and title as fallback.
  - Selects the first unseen candidate (loops selection agent only if all 5 are duplicates).
  - Validates the selected problem exists, belongs to the active topic, and strictly matches the requested target difficulty.
  - Returns unique, validated `(leetcode_id, problem_title, topic, difficulty)`.

- [x] **T4.4 — Vague regeneration path**
  - When Priority 2 fires, runs the teaching pipeline with a prompt flag indicating the previous explanation was marked vague.
  - Creates a new `user_lessons` record for the regenerated explanation (incrementing `lesson_version`).

- [x] **T4.5 — Combined priority resolver + edge case tests**
  - Wraps T4.1 → T4.3 in order and returns exactly one decision (Pending resend, Vague resend, or New selection).

---

## Phase 5 — Orchestrator (Process A / Cron)

- [x] **T5.1 — Orchestrator entrypoint**
  - A single script: resolves today's action (T4.5) → runs pipeline if new/regen needed (T3.11) or reuses existing lesson if resending pending → publishes to Slack → writes/updates `user_lessons` (storing difficulty, lesson_version, and teaching_score).

- [x] **T5.2 — Scheduled workflow**
  - A GitHub Actions workflow runs the orchestrator script daily, with secrets injected from repo environment.

- [x] **T5.3 — Failure handling**
  - Surfaces pipeline exceptions cleanly without leaving behind half-created or corrupt DB states.

---

## Phase 6 — Slack Publisher

- [x] **T6.1 — Post + capture `ts`**
  - Publishing a lesson calls `chat.postMessage`, and the returned `slack_message_ts` is stored on the corresponding `user_lessons` row.

---

## Phase 7 — Response Handler (Process B / Always-on Listener)

- [x] **T7.1 — Events API endpoint + signature verification**
  - An HTTPS endpoint receives Slack webhook callbacks and verifies Slack signing secrets.

- [x] **T7.2 — Thread → lesson lookup**
  - Looks up `user_lessons` record by `slack_message_ts = event.thread_ts`.

- [x] **T7.3 — Intent parser + fast-path regex**
  - Classifies user messages (understood, not_understood, conversational) with instant regex and LLM fallback.

- [x] **T7.4 — DB state transitions + acknowledgment**
  - Updates DB state to 'understood' or 'vague' and posts acknowledgment in-thread.

- [x] **T7.5 — Conversational thread explanations**
  - Uses thread history to reply inline to clarification questions with context-aware tutor guidance.

- [x] **T7.6 — Verification & endpoint integration test**
  - Integration tests verify signature checking, webhook challenge verification, state transitions, and conversational replies.

---

## Phase 8 — Analytics

- [x] **T8.1 — Response latency metric**
  - Query returns average/median response time using `sent_at` and `responded_at` from `user_lessons`.

- [x] **T8.2 — Vague trend by topic**
  - Query aggregates counts of vague status rows grouped by topic from `user_lessons`.

- [x] **T8.3 — Streak metric**
  - Query computes consecutive-`understood`-days streak using the `user_lessons` history.

---

## Phase 9 — Testing & Hardening

- [x] **T9.1 — End-to-end day-cycle test**
  - Scripted test simulating: send lesson → webhook response `Understood` → confirm next day's run picks a new problem under the correct curriculum topic and target difficulty.

- [x] **T9.2 — Late-reply idempotency test**
  - Confirm late thread replies match the correct historical row, without corrupting newer pending rows.

- [x] **T9.3 — Token/cost logging check**
  - Verify agent inputs/outputs and token counts are logged correctly to files/console (since `generation_runs` table is removed).

---

## Phase 10 — Deployment & Docs

- [x] **T10.1 — Deploy Process A**
- [x] **T10.2 — Deploy Process B**
- [x] **T10.3 — Basic alerting**
- [x] **T10.4 — README update**
