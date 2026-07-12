# Daily DSA Intuition Builder (TextMe-Tutor)

Deliver one Slack lesson per day that teaches how to build deep intuition, recognize patterns, and derive optimal solutions for LeetCode problems instead of just memorizing answers.

---

## System Architecture

The application is structured into two main processes that operate on a single, minimal PostgreSQL database:

1. **Process A: Daily Orchestrator (Cron / Scheduled Run)**
   - Runs daily at a scheduled time.
   - Resolves today's action using a priority queue (Priority 1: pending lookup, Priority 2: vague-due lookup, Priority 3: new curriculum selection).
   - Generates intuition-rich lessons using a modular 10-agent LLM pipeline with scoring reviewer gates and API resiliency retry routing.
   - Publishes lessons as top-level messages to Slack and records timestamps in the database.
   - Designed with strict transaction-like fail-safety (database writes occur only as the final step after Slack/LLM steps succeed).

2. **Process B: Event listener (Always-on Listener)**
   - Starts an HTTP listener on a configurable port to receive Slack event webhook callbacks.
   - Verifies incoming webhook call signatures using HMAC-SHA256 matching.
   - Routes replies in lesson threads to map them to the database record.
   - Classifies user responses (Understood, Not Understood / Vague, or Conversational) using a fast-path regex check and LLM fallback.
   - Transitions database state and posts completions/replies (using Slack thread message history for conversational context).

---

## Setup & Environment Configuration

Copy `.env.example` to `.env` and configure the following variables:

```env
# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/dbname

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_CHANNEL_ID=C0BGDQSB38C

# LLM Gateway Configuration
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openrouter/free
OPENROUTER_HTTP_REFERER=http://localhost:3000
OPENROUTER_APP_TITLE=Daily DSA Intuition Builder

# Scheduling controls
VAGUE_RESEND_INTERVAL_DAYS=3
TEACHING_SCORE_THRESHOLD=8.5
USER_ID=default-user
```

---

## Database Operations

Install dependencies and run database migrations/seeds:

```bash
# Install dependencies
npm install

# Run schema migrations
npm run db:migrate

# Seed mock progress data
npm run db:seed
```

---

## Running the Application

### Process A: Daily Run (Orchestrator)
Execute the daily orchestrator cron cycle manually:
```bash
npm start
```

### Process B: Thread Response listener
Start the HTTP server to listen to incoming Slack thread replies:
```bash
node --env-file=.env --import tsx slack/listener.ts
```

---

## Verification & Testing

Verify the system components using the sequential test suite runner:

```bash
# Run all tests sequentially (database, pipeline agents, priority resolver, and listener)
npm test
```

---

## Deployment Instructions

### Deploying Process A (GitHub Actions)
Configure a GitHub Actions workflow to execute the orchestrator daily.
1. The `.github/workflows/daily-run.yml` file is pre-configured to run daily at 08:00 AM UTC.
2. In your GitHub Repository settings, navigate to **Settings > Secrets and variables > Actions** and create the following secrets:
   - `DATABASE_URL`
   - `OPENROUTER_API_KEY`
   - `SLACK_BOT_TOKEN`
   - `SLACK_CHANNEL_ID`

### Deploying Process B (Render / Fly.io / Web Host)
Deploy the webhook listener to any hosting provider that supports Node.js.
1. Host the project on a platform like **Fly.io** or **Render.com**.
2. Expose the listener port (default: `3000`).
3. Set the environment variables in your deployment settings.
4. Set up the Slack Event Subscriptions URL pointing to your deployment:
   `https://your-app-domain.com` (Ensure it verifies the challenge payload).
5. Subscribe to the `message.channels` event under your Slack App configurations.

### Basic Alerting & Monitoring
- **Process A**: If Process A fails, GitHub Actions automatically sends an email notification on workflow failure.
- **Process B Health Check**: You can ping the listener server root to verify connection health.
- **Token Audits**: Audit token consumption metrics at any time by reviewing the local log file [logs/token-usage.jsonl](logs/token-usage.jsonl).
