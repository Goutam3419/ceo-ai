import { test } from "node:test";
import assert from "node:assert/strict";

import { buildToolExecutors, runToolLoop } from "../api/ceo-chat.js";
import { createAppShell } from "../src/app/shell.js";

function textResponse(text) {
  return { content: [{ type: "text", text }] };
}

function toolUseResponse(name, input, id = "tool_1") {
  return { content: [{ type: "tool_use", id, name, input }] };
}

function fakeAnthropic(responses) {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const response = responses[call] ?? responses[responses.length - 1];
        call += 1;
        return response;
      },
    },
  };
}

test("buildToolExecutors: intake_goal calls the real CeoAgentBoundary", () => {
  const shell = createAppShell();
  const executors = buildToolExecutors(shell);

  const plan = executors.intake_goal({ title: "Launch referral program", steps: ["Design", "Build"] });

  assert.equal(plan.title, "Launch referral program");
  assert.equal(shell.ceoAgent.getPlan(plan.id).steps.length, 2);
});

test("buildToolExecutors: create_tasks_from_plan creates real Task Board tasks", () => {
  const shell = createAppShell();
  const executors = buildToolExecutors(shell);
  const plan = executors.intake_goal({ title: "X", steps: ["step one", "step two"] });

  const tasks = executors.create_tasks_from_plan({ goalId: plan.id });

  assert.equal(tasks.length, 2);
  assert.equal(shell.taskBoard.list().length, 2);
});

test("buildToolExecutors: request_approval creates a real pending approval request", () => {
  const shell = createAppShell();
  const executors = buildToolExecutors(shell);

  const req = executors.request_approval({ title: "Deploy to production" });

  assert.equal(req.status, "PENDING");
  assert.equal(shell.approvalCenter.list({ status: "PENDING" }).length, 1);
});

test("buildToolExecutors: list_pending_approvals and list_tasks reflect real state", () => {
  const shell = createAppShell();
  const executors = buildToolExecutors(shell);
  executors.request_approval({ title: "A" });
  const plan = executors.intake_goal({ title: "X", steps: ["s1"] });
  executors.create_tasks_from_plan({ goalId: plan.id });

  assert.equal(executors.list_pending_approvals().length, 1);
  assert.equal(executors.list_tasks().length, 1);
  assert.equal(executors.list_tasks({ status: "DONE" }).length, 0);
});

test("runToolLoop: executes a tool call then returns the model's final text reply", async () => {
  const shell = createAppShell();
  const anthropic = fakeAnthropic([
    toolUseResponse("intake_goal", { title: "Launch referral program", steps: ["Design", "Build"] }),
    textResponse("I've created a plan with 2 steps."),
  ]);

  const { reply, toolCalls } = await runToolLoop(anthropic, shell, [
    { role: "user", content: "I want to launch a referral program" },
  ]);

  assert.equal(reply, "I've created a plan with 2 steps.");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "intake_goal");
  assert.equal(toolCalls[0].result.title, "Launch referral program");
});

test("runToolLoop: chains multiple tool calls across turns", async () => {
  const shell = createAppShell();
  const anthropic = fakeAnthropic([
    toolUseResponse("intake_goal", { title: "X", steps: ["s1"] }, "call_1"),
    toolUseResponse("create_tasks_from_plan", { goalId: "PLACEHOLDER" }, "call_2"),
    textResponse("Done — created 1 task."),
  ]);

  const { reply, toolCalls } = await runToolLoop(anthropic, shell, [
    { role: "user", content: "Launch it" },
  ]);

  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0].name, "intake_goal");
  assert.equal(toolCalls[1].name, "create_tasks_from_plan");
  assert.equal(reply, "Done — created 1 task.");
});

test("runToolLoop: a tool execution error is captured as a tool_result error, not a crash", async () => {
  const shell = createAppShell();
  const anthropic = fakeAnthropic([
    toolUseResponse("create_tasks_from_plan", { goalId: "does-not-exist" }),
    textResponse("That goal doesn't exist, let me check again."),
  ]);

  const { reply, toolCalls } = await runToolLoop(anthropic, shell, [
    { role: "user", content: "create tasks for goal X" },
  ]);

  assert.equal(toolCalls[0].result.error !== undefined, true);
  assert.equal(reply, "That goal doesn't exist, let me check again.");
});

test("runToolLoop: an unknown tool name is handled as an error, not a crash", async () => {
  const shell = createAppShell();
  const anthropic = fakeAnthropic([
    toolUseResponse("not_a_real_tool", {}),
    textResponse("Something went wrong internally."),
  ]);

  const { toolCalls } = await runToolLoop(anthropic, shell, [{ role: "user", content: "hi" }]);

  assert.match(toolCalls[0].result.error, /Unknown tool/);
});

test("runToolLoop: stops after a maximum number of turns to avoid a runaway loop", async () => {
  const shell = createAppShell();
  // Always returns a tool_use response, never a final text — this
  // would loop forever without the safety cap.
  const anthropic = {
    messages: {
      create: async () => toolUseResponse("list_tasks", {}),
    },
  };

  const { reply, toolCalls } = await runToolLoop(anthropic, shell, [{ role: "user", content: "hi" }]);

  assert.ok(toolCalls.length <= 8);
  assert.match(reply, /runaway loop/);
});

test("runToolLoop: no reference to real GitHub/Deployment execution among available tool executors", () => {
  const shell = createAppShell();
  const executors = buildToolExecutors(shell);

  assert.equal(executors.execute_github_intent, undefined);
  assert.equal(executors.execute_deployment, undefined);
  assert.equal(executors.deploy, undefined);
});
