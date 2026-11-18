import type { GoalCandidate, GoalKind, GoalProvider } from "./types.js";

/** Minimal shape of a GitHub issue we read. */
interface GitHubIssue {
  number: number;
  title: string;
  labels: { name: string }[];
  /** Present when the "issue" is actually a pull request. */
  pull_request?: unknown;
}

/** Map GitHub labels to a goal kind. */
function kindForLabels(labels: { name: string }[]): GoalKind {
  const names = labels.map((label) => label.name.toLowerCase());
  if (names.includes("bug")) return "bug";
  if (names.includes("enhancement") || names.includes("feature")) return "feature";
  return "improvement";
}

/**
 * GitHubIssueProvider surfaces open GitHub issues as goal candidates.
 *
 * It is read-only and synchronous: issues are fetched once by
 * loadGitHubProvider and mapped to candidates here, so it satisfies the
 * existing synchronous GoalProvider interface without changing it.
 */
export class GitHubIssueProvider implements GoalProvider {
  readonly name = "github";

  constructor(
    private readonly issues: GitHubIssue[],
    readonly repository: string,
  ) {}

  discover(): GoalCandidate[] {
    return this.issues.map((issue) => ({
      id: `gh-${issue.number}`,
      title: issue.title,
      kind: kindForLabels(issue.labels),
    }));
  }
}

/**
 * Read open issues from a repository and build a GitHubIssueProvider.
 *
 * Configuration comes from the environment:
 *   GITHUB_TOKEN - a personal access token (read scope is enough)
 *   GITHUB_REPO  - "owner/name"
 *
 * Returns null when not configured or when the read fails, so callers
 * can fall back to the in-memory providers. Read-only: it never writes,
 * opens PRs or commits, and pull requests are filtered out.
 */
export async function loadGitHubProvider(): Promise<GitHubIssueProvider | null> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "tedos-engine",
        },
      },
    );

    if (!res.ok) {
      console.warn(`GitHub read failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const raw = (await res.json()) as GitHubIssue[];
    // GitHub returns PRs as issues; drop anything with a pull_request field.
    const issues = raw.filter((issue) => !issue.pull_request);
    return new GitHubIssueProvider(issues, repo);
  } catch (err) {
    console.warn(`GitHub read error: ${String(err)}`);
    return null;
  }
}
