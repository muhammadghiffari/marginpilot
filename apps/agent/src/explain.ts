import type { Mandate, Plan, VaultSnapshot } from '@marginpilot/core';

const USD8 = 100_000_000n;

function formatUsd8(value: bigint): string {
  const whole = value / USD8;
  const fraction = (value % USD8).toString().padStart(8, '0').slice(0, 2);
  return `$${whole.toString()}.${fraction}`;
}

function formatHf(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').slice(0, 4);
  return `${whole.toString()}.${fraction}`;
}

function levelReason(level: string): string {
  if (level === 'safe-now') return 'restore HF above the safe-now threshold';
  if (level === 'safe-stress') return 'survive the configured stress drop';
  if (level === 'target') return 'reach the target HF buffer';
  if (level === 'partial-target') return 'use the remaining budget toward the target';
  return 'no action';
}

/**
 * Template-only explanation. Every number comes from the Plan's RationaleFacts or
 * the vault/mandate; no model prose is interpolated here.
 */
export function explainPlan(plan: Plan, mandate: Mandate, vault: VaultSnapshot): string {
  const remaining = mandate.maxTotalSpendUsd > vault.spentUsd8 ? mandate.maxTotalSpendUsd - vault.spentUsd8 : 0n;
  const lines: string[] = [
    `Plan ${plan.planId} v${plan.version}, based on block ${plan.basedOnBlock.toString()}.`,
    `Planned spend ${formatUsd8(plan.totalSpendUsd8)}; remaining budget before this plan ${formatUsd8(remaining)}.`,
    'Actions:',
  ];

  if (plan.actions.length === 0) {
    lines.push('- none (the plan has no executable action).');
  } else {
    for (const entry of plan.actions) {
      const { action, rationale } = entry;
      lines.push(
        `- pool ${rationale.poolId}: ${action.actionType} ${action.amount.toString()} raw units of ${action.tokenIn}; ` +
          `HF ${formatHf(rationale.hfBefore)} -> ${formatHf(rationale.hfAfterExpected)}; ` +
          `spend ${formatUsd8(rationale.spendUsd8)}; why: ${levelReason(rationale.levelName)}.`,
      );
    }
  }

  const unsaved = plan.unsavedPools.length === 0 ? 'none' : plan.unsavedPools.join(', ');
  lines.push(`Not done: pools ${unsaved}; reason: remaining budget or plan limits.`);
  if (plan.haltReason) {
    lines.push(`Halt: ${JSON.stringify(plan.haltReason)}.`);
  }
  lines.push('The mandate and the vault policy checks remain the authority; this is not a guarantee.');
  return lines.join('\n');
}
