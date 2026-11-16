---
name: gdbox-team
description: Runs a GDBox game-studio team from this client. This session is the producer, gdbox-member subagents are the teammates and a gdbox-acceptor subagent tests the result, while GDBox keeps the roster, task board, mail, file locks, snapshots and acceptance record. All thinking runs on this client's model; GDBox runs none. Use when the user asks to build a whole game or MVP with a team through GDBox, says things like "用团队模式做"、"让 GDBox 的团队来做"、"开一个工作室把这个游戏做出来", or wants to resume a GDBox team by id. Do not use for a single change to a Godot project (use the gdbox skill or GDBox tools directly), or when GDBox is not running.
---

# GDBox studio team, with this client as the brain

GDBox is the studio and you are the producer. Teammates are subagents you start. GDBox keeps
the shared state and enforces the rules: who may write, file locks, snapshots, and the
acceptance record.

## Quick Start

1. Check the setup once:
   - Run `gdbox --version`. If it fails, tell the user to install the GDBox CLI.
   - The `GDBOX_TOKEN` environment variable must be set. Teammate subagents connect with it.
     If it is not set, stop and point the user to "Setup" in this plugin's README.
   - This session must have GDBox's MCP server. Its tools include `team_open`.
2. Call `team_open` with `objective` (the user's request, in their words). Read the producer
   brief it returns: it is the real rulebook for this team. Put the `team_seat` it gives you
   in the arguments of every later GDBox call, and never hand it to a subagent.
3. In your working directory, run `gdbox team use <team id>`. The delivery hook uses it to find
   the team.

## Workflow

- Hire with `team_hire`: a name, a role you write, and optionally a tool scope or read-only.
- Give a teammate work: start a `gdbox-member` subagent. The prompt has three lines:
  `team_id: <id>`, `member: <name>`, `assignment: <what to do, with all the context it needs>`.
  Independent assignments can run as parallel subagents.
- Once the project folder has `project.godot`, call `team_open` with `team_id` and
  `project_path` so snapshots and teammates' tools target it.
- Between assignments: `team_status` shows the real state, `team_inbox` shows notes addressed
  to you, and `team_board` is the shared plan.
- To deliver, start a `gdbox-acceptor` subagent with `team_id`, `report` (what was built, known
  gaps) and `how_to_play`. On FAIL, assign fixes and run acceptance again. On BLOCKED, stop and
  tell the user what is needed.
- To resume another day, call `team_list`, then `team_open` with `team_id`.

## Constraints

- Do not change the project yourself, either with GDBox write tools (GDBox refuses them on your
  connection) or with this client's own file tools. Unrecorded changes skip the locks and
  snapshots.
- `task` is not available to the team: it would run GDBox's own model.
- Any change after a PASS voids it. The delivery hook keeps you working until acceptance passes,
  at most twice per user message.

## Failure Handling

- `team_join` fails inside a subagent: the subagent stops and returns the error. Usually the
  name does not match `team_hire`, or the team id is wrong.
- A teammate reports a lock conflict: another teammate holds that file. Sequence the work, or
  have them message each other.
- A subagent ends without `team_report`: GDBox records that job as stopped. Check
  `team_status` before you reassign it.

## Escalation

Stop and ask the user when acceptance returns BLOCKED, when the objective is ambiguous about
which project to build in, or when a step would spend money (paid generation) beyond what the
user asked for.
