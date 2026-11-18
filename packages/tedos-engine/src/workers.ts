import Anthropic from "@anthropic-ai/sdk";
import type {
  ExecutionRequest,
  ExecutionResult,
  Plan,
  ProjectContext,
  Worker,
  WorkerKind,
} from "./types.js";
import { ProjectTools } from "./project-tools.js";

/** Model the real ClaudeWorker calls. */
const CLAUDE_MODEL = "claude-opus-4-8";

/** Upper bound on tool-use turns so the agentic loop can't run away. */
const MAX_STEPS = 8;

/** The tools the worker exposes to Claude (all confined to ProjectTools). */
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file inside the project.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Project-relative path" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file inside the project.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path" },
        content: { type: "string", description: "Full new file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace the first occurrence of `find` with `replace` in a file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        find: { type: "string" },
        replace: { type: "string" },
      },
      required: ["path", "find", "replace"],
    },
  },
  {
    name: "run_command",
    description:
      "Run one allowed command: npm test, npm run test, npm run typecheck, npm run lint, or npm run build.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
];

/**
 * Simulate execution of a prepared request.
 *
 * Used by LocalWorker and by ClaudeWorker's no-API-key fallback, so the
 * request -> result mapping lives in one place. Every task succeeds with
 * canned output and no file/command activity.
 */
function simulate(request: ExecutionRequest): ExecutionResult {
  return {
    goalId: request.goalId,
    results: request.tasks.map((task) => ({
      taskId: task.id,
      success: true,
      output: `[${request.worker} ${request.repository}] ${task.description}`,
      changedFiles: [],
      commands: [],
    })),
  };
}

/** Build the backend-agnostic request a worker would execute. */
function prepare(
  worker: string,
  plan: Plan,
  context: ProjectContext,
): ExecutionRequest {
  return {
    worker,
    goalId: plan.goalId,
    repository: context.repository,
    path: context.path,
    connectors: context.connectors,
    instructions: `Execute ${plan.tasks.length} task(s) for goal "${plan.goalId}" in ${context.repository} (${context.path}).`,
    tasks: plan.tasks,
  };
}

/** Collect the text blocks of a model message. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

/**
 * ClaudeWorker executes tasks as real local project work.
 *
 * With ANTHROPIC_API_KEY set, it runs an agentic loop: Claude reads,
 * writes, and edits files and runs allowed commands through ProjectTools,
 * which confines everything to ProjectContext.path. Without a key it falls
 * back to the simulated behaviour, so the engine still runs offline. It is
 * the only worker that makes a network call, and only to Anthropic.
 */
export class ClaudeWorker implements Worker {
  readonly name = "claude";

  async execute(plan: Plan, context: ProjectContext): Promise<ExecutionResult> {
    const request = prepare(this.name, plan, context);

    if (!process.env.ANTHROPIC_API_KEY) {
      return simulate(request);
    }

    const tools = new ProjectTools(context.path);
    try {
      const summary = await this.runWithClaude(request, context, tools);
      return this.result(request, true, summary, tools);
    } catch (err) {
      // Surface the failure so the Reviewer rejects and the Loop retries.
      return this.result(request, false, `Claude execution failed: ${String(err)}`, tools);
    }
  }

  /** Drive Claude through a bounded tool-use loop against ProjectTools. */
  private async runWithClaude(
    request: ExecutionRequest,
    context: ProjectContext,
    tools: ProjectTools,
  ): Promise<string> {
    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content:
          `${request.instructions}\n\nTasks:\n` +
          `${request.tasks.map((task) => `- ${task.description}`).join("\n")}\n\n` +
          `Use the tools to make the changes inside the project. When finished, summarize the files you changed and commands you ran.`,
      },
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      const message = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: this.systemPrompt(context),
        tools: CLAUDE_TOOLS,
        messages,
      });

      messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason !== "tool_use") {
        return textOf(message);
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        const { content, isError } = this.runTool(block.name, block.input, tools);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content,
          is_error: isError,
        });
      }
      messages.push({ role: "user", content: results });
    }

    return "Reached the tool-use step limit before completing.";
  }

  /** Execute one tool call safely; failures come back as recoverable errors. */
  private runTool(
    name: string,
    input: unknown,
    tools: ProjectTools,
  ): { content: string; isError: boolean } {
    const args = (input ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case "read_file":
          return { content: tools.readFile(String(args["path"])), isError: false };
        case "write_file":
          tools.writeFile(String(args["path"]), String(args["content"]));
          return { content: `Wrote ${String(args["path"])}`, isError: false };
        case "edit_file":
          tools.editFile(
            String(args["path"]),
            String(args["find"]),
            String(args["replace"]),
          );
          return { content: `Edited ${String(args["path"])}`, isError: false };
        case "run_command": {
          const result = tools.runCommand(String(args["command"]));
          return {
            content: result.output || (result.ok ? "(no output)" : "(failed)"),
            isError: !result.ok,
          };
        }
        default:
          return { content: `Unknown tool: ${name}`, isError: true };
      }
    } catch (err) {
      return { content: String(err), isError: true };
    }
  }

  /** Build an ExecutionResult, attaching the files changed and commands run. */
  private result(
    request: ExecutionRequest,
    success: boolean,
    output: string,
    tools: ProjectTools,
  ): ExecutionResult {
    return {
      goalId: request.goalId,
      results: request.tasks.map((task) => ({
        taskId: task.id,
        success,
        output,
        changedFiles: [...tools.changedFiles],
        commands: [...tools.commands],
      })),
    };
  }

  private systemPrompt(context: ProjectContext): string {
    return [
      `You are an autonomous worker in TedOS doing real work on the project "${context.name}".`,
      `Work only inside the project at ${context.path} using the provided tools.`,
      `You may read, write, and edit files and run only these commands: npm test, npm run test, npm run typecheck, npm run lint, npm run build.`,
      `You may not delete files, run other commands, touch anything outside the project, or perform any git, deploy, or external action.`,
      `Make the smallest change that satisfies the task, then summarize what you changed.`,
    ].join(" ");
  }
}

/**
 * LocalWorker is a placeholder for a local (non-AI) executor.
 *
 * It prepares a context-bearing request and returns a simulated result;
 * it stands in for running work in-process or via local tools.
 */
export class LocalWorker implements Worker {
  readonly name = "local";

  async execute(plan: Plan, context: ProjectContext): Promise<ExecutionResult> {
    return simulate(prepare(this.name, plan, context));
  }
}

/**
 * WorkerFactory builds a Worker by kind.
 *
 * It is the only place that knows the concrete worker classes. The
 * Runner and the rest of the engine depend solely on the Worker
 * interface, so new worker types are added here without touching them.
 */
export class WorkerFactory {
  static create(kind: WorkerKind): Worker {
    switch (kind) {
      case "claude":
        return new ClaudeWorker();
      case "local":
        return new LocalWorker();
    }
  }
}
