# Daily DSA Intuition Builder — System Design

> **Goal:** Deliver one Slack lesson per day (~5 min read) that teaches *how to recognize and derive* a solution, not just the solution itself. Interaction is deliberately minimal: the user replies `Understood` or `Vague`, and that single signal drives spaced repetition.

---

## 1. Philosophy

Most explainers teach the answer. This system teaches the reasoning path an experienced engineer would take to get there. Every lesson should implicitly answer:

- What should I notice first?
- What patterns does this resemble?
- Why does brute force fail?
- What single observation unlocks the optimal approach?
- Why this data structure, and not another?
- Why is the complexity what it is (derived, not stated)?
- What do beginners usually get wrong here?
- How do I recognize this shape of problem next time?

Success is measured by whether the reader starts recognizing patterns *before* writing code — not by lesson count read.

---

## 2. User Interaction Model

This is the part that needed the most specification — the original doc didn't define it at all. Everything below is built around your six rules.

**The contract with the user is intentionally narrow:** one message in, one of two possible replies out, one automated acknowledgment. Nothing else is parsed, and nothing else gets a response.

### 2.1 Daily flow

1. Cron fires once a day.
2. Before touching the problem-selection pipeline, the system resolves **which problem to send** using a strict priority order (see 2.2).
3. Lesson is generated (or reused, if this is a resend) and posted to Slack as a new top-level message.
4. A `lesson_deliveries` row is created/updated with `status = 'pending'` and the Slack message's `ts` (timestamp) saved — this `ts` is what future thread replies will be matched against.
5. The user may reply *in that message's thread* with `Understood` or `Vague`. Anything else, or any reply outside that thread, is ignored entirely.
6. On a valid, matched reply, the system updates the DB and — **only if that update succeeds** — posts an automated acknowledgment in-thread.
7. If the user never replies, nothing is written to the DB, and the next day's cron run will detect the still-`pending` row and resend that exact same lesson (see 2.2, Priority 1).

### 2.2 Resend priority logic (the core refinement)

Your spec described two resend triggers — "vague" and "no response" — but didn't say how they interact if both could apply, or what "checks the DB first" means precisely. Here's the resolved logic:

```
On each daily run, for a given user:

PRIORITY 1 — Unanswered lesson (silence)
  SELECT * FROM lesson_deliveries
  WHERE user_id = :user AND status = 'pending'
  ORDER BY sent_at ASC LIMIT 1

  → If found: resend the SAME lesson_markdown, same problem.
    Do not regenerate. Do not touch teaching pipeline.
    (Silence means "didn't engage," not "found it unclear" —
    no reason to change the content.)

PRIORITY 2 — Vague problem whose resend interval has elapsed
  SELECT * FROM lesson_deliveries
  WHERE user_id = :user AND status = 'vague'
    AND NOW() - responded_at >= VAGUE_RESEND_INTERVAL_DAYS
  ORDER BY responded_at ASC LIMIT 1

  → If found: re-run the Teaching Agent (and optionally Insight
    Discovery Agent) for this problem with a note that the prior
    explanation was marked unclear, so it generates a genuinely
    different walkthrough rather than repeating text the user
    already found confusing. Create a new lesson_deliveries row,
    status = 'pending'.

PRIORITY 3 — Nothing owed, pick something new
  → Run the normal Problem Selection Agent.
```

**Recommended improvement:** resending a `vague` problem with the *identical* explanation is low-value — if it wasn't clear once, it likely won't be clear verbatim a second time. Regenerating with an explicit "previous explanation was marked vague, try a different angle" instruction to the Teaching Agent is a small change with an outsized payoff. This is optional but strongly recommended.

### 2.3 Response handling (Slack side)

- Slack posts an event to a webhook whenever a message is sent in a thread the bot is watching.
- The handler checks `event.thread_ts` and looks up the delivery row **by `slack_message_ts = event.thread_ts`** — not "most recent pending row." Matching by thread ID (not recency) avoids race conditions if a late reply arrives after a new lesson has already gone out.
- Message text is trimmed, lowercased, and matched against two regexes:

```regex
Understood:  ^understood[.!]?$
Vague:       ^vague[.!]?$
```

- No match, or a match against a row that's no longer `pending` (already resolved) → ignored silently. No reply is sent for unmatched messages, consistent with "no other chatting occurs."
- On a match:
  1. Attempt `UPDATE lesson_deliveries SET status = :intent, responded_at = NOW() WHERE slack_message_ts = :thread_ts AND status = 'pending'`.
  2. **If the update succeeds** → post an automated in-thread reply:
     - Understood → `"✅ Marked as understood. See you tomorrow."`
     - Vague → `"🔁 Noted — I'll bring this one back in {N} days."`
  3. **If the update fails** (DB error, no matching row, etc.) → do not send any confirmation to the user; log the failure for ops visibility instead.

This satisfies your rule 5 exactly: the bot only ever speaks in response to the user when its own DB write actually landed.

### 2.4 Why a regex on free text is fragile (flagging, not overriding)

You specified regex parsing of two literal words, so that's what's documented above. One thing worth flagging: free-text parsing is sensitive to typos, autocorrect, and stray punctuation, and Slack's own **Block Kit buttons** (`Understood` / `Vague` as two literal buttons under the message) give you the same two deterministic outcomes with zero parsing risk. If you want to keep it as pure text for simplicity, the regex above works fine — this is just worth a second look before you build it out.

---

## 3. Architecture

The original diagram treated this as one monolithic pipeline. It actually needs **two independent processes**, because a cron job cannot receive inbound webhooks:

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│   PROCESS A — Cron Job      │        │  PROCESS B — Always-on        │
│   (runs once/day)           │        │  Slack Event Listener         │
│                              │        │  (small server or serverless) │
│  1. Resolve today's problem  │        │                               │
│     (priority logic §2.2)    │        │  Receives Slack Events API    │
│  2. Run agent pipeline if    │        │  callbacks (message replies)  │
│     new problem/regen needed │        │                               │
│  3. Reviewer gate            │        │  Matches thread_ts → DB row   │
│  4. Format → Slack Publisher │        │  Regex-parses reply           │
│  5. Write lesson_deliveries  │        │  Updates lesson_deliveries    │
│     row (status='pending')   │        │  Posts ack if update succeeds │
└──────────────┬──────────────┘        └───────────────┬──────────────┘
               │                                        │
               ▼                                        ▼
                       ┌───────────────────────┐
                       │      Database          │
                       │ (Postgres recommended) │
                       └───────────────────────┘
```

### Multi-agent teaching pipeline (inside Process A, step 2)

```
Pattern Recognition Agent
        │
        ▼
Brute Force Agent
        │
        ▼
Insight Discovery Agent  ← the "aha" agent, most important
        │
        ▼
Data Structure Reasoning Agent
        │
        ▼
Complexity Reasoning Agent
        │
        ▼
Beginner Mistakes Agent
        │
        ▼
Recognition Checklist Agent
        │
        ▼
Teaching Agent (weaves everything into a narrative)
        │
        ▼
Reviewer Agent (quality gate — can reject and loop back)
        │
        ▼
Formatter Agent (Slack Markdown)
```

---

## 4. Database Schema

Refined from the original — merged tables that served the same purpose, dropped one that no longer applies, and added the fields the interaction model actually needs.

### `problems`
```sql
id
leetcode_id
title
difficulty        -- Easy | Medium | Hard
url
statement
constraints
editorial
reference_solution
pattern
subpattern
companies
tags
created_at
```

### `lessons`
```sql
id
problem_id         -- FK
lesson_markdown
teaching_score
word_count
version            -- increments on regeneration (e.g. after a 'vague' mark)
generated_at
```

### `lesson_deliveries`  (replaces the original `user_progress` + `lesson_feedback`)
This is the table the whole interaction model hinges on.
```sql
id
user_id
problem_id
lesson_id
status             -- 'pending' | 'understood' | 'vague'
slack_channel_id
slack_message_ts    -- the message this delivery was posted as; reply matching key
sent_at
responded_at        -- null until user replies
vague_count          -- increments each time this problem is marked vague
created_at
updated_at
```
> **Dropped:** the original `lesson_feedback` table (`clarity_score`, `difficulty_score`, `notes`) assumed free-text feedback. That doesn't exist in this interaction model — there's no channel for it. If you want richer signal later, it has to come through an expanded interaction surface (see §9), not this table.

### `learning_patterns`
```sql
id
user_id
pattern
times_seen
times_understood     -- renamed from times_completed for clarity
times_vague
confidence_score
last_seen
```

### `generation_runs`  (debugging/observability, unchanged in spirit)
```sql
id
run_id
agent_name
input
output
tokens
latency_ms
status
created_at
```

---

## 5. Module Breakdown

### 5.1 Scheduler
Fires once daily (e.g. 08:00 IST). Given this is a single sequential job with no concurrency or long-running-workflow needs, a **GitHub Actions scheduled workflow** is enough — no need for Airflow or Temporal at this scale. Reach for those only if you later add multiple schedules, multi-tenant scaling, or workflows that need to survive across days.

### 5.2 Orchestrator
Coordinates agent calls; never generates content itself. At this scale, a plain sequential script (TypeScript or Python) is sufficient. LangGraph is a reasonable optional upgrade if you want built-in per-node retries/state — but it's not required for a single-user, single-daily-run pipeline.

### 5.3 Problem Selection
Runs the priority logic from §2.2 first. Only if nothing is owed (no pending, no due vague) does it fall through to genuine new-problem selection:
- never repeat a recently-covered pattern
- gradually increase difficulty
- interleave topics (Arrays → HashMap → Two Pointers → Sliding Window → Binary Search → Trees → Graphs → DP)

Output:
```json
{ "problem_id": 123, "pattern": "Sliding Window", "difficulty": "Medium" }
```

### 5.4 Context Builder
Assembles everything downstream agents need into one package: problem statement, constraints, editorial, known solutions, edge cases, pattern/company tags, and the user's history with this pattern. Every agent consumes this same package — no agent re-fetches its own context.

---

## 6. The Teaching Agents

| Agent | Mission | Recommended model |
|---|---|---|
| Pattern Recognition | Lists signals (sorted? continuous? greedy?) and candidate approaches with confidence, without solving | OpenRouter small model |
| Brute Force | States the naive approach, why people reach for it first, and where it breaks | OpenRouter small model |
| Insight Discovery | Finds the smallest observation that turns brute force into optimal — the "aha" moment | OpenRouter reasoning model |
| Data Structure Reasoning | Explains *why* this structure (e.g. "a set loses frequency, an array can't index arbitrary values, a HashMap satisfies exactly what we need") | OpenRouter reasoning model |
| Complexity Reasoning | Derives complexity from the mechanics rather than stating it | OpenRouter reasoning model |
| Beginner Mistakes | Surfaces the specific wrong turns beginners take on this problem shape | OpenRouter reasoning model |
| Recognition Checklist | Produces the reusable "when you see X, think Y" heuristic — probably the highest-ROI section for long-term retention | OpenRouter reasoning model |
| Teaching Agent | Weaves all of the above into one narrative, interview-style | OpenRouter reasoning model |
| Reviewer | Scores accuracy, flow, hallucination risk, brevity, educational quality; rejects below threshold | OpenRouter reasoning model |
| Formatter | Converts the reviewed lesson into Slack Markdown | OpenRouter small model |

Model recommendations reflect the OpenRouter catalog as of this writing — worth a quick check against the OpenRouter model list before you lock in model strings, since availability changes.

### Reviewer scoring example
```json
{ "teaching_score": 9.4, "pattern_clarity": 9.8, "flow": 9.6, "reasoning": 9.2, "brevity": 8.7 }
```
Lessons below your configured `TEACHING_SCORE_THRESHOLD` get rejected and regenerated before ever reaching Slack — no lesson bypasses this gate.

---

## 7. Slack Publisher & Response Handler

**Publisher (Process A):** posts the lesson as a new top-level message, saves the returned `ts` into `lesson_deliveries.slack_message_ts`. No reaction buttons, no bookmarking — those don't fit the two-reply model and were dropped from the original spec's list.

**Response Handler (Process B):** a small always-on service subscribed to Slack's Events API (`message` events). It only needs an HTTPS endpoint Slack can reach — Slack's Events API works over plain HTTP callbacks, so a serverless function (Vercel/Cloudflare Workers) or a small persistent app (Fly.io/Render) both work; you don't need Socket Mode or a long-lived connection. Use `@slack/bolt` (Node) or `slack_bolt` (Python) rather than hand-rolling signature verification and event routing.

---

## 8. Analytics

Trimmed to match what's actually collectible under this interaction model — the original list (reactions, bookmarks, read time) assumed richer engagement signals that don't exist here.

Collectible per delivery:
- sent → responded time gap
- resolution type (understood / vague / silently resent)
- `vague_count` trend per pattern (which patterns keep needing re-explanation — this is your best signal for where the teaching content itself is weak)
- streak of consecutive `understood` days

---

## 9. Recommended Tech Stack (summary)

| Concern | Recommendation | Why |
|---|---|---|
| Scheduler | GitHub Actions (cron) | Single daily job — Airflow/Temporal is overkill here |
| Orchestrator | Plain script (TS/Python) | Sequential pipeline, no need for a workflow engine yet |
| Database | Postgres (Supabase/Neon) | Relational schema with FKs and interval math fits naturally |
| Slack integration | `@slack/bolt` or `slack_bolt` | Handles signature verification + event routing for you |
| Response listener hosting | Vercel/Cloudflare Workers, or Fly.io/Render | Needs to be reachable 24/7; cron process can't receive webhooks |
| LLM | OpenRouter API, tiered by agent (see §6 table) | Matches reasoning load to cost per agent |

---

## 10. Configuration

```
VAGUE_RESEND_INTERVAL_DAYS   # default: 3
TEACHING_SCORE_THRESHOLD     # default: 8.5
LESSON_SEND_TIME             # e.g. "08:00" (IST)
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
SLACK_CHANNEL_ID             # or per-user DM mapping if multi-user
OPENROUTER_API_KEY
DATABASE_URL
```

---

## 11. Design Principles

1. Teach thinking, not answers.
2. Explain discoveries, not conclusions.
3. Build intuition through repeated pattern recognition.
4. Derive complexity instead of stating it.
5. Explain why alternatives fail.
6. Separate reasoning into specialized expert agents.
7. Use a reviewer agent to maintain educational quality — no lesson bypasses it.
8. Optimize each lesson for ~5 minutes of focused reading.
9. Reinforce transferable heuristics that apply to unseen problems.
10. Personalize content based on the learner's evolving mastery.
11. **Keep the user-facing surface deterministic.** Two possible replies, two possible outcomes — no ambiguity, no free-form chat.
12. Agent/pipeline complexity stays entirely on the backend; it should never leak into what the user has to parse or respond to.

---

## 12. Future Enhancements

- Interactive diagrams for pointer movement / animated graph traversal visualizations.
- Adaptive difficulty via spaced repetition tuned by `vague_count` trends.
- Weekly "Pattern Review" digest summarizing the week's concepts.
- RAG over previous lessons to reinforce earlier material.
- A "Why not?" agent that explicitly rules out alternative algorithms.
- Voice narration for passive/commute learning.
- **Mini quizzes for recognition testing** — flagged: this needs an expanded interaction surface (multiple-choice replies, not a two-word regex), so it's a bigger change than it looks, not a drop-in addition.

---

## 13. Summary of Changes from the Original Doc

For transparency, here's what was added, changed, or removed relative to the source document:

- **Added entirely:** the resend priority logic (§2.2), thread-based reply matching, the two-process architecture split (cron vs. always-on listener), and the response handler design — none of this existed in the original.
- **Removed:** the `lesson_feedback` table and free-text feedback assumptions; reaction buttons and bookmarking from the publisher/analytics sections — none of these fit a strict two-reply interaction model.
- **Changed:** `user_progress` merged into `lesson_deliveries` with the fields the resend logic actually needs (`status`, `slack_message_ts`, `vague_count`).
- **Flagged, not changed:** regex-on-free-text vs. Block Kit buttons (§2.4); resending a `vague` problem verbatim vs. regenerating with a different framing (§2.2) — both are your call, documented as open decisions rather than silently resolved.
