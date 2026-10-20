import type { ErrorName } from './types.js';

export type ActionState =
  | 'PROPOSED'
  | 'VALIDATED'
  | 'AUTHORIZED'
  | 'EXECUTED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'UNKNOWN'
  | 'MISMATCH';

export type ActionEvent =
  | { type: 'POLICY_OK' }
  | { type: 'SIMULATE_OK' }
  | { type: 'MINED' }
  | { type: 'POST_READ_OK' }
  | { type: 'REJECT'; error: ErrorName }
  | { type: 'REVERTED'; error: ErrorName | 'Unknown' }
  | { type: 'UNKNOWN' }
  | { type: 'RECONCILED'; mined: boolean }
  | { type: 'MISMATCH' };

export type RunState =
  | 'IDLE'
  | 'OBSERVING'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'COMPLETED_PARTIAL'
  | 'REPLANNING'
  | 'HALTED_NEEDS_OWNER'
  | 'ABORTED';

export type RunEvent =
  | { type: 'OBSERVE' }
  | { type: 'PLAN' }
  | { type: 'PLAN_READY'; approvalRequired?: boolean }
  | { type: 'APPROVE' }
  | { type: 'EXECUTION_DONE' }
  | { type: 'VERIFY_OK' }
  | { type: 'VERIFY_PARTIAL' }
  | { type: 'REPLAN' }
  | { type: 'HALT' }
  | { type: 'ABORT' }
  | { type: 'OWNER_CONTINUE' }
  | { type: 'OWNER_MANDATE' };

export const MAX_REPLANS = 3;

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
}

export class ReplanLimitExceeded extends Error {
  override name = 'ReplanLimitExceeded';
}

export function transitionAction(state: ActionState, event: ActionEvent): ActionState {
  switch (event.type) {
    case 'POLICY_OK':
      if (state === 'PROPOSED') return 'VALIDATED';
      break;
    case 'SIMULATE_OK':
      if (state === 'VALIDATED') return 'AUTHORIZED';
      break;
    case 'MINED':
      if (state === 'AUTHORIZED') return 'EXECUTED';
      break;
    case 'POST_READ_OK':
      if (state === 'EXECUTED') return 'VERIFIED';
      break;
    case 'REJECT':
      if (state === 'PROPOSED' || state === 'VALIDATED' || state === 'AUTHORIZED') return 'REJECTED';
      break;
    case 'REVERTED':
      if (state === 'AUTHORIZED') return 'REJECTED';
      break;
    case 'UNKNOWN':
      if (state === 'AUTHORIZED') return 'UNKNOWN';
      break;
    case 'RECONCILED':
      if (state === 'UNKNOWN') return event.mined ? 'EXECUTED' : 'REJECTED';
      break;
    case 'MISMATCH':
      if (state === 'EXECUTED') return 'MISMATCH';
      break;
  }
  throw new InvalidTransitionError(`invalid action transition ${state} -> ${event.type}`);
}

const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set([
  'COMPLETED',
  'COMPLETED_PARTIAL',
  'ABORTED',
]);

export function transitionRun(
  state: RunState,
  event: RunEvent,
  context: { replans: number },
): { state: RunState; replans: number } {
  if (TERMINAL_RUN_STATES.has(state)) {
    throw new InvalidTransitionError(`run is terminal (${state}); cannot handle ${event.type}`);
  }
  if (state === 'HALTED_NEEDS_OWNER') {
    if (event.type === 'ABORT') return { state: 'ABORTED', replans: context.replans };
    if (event.type === 'OWNER_CONTINUE' || event.type === 'OWNER_MANDATE') {
      return { state: 'PLANNING', replans: context.replans };
    }
    throw new InvalidTransitionError('owner action required to leave HALTED_NEEDS_OWNER');
  }
  if (event.type === 'ABORT') return { state: 'ABORTED', replans: context.replans };

  switch (event.type) {
    case 'OBSERVE':
      if (state === 'IDLE') return { state: 'OBSERVING', replans: context.replans };
      break;
    case 'PLAN':
      if (state === 'OBSERVING' || state === 'REPLANNING') {
        return { state: 'PLANNING', replans: context.replans };
      }
      break;
    case 'PLAN_READY':
      if (state === 'PLANNING') {
        return {
          state: event.approvalRequired === true ? 'AWAITING_APPROVAL' : 'EXECUTING',
          replans: context.replans,
        };
      }
      break;
    case 'APPROVE':
      if (state === 'AWAITING_APPROVAL') return { state: 'EXECUTING', replans: context.replans };
      break;
    case 'EXECUTION_DONE':
      if (state === 'EXECUTING') return { state: 'VERIFYING', replans: context.replans };
      break;
    case 'VERIFY_OK':
      if (state === 'VERIFYING') return { state: 'COMPLETED', replans: context.replans };
      break;
    case 'VERIFY_PARTIAL':
      if (state === 'VERIFYING') return { state: 'COMPLETED_PARTIAL', replans: context.replans };
      break;
    case 'REPLAN':
      if (state === 'VERIFYING') {
        if (context.replans >= MAX_REPLANS) {
          throw new ReplanLimitExceeded(`replan limit ${MAX_REPLANS} reached`);
        }
        return { state: 'REPLANNING', replans: context.replans + 1 };
      }
      break;
    case 'HALT':
      if (state === 'PLANNING' || state === 'EXECUTING') {
        return { state: 'HALTED_NEEDS_OWNER', replans: context.replans };
      }
      break;
    case 'OWNER_CONTINUE':
    case 'OWNER_MANDATE':
      throw new InvalidTransitionError('owner action is only valid from HALTED_NEEDS_OWNER');
  }
  throw new InvalidTransitionError(`invalid run transition ${state} -> ${event.type}`);
}
