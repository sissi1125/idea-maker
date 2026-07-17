/** Confirmed Product Brief 注入：事实裁决层，不接受 auto-generation 派生摘要。 */
import { definePrompt } from "../types";
import type { AgentGroundingContext } from "../../grounding/agent-grounding.types";
import { formatAgentGroundingContext } from "../../grounding/agent-grounding-format";

export interface BriefGroundingInjectionInput {
  grounding: AgentGroundingContext;
}

export const briefGroundingInjectionPrompt = definePrompt<BriefGroundingInjectionInput>({
  id: "agent.brief-grounding-injection",
  version: "v1",
  description: "注入 Confirmed Product Brief、Approved Claims 与 RAG evidence",
  render: ({ grounding }) => `\n\n${formatAgentGroundingContext(grounding)}`,
});
