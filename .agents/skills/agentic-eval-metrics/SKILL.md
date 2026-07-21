---
name: agentic-eval-metrics
description: Enterprise Agentic AI Evaluation metrics and benchmarks for testing tool execution, state memory, and Agentic RAG in Octane.
---

# Agentic Evaluation Metrics

When modifying the Agentic Core (`deepagents`, `langgraph`, orchestrators) or writing evaluations in `evalLive.ts`, you **MUST** adhere to these enterprise-level metrics to ensure the stability and robustness of the system. 

Our system uses a multi-agent hierarchy (`src/modules/agents/orchestrator.ts`) backed by LangChain/LangGraph checkpointers for state. Standard pass/fail text evaluations are insufficient. You must evaluate the **Execution Trajectory**.

## 1. Tool Use & Execution (Gorilla LLM & ToolBench Standard)

When evaluating tools (especially Composio or Zoho tools):
- **AST-Based Argument Accuracy:** Do not just assert that a tool like `zoho_crm.query` was called. You must assert that the exact JSON structure of the arguments matches the Abstract Syntax Tree (AST) required by the target API.
- **API Resolution Rate:** Monitor if the tool call returns a 4xx/5xx HTTP error. A tool call is only successful if the underlying system (e.g., Composio gateway) resolves it successfully.
- **Tool Hallucination Rate:** Track instances where the agent attempts to call a tool it does not have (enforced by `AgentTools` schema) or fabricates arguments.

## 2. Agentic Memory & State (MemGPT Standard)

We use `@langchain/langgraph-checkpoint-postgres` for persistent memory. When modifying memory retrieval or statefulness:
- **Context Paging Efficiency:** Do not dump the entire database into the prompt. The system must page information intelligently. Evaluate if the prompt token size remains stable across multi-turn interactions while still answering the user.
- **State Recall Precision:** If a user says "that carrier from yesterday", the checkpointer must accurately retrieve the entity from the persistent DB and inject it. You must write evaluations that test this explicit multi-turn recall.

## 3. Agentic RAG

We use `scopedRagTool`.
- **Faithfulness (Groundedness):** Ensure that every factual claim made by the subagent (e.g., Customer Service) is directly found in the chunks retrieved by the `scopedRagTool`. 
- **Retrieval Decision Rate:** The agent must autonomously decide to call the RAG tool. Test scenarios where the agent *should* call the tool (because the data is proprietary) vs. scenarios where it *should not* (because the query is generic).

## 4. Orchestration & Coordination

We use a Parent Orchestrator -> Subagent model.
- **Ping-Pong Rate (Handoff Efficiency):** Track `agentPath` in `evalLive.ts`. A trajectory of `[Orchestrator -> Sales -> Billing -> Sales]` indicates a ping-pong deadlock. The orchestrator must route correctly on the first or second try.
- **Time To First Token (TTFT):** Track `durationMs`. We use Groq (`gpt-oss-*`) for rapid tool iterations to keep TTFT low. If a modification causes tool loops to exceed 5-10 seconds, the modification must be optimized.

## Implementation Guidelines
When asked to evaluate or modify agents:
1. Always run `pnpm eval:live` after making changes to the orchestrator.
2. If adding a new agent, ensure it has explicit "handoff summary" rules in its persona to prevent ping-ponging with the Orchestrator.
3. Treat the LangGraph trajectory as the primary source of truth for all metrics.
