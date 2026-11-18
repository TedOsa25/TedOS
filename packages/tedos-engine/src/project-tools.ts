import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** Commands the worker is allowed to run (exact match, after trimming). */
const ALLOWED_COMMANDS = [
  "npm test",
  "npm run test",
  "npm run typecheck",
  "npm run lint",
  "npm run build",
];

/** Cap command output so a noisy build doesn't flood the model context. */
const MAX_OUTPUT = 4000;

/** The result of running an allowed command. */
export interface CommandResult {
  ok: boolean;
  output: string;
}

/**
 * ProjectTools gives a worker safe, sandboxed access to one project.
 *
 * Every file path is confined to `root`; every command must be on the
 * allowlist. It records the files it changed and the commands it ran so
 * the worker can report them. It performs no deletes and no git, deploy,
 * or other destructive actions — those operations simply don't exist here.
 */
export class ProjectTools {
  readonly changedFiles: string[] = [];
  readonly commands: string[] = [];
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a project-relative path, rejecting anything outside root. */
  private safePath(path: string): string {
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Path escapes project root: ${path}`);
    }
    return full;
  }

  /** Read a UTF-8 text file inside the project. */
  readFile(path: string): string {
    return readFileSync(this.safePath(path), "utf8");
  }

  /** Create or overwrite a text file inside the project. */
  writeFile(path: string, content: string): void {
    const full = this.safePath(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
    this.record(path);
  }

  /** Replace the first occurrence of `find` with `replace` in a file. */
  editFile(path: string, find: string, replace: string): void {
    const full = this.safePath(path);
    const current = readFileSync(full, "utf8");
    if (!current.includes(find)) {
      throw new Error(`Text to replace was not found in ${path}`);
    }
    writeFileSync(full, current.replace(find, replace), "utf8");
    this.record(path);
  }

  /** Run one allowlisted command inside the project; reject anything else. */
  runCommand(command: string): CommandResult {
    const trimmed = command.trim();
    if (!ALLOWED_COMMANDS.includes(trimmed)) {
      throw new Error(`Command not allowed: ${command}`);
    }

    const [cmd, ...args] = trimmed.split(/\s+/);
    const result = spawnSync(cmd ?? "", args, {
      cwd: this.root,
      encoding: "utf8",
    });

    this.commands.push(trimmed);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .trim()
      .slice(0, MAX_OUTPUT);
    return { ok: result.status === 0, output };
  }

  private record(path: string): void {
    if (!this.changedFiles.includes(path)) this.changedFiles.push(path);
  }
}
