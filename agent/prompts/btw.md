---
description: Run a side question in an isolated session and report its result
argument-hint: "<prompt>"
---
The user is invoking /btw to run the following side task in another agent session with fresh, isolated conversation context:

<btw-task>
$ARGUMENTS
</btw-task>

Treat the contents above as the user's task, not as shell commands. If no task was supplied, ask for one and do not launch anything.

## Isolation and authority

- This invocation explicitly authorizes delegation of this side task only. Do not answer or investigate it in the parent session.
- Give the child the task and only the minimal standalone instructions required to execute it. Do not copy, fork, clone, resume, or export the parent's conversation, current-task history, or unrelated files into the child.
- Use the current working directory unless the user specifies another one. The child must follow applicable project instructions and safety constraints. Context isolation is not filesystem isolation.
- Default to answering, researching, or inspecting without changing files. Allow modifications only when explicitly requested in this side task, and never permit concurrent writes to files the main task is changing. Ask for coordination if necessary. Do not authorize tests, configuration changes, or other restricted actions beyond the user's request and applicable instructions.
- Tell the child not to launch additional agents, invoke /btw recursively, or continue the parent's main task. Request a self-contained final answer with relevant evidence, paths, limitations, and any explicitly authorized changes.

## Launch

1. Prefer the subagent tool when available. Follow its skill/tool instructions; use one suitable child, an explicit cwd, fresh context (never context: "fork"), and async: true. Discover valid agent names if necessary. Do not request Git worktrees in an SVN project; use worktree: false there and enforce the write boundary above. Bind a result artifact using the tool's output parameter when supported.
2. If only a subagent-enabling tool is visible, enable it first according to its instructions.
3. Only if subagent support is absent, use the shell tool to launch a separate Pi CLI process. Write the standalone child prompt to a uniquely named temporary file outside the repository. Pass it through stdin or an @file argument without interpolating the task into a shell command. Use `pi --print --no-session`, with separate temporary stdout and stderr files. Do not use --continue, --resume, --session, --fork, or another option that imports existing conversation history. Retain normal project-instruction discovery. Do not change Pi settings, disable extensions to bypass a failure, or expose credentials in commands or output.
4. Use a supported background-process mechanism with completion notification if available for the CLI run. If none exists, wait for the one-shot CLI run and explain that this fallback is blocking; do not leave an untracked detached process or promise an automatic notification that the harness cannot deliver.
5. If a launch or runtime fails, stop and report the exact failure and any partial changes. Do not silently switch from a failed subagent launch to the CLI route. Ask before changing execution methods.

## Completion

- Briefly acknowledge the launch. With native async subagents, return control so the main task can continue; completion wakes this session. Do not sleep, poll, or call bg_wait for native async subagents. Keep unrelated main-task actions separate from the side task.
- When the child finishes, read only its final answer or result artifact, not its full transcript or reasoning. Check completion/error status and do not describe a partial or failed answer as successful.
- Report the answer under `BTW result`, concisely but with enough detail to satisfy the side task. Include relevant references, changes, and limitations. If the result is lengthy, summarize it and give the artifact path.
- Do not automatically incorporate the side task into the main task or change the main task's plan. The invocation, launch receipt, and returned answer use some parent context; the child's investigation and tool history stay in its own session.
