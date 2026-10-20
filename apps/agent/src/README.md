# apps/agent/src

**Purpose:** Node 22 server: LLM layer (`LlmClient`, provider, `ScriptedLlm`), `compile_mandate`, tool set, orchestrator run loop, `ViemChainPort`, HTTP API + SSE, session notes.
**Owner:** Dev B
**Tasks:** B-07, B-08, B-09, B-10, B-13, B-14, B-17 (P2)
**Spec:** `docs/spec/AGENT-DESIGN.md`, `docs/spec/INTERFACES.md` §4, §10, `docs/spec/ARCHITECTURE.md`.

B-07 is implemented as a lean, deterministic slice: `llm/client.ts`, `llm/scripted.ts`, `llm/provider.ts`, `prompts.ts`, `mandate/registry.ts`, `mandate/compile.ts`. The seed prompts m01–m12 run with `ScriptedLlm`; the live provider is a **typed stub** that throws `LLM provider is not configured` when `LLM_PROVIDER`/`LLM_MODEL` are empty. No network provider is shipped in P0 and no key is read, logged or placed in a prompt.

Keys never appear in prompts, tool results or logs. See `docs/spec/AGENT-DESIGN.md` §4, §5, §8 and `docs/spec/REPO-MAP.md`.
