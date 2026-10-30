---
description: "Implement AGENT: and AGENTS: comment blocks in supplied files; remove finished blocks and retain unfinished ones"
argument-hint: "<file> [file ...]"
---

# Implement comment blocks

## Input

Implement the marked comment blocks in these user-supplied files:

$ARGUMENTS

Accept one or more file names or paths from the arguments above. Resolve relative paths against the current working directory, not this prompt template's directory. Support paths containing spaces. If no files are supplied, a path cannot be resolved uniquely, or the file list is ambiguous, ask the user to clarify before proceeding. Do not silently substitute files.

## Workflow

1. Read applicable project instructions and respect them throughout the task.
2. Read every supplied file completely, paging as needed, before editing. Locate actual comments whose content starts with the exact, case-sensitive marker `AGENT:` or `AGENTS:` after ignoring leading whitespace and the language's comment delimiters/decorations (such as `//`, `/*`, `*`, `--`, or `#`). Recognize both multiline comments and consecutive line-comment blocks. The marker may be on the opening line or the first nonempty content line. Treat the full marked block, including continuation lines, as the implementation request. Ignore markers inside string literals and comments that merely mention a marker later in their text.
3. Inventory all matching blocks in the supplied files, noting their paths, line numbers, and requested behavior. If none are found, report that and do not make unrelated changes.
4. Inspect surrounding code and relevant implementations, callers, interfaces, and dependencies to understand the requested changes. Blocks in the supplied files define the task scope; do not automatically implement additional marked blocks discovered in other files.
5. Ask the user whenever a requirement, intended behavior, scope, or implementation decision is ambiguous or conflicts with another block or applicable instructions. Group related questions when possible. Do not guess or silently choose an interpretation; wait for clarification before making affected changes.
6. Implement every clarified request using focused changes consistent with the project. You may read and modify files other than the supplied files when necessary to complete the requested implementation, including shared interfaces or call sites. Avoid unrelated refactoring, speculative changes, and overwriting pre-existing user work. Obtain any approvals required by applicable instructions, including approval for configuration changes where required.
7. Review the implementation against every inventoried block and check for omissions and unintended edits. If a requested change already exists, verify it by inspection rather than duplicating it. Follow applicable rules for tests, builds, and validation; this prompt does not itself authorize running tests, compilers, or builds that require explicit user permission. Do not delegate unless independently authorized by the user or applicable instructions. Do not claim validation that was not performed.
8. Remove each finished marked comment block after confirming that all of its requirements are satisfied, including blocks whose requests were already satisfied and verified by inspection. Delete the full instruction block, including its marker and continuation lines, while preserving surrounding code and unrelated comments. Keep failed, partially implemented, unresolved, blocked, or unverified blocks intact, including their original markers and instructions; do not remove only the completed portions of a partially implemented block. If completion is uncertain, keep the block and explain the uncertainty. Respect any explicit user or applicable instruction requiring a finished block to be retained. Review the final changes to ensure only finished blocks were removed and no code or unrelated comments were accidentally deleted.
9. Summarize what was implemented, list modified file paths (including files outside the input list), and identify which blocks were removed and which were retained, with reasons for retention. Include any already-satisfied, unresolved, or blocked requests, using the original inventory to identify removed blocks. State what validation was actually performed, and what was not run.
