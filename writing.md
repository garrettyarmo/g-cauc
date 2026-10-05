# Writing for people

Garrett reads what the agents write, and he must understand the state of the work at all times. Thus, all the text that a person reads is in Simplified Technical English (STE). STE is the controlled language of aircraft manuals, from the specification ASD-STE100. Garrett asked for STE on 2026-10-04, after he could not follow the work from the PRs, the reviews, and the board.

The full rules and the check tool are in `vendor/simplified-technical-english/`. That copy comes from https://github.com/0xpili/simplified-technical-english at commit 1e148d6. This file gives the part of STE that g-cauc uses. This file is in STE.

## Which text

Use STE for:

- Every message to Garrett in a chat session, in each project. This includes a status report, a question, and a list of tasks for him.
- Specs, spec PR bodies, and replies on spec PRs
- Build PR bodies, `AK_PR.md`, and `AK_FIX.md`
- Review verdicts from the CTO review and the agent review
- Comments for Garrett: the `needs:garrett` comment, the note for an agreed spec, and the daily digest
- The body of a commit message
- Project documents: README files and the files in `docs/`

Do not use STE for:

- Code, identifiers, commands, file paths, logs, and quoted error text
- Labels, status words, and table headings
- The thoughts of an agent that no person reads

## The rules

1. Write one topic in each sentence. Write one instruction in each step.
2. An instruction has maximum 20 words. A description has maximum 25 words.
3. A paragraph has maximum 6 sentences and one topic. For more items, use a list or a table.
4. Use the active voice. Write "the foreman starts a review", not "a review is started".
5. Use only "can", "must", and "will" as helping verbs. "Must" is a requirement. "Can" is a possibility. Do not write "should", "may", "might", or "would".
6. Do not use semicolons, contractions, or em dashes. Write two sentences.
7. Use the simple tenses. Write "Grok fixed the test", not "Grok has fixed the test" or "Grok is fixing the test".
8. Use one name for one item in all the text. If the issue says "slot", do not use "runner" for the same item.
9. Give the specific value: a number, a file, a command, or a time. Do not write "some", "a few", "soon", or "probably".
10. Put a condition before its command, with a comma: "If CI fails, start a fix round."

Use common words. The word list in `vendor/simplified-technical-english/references/word-list.md` is a guide, not a gate. Technical names are permitted, for example CI, PR, worktree, lane, and Grok. For a frequent replacement, refer to `references/substitutions.md` in the same folder.

If an STE sentence changes the meaning, keep the correct meaning. Correct text is more important than STE text.

## When you ask Garrett to do a task

Garrett does not do a task that he does not understand. Before you ask him to run a command, to change a setting, or to make a decision, give him these 4 items:

1. **What it is:** the thing, in words that do not need the code.
2. **Why it matters:** what goes wrong if he does not do it.
3. **What it changes:** what the step changes, and what it does not change. For a command, say what it reads, what it shows, and if it changes anything.
4. **What to send back:** the output or the answer that you need from him.

Example: "This command reads the secret on your Mac and shows only the lines that start with `INFERENCE_`. It does not show the passwords and it changes nothing. Send me the lines that it shows."

## The check

Write the text to a file before you post it. Do this also for a chat reply that asks Garrett to do a task or that is longer than 10 lines. Then run:

```bash
python3 ~/code/g-cauc/vendor/simplified-technical-english/scripts/ste_check.py --no-vocab --mode descriptive <file>
```

For text that gives instructions, use `--mode procedural`. Correct each `ERROR` line, then do the check again. Exit code 0 means that the text obeys the rules that the tool can find. The tool does not examine code, tables, headings, or quoted text.

## Reviews

Style is never a blocking finding. If a person cannot understand a sentence, a reviewer can give an advisory finding.
