import { createAppShell } from "../src/app/shell.js";
import { connectFirebaseSnapshot } from "../src/persistence/index.js";
import { RISK_LEVELS, ROLES } from "../src/shared/types.js";

/**
 * CEO Agent chat endpoint — a real, Founder-facing chat interface.
 *
 * POST { message: string, history?: {role, content}[] }
 * → { reply: string, toolCalls: {name, input, result}[] }
 *
 * What this DOES do:
 *   - Talks to the real Anthropic (Claude) API with tool-use, wired to
 *     the actual CeoAgentBoundary / ApprovalCenter / TaskBoard from
 *     this codebase's app shell — not a simulation.
 *   - Loads/saves the full app state from/to Firebase on every
 *     request if Firebase env vars are configured (see
 *     src/persistence/), since serverless functions don't keep
 *     in-memory state between invocations.
 *
 * What this deliberately DOES NOT do (a safety decision made here,
 * not an oversight):
 *   - It does NOT expose githubExecutor.execute() or
 *     deploymentExecutor.execute() as chat tools. The chat can create
 *     goals, tasks, and approval REQUESTS — it cannot itself trigger a
 *     real GitHub push or a real Vercel deploy. That keeps the
 *     founder-approval gate meaningful: even if this endpoint were
 *     compromised or misused, it cannot execute anything by itself.
 *     Wiring real execution into chat (e.g. "founder approves in chat
 *     → CEO Agent immediately executes") is future work, on top of
 *     the executors already built.
 *
 * Known limitations (see README):
 *   - Cannot be tested against the real Anthropic/Firebase APIs in
 *     the environment this was written in (no network access, no
 *     firebase-admin/@anthropic-ai/sdk installed there). The shape of
 *     every call here matches each provider's documented API, but a
 *     real end-to-end run has not been performed.
 *   - Loads/saves the ENTIRE snapshot on every message. Fine at small
 *     scale; would need a smarter incremental approach at larger scale.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const SYSTEM_PROMPT = `You are the CEO Agent inside an AI Company OS.

Permanent rules you must always follow:
- Roles are permanent: FOUNDER, CEO_AGENT, CTO_AGENT, PM. Providers (which AI vendor/model powers a role) are a separate, swappable concept — never treat a provider name as if it were a role.
- You act as CEO_AGENT. You handle goal intake, planning, task creation, and requesting approval. You do NOT execute GitHub or deployment actions yourself — those require a separate, explicit founder-approved execution step outside this chat.
- When the founder describes a goal, break it into concrete steps and call intake_goal, then create_tasks_from_plan to turn it into real tracked tasks.
- For anything that sounds risky (deploying, pushing code, spending money, changing production), call request_approval instead of assuming it's fine.
- Be concise and clear. Explain what you're about to do before calling a tool if it has real effects.`;

const TOOLS = [
  {
    name: "intake_goal",
    description:
      "Accept a founder goal and normalize it into an internal plan (a list of concrete steps). Call this first for any new goal.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the goal" },
        description: { type: "string", description: "Optional longer description" },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Concrete steps to accomplish the goal",
        },
      },
      required: ["title", "steps"],
    },
  },
  {
    name: "create_tasks_from_plan",
    description: "Turn a plan's steps into real Task Board tasks, one per step.",
    input_schema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "The id returned by intake_goal" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "get_plan",
    description: "Look up a previously recorded plan by its goal id.",
    input_schema: {
      type: "object",
      properties: { goalId: { type: "string" } },
      required: ["goalId"],
    },
  },
  {
    name: "request_approval",
    description:
      "Request founder approval for a high-risk or sensitive action. Does NOT execute anything — only creates a pending approval request the founder must act on separately.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        riskLevel: { type: "string", enum: Object.values(RISK_LEVELS) },
      },
      required: ["title"],
    },
  },
  {
    name: "list_pending_approvals",
    description: "List all approval requests currently awaiting the founder's decision.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "List tasks, optionally filtered by status (TODO, IN_PROGRESS, DONE).",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["TODO", "IN_PROGRESS", "DONE"] } },
    },
  },
];

function buildToolExecutors(shell) {
  return {
    intake_goal: (input) => shell.ceoAgent.intakeGoal(input),
    create_tasks_from_plan: (input) => shell.ceoAgent.createTasksFromPlan(input.goalId),
    get_plan: (input) => shell.ceoAgent.getPlan(input.goalId),
    request_approval: (input) => shell.ceoAgent.requestApproval(input),
    list_pending_approvals: () => shell.approvalCenter.list({ status: "PENDING" }),
    list_tasks: (input) => shell.taskBoard.list(input?.status ? { status: input.status } : undefined),
  };
}

async function runToolLoop(anthropic, shell, messages) {
  const executors = buildToolExecutors(shell);
  const toolCalls = [];

  // Guard against a runaway loop if the model keeps calling tools.
  for (let turn = 0; turn < 8; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
    });

    const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");
    if (toolUseBlocks.length === 0) {
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return { reply: text, toolCalls };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      let isError = false;
      try {
        const executor = executors[block.name];
        if (!executor) throw new Error(`Unknown tool: ${block.name}`);
        result = executor(block.input);
      } catch (error) {
        result = { error: error.message };
        isError = true;
      }
      toolCalls.push({ name: block.name, input: block.input, result });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "I've made several tool calls but haven't reached a final answer — stopping to avoid a runaway loop.",
    toolCalls,
  };
}

export { TOOLS, buildToolExecutors, runToolLoop };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const accessToken = process.env.CEO_CHAT_ACCESS_TOKEN;
  if (accessToken) {
    const provided = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (provided !== accessToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set. Add it in Vercel's Project → Settings → Environment Variables.",
    });
    return;
  }

  const { message, history } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Request body must include a 'message' string." });
    return;
  }

  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch (error) {
    res.status(500).json({
      error:
        "The '@anthropic-ai/sdk' package isn't installed. It's listed in package.json dependencies — make sure Vercel ran npm install.",
    });
    return;
  }
  const anthropic = new Anthropic({ apiKey });

  const shell = createAppShell();

  let firebaseSnapshot = null;
  try {
    firebaseSnapshot = await connectFirebaseSnapshot();
    if (firebaseSnapshot) {
      await firebaseSnapshot.load(shell.stores);
    }
  } catch (error) {
    // Firebase being misconfigured shouldn't take the whole chat down —
    // surface it, but keep going with in-memory-only state this request.
    console.error("Firebase load failed:", error.message);
  }

  const messages = [...(Array.isArray(history) ? history : []), { role: "user", content: message }];

  try {
    const { reply, toolCalls } = await runToolLoop(anthropic, shell, messages);

    if (firebaseSnapshot) {
      try {
        await firebaseSnapshot.save(shell.stores);
      } catch (error) {
        console.error("Firebase save failed:", error.message);
      }
    }

    res.status(200).json({ reply, toolCalls });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
