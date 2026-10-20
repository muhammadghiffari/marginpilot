import { HaltReasonSchema } from '@marginpilot/core';
import { z } from 'zod';

import type { LlmToolDefinition } from './llm/client.js';

/** The closed tool set. There is deliberately no mandate, key or free-form call tool. */
export const TOOL_NAMES = [
  'get_state',
  'get_run_history',
  'compile_mandate',
  'plan_rescue',
  'explain_plan',
  'execute_plan_action',
  'pause_vault',
  'halt_and_ask_owner',
  'finish_run',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const EmptyArgs = z.object({}).strict();

export const TOOL_ARG_SCHEMAS: Record<ToolName, z.ZodTypeAny> = {
  get_state: EmptyArgs,
  get_run_history: EmptyArgs,
  compile_mandate: z.object({ text: z.string().min(1).max(4_000) }).strict(),
  plan_rescue: EmptyArgs,
  explain_plan: z.object({ planId: z.string().min(1).max(200) }).strict(),
  execute_plan_action: z
    .object({
      planId: z.string().min(1).max(200),
      index: z.number().int().min(0).max(255),
    })
    .strict(),
  pause_vault: z.object({ reason: z.string().min(1).max(300) }).strict(),
  halt_and_ask_owner: z.object({ reason: HaltReasonSchema }).strict(),
  finish_run: EmptyArgs,
};

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_DEFINITIONS: readonly LlmToolDefinition[] = [
  {
    name: 'get_state',
    description:
      'Read the mandate, vault, positions, prices, block and spend. All numbers come from the chain port.',
    parameters: object({}),
  },
  {
    name: 'get_run_history',
    description: 'Read this run ledger and audit entries. Use it to avoid repeating actions.',
    parameters: object({}),
  },
  {
    name: 'compile_mandate',
    description:
      'Compile user text into a non-authoritative mandate draft. It cannot sign or activate the mandate.',
    parameters: object({ text: { type: 'string', maxLength: 4000 } }, ['text']),
  },
  {
    name: 'plan_rescue',
    description:
      'Compute a rescue plan from fresh state. Replanning is allowed only within MAX_REPLANS and uses remaining budget.',
    parameters: object({}),
  },
  {
    name: 'explain_plan',
    description: 'Return the deterministic template explanation of the current plan.',
    parameters: object({ planId: { type: 'string' } }, ['planId']),
  },
  {
    name: 'execute_plan_action',
    description:
      'Simulate then submit one action from the current plan, in order. Never bypasses plan or policy checks.',
    parameters: object({ planId: { type: 'string' }, index: { type: 'integer', minimum: 0 } }, [
      'planId',
      'index',
    ]),
  },
  {
    name: 'pause_vault',
    description: 'Kill switch: pause the vault immediately and stop the run.',
    parameters: object({ reason: { type: 'string', maxLength: 300 } }, ['reason']),
  },
  {
    name: 'halt_and_ask_owner',
    description: 'Stop and require an owner decision. Do not guess or retry an unknown state.',
    parameters: object(
      {
        reason: {
          type: 'object',
          description: 'HaltReason: BUDGET_INSUFFICIENT, STALE_OR_CONFLICTING_DATA, MANDATE_INVALID, PAUSED or NEEDS_OWNER_DECISION',
        },
      },
      ['reason'],
    ),
  },
  {
    name: 'finish_run',
    description: 'Finish the run and produce the grounded report from chain state and the ledger.',
    parameters: object({}),
  },
];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}
