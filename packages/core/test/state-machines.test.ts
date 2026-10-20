import { describe, expect, test } from 'vitest';

import {
  MAX_REPLANS,
  transitionAction,
  transitionRun,
  type ActionEvent,
  type ActionState,
  type RunEvent,
  type RunState,
} from '../src/index.js';

describe('action machine', () => {
  test('walks the happy path to VERIFIED', () => {
    const path: ActionEvent[] = [
      { type: 'POLICY_OK' },
      { type: 'SIMULATE_OK' },
      { type: 'MINED' },
      { type: 'POST_READ_OK' },
    ];
    const expected: ActionState[] = ['VALIDATED', 'AUTHORIZED', 'EXECUTED', 'VERIFIED'];
    let state: ActionState = 'PROPOSED';
    path.forEach((event, index) => {
      state = transitionAction(state, event);
      expect(state).toBe(expected[index]);
    });
  });

  test('records a rejection without spend and permits no later event', () => {
    const rejected = transitionAction('VALIDATED', { type: 'REJECT', error: 'BudgetExceeded' });
    expect(rejected).toBe('REJECTED');
    expect(() => transitionAction(rejected, { type: 'MINED' })).toThrow(/invalid action transition/i);
  });

  test('reconciles UNKNOWN as either executed or rejected', () => {
    expect(transitionAction('AUTHORIZED', { type: 'UNKNOWN' })).toBe('UNKNOWN');
    expect(transitionAction('UNKNOWN', { type: 'RECONCILED', mined: true })).toBe('EXECUTED');
    expect(transitionAction('UNKNOWN', { type: 'RECONCILED', mined: false })).toBe('REJECTED');
  });

  test('routes a post-read mismatch to MISMATCH', () => {
    expect(transitionAction('EXECUTED', { type: 'MISMATCH' })).toBe('MISMATCH');
  });

  test('rejects illegal jumps such as PROPOSED -> MINED', () => {
    expect(() => transitionAction('PROPOSED', { type: 'MINED' })).toThrow(/invalid action transition/i);
  });
});

describe('run machine', () => {
  function apply(state: RunState, event: RunEvent, replans = 0): { state: RunState; replans: number } {
    return transitionRun(state, event, { replans });
  }

  test('walks observe -> plan -> approval -> execute -> verify', () => {
    let state: RunState = 'IDLE';
    let replans = 0;
    for (const event of [
      { type: 'OBSERVE' },
      { type: 'PLAN' },
      { type: 'PLAN_READY', approvalRequired: true },
      { type: 'APPROVE' },
      { type: 'EXECUTION_DONE' },
      { type: 'VERIFY_OK' },
    ] satisfies RunEvent[]) {
      const result = apply(state, event, replans);
      state = result.state;
      replans = result.replans;
    }
    expect(state).toBe('COMPLETED');
  });

  test('supports partial completion and budget-exhausted replanning', () => {
    let state: RunState = 'VERIFYING';
    let result = apply(state, { type: 'REPLAN' }, 0);
    state = result.state;
    expect(state).toBe('REPLANNING');
    expect(result.replans).toBe(1);
    state = apply(state, { type: 'PLAN' }, result.replans).state;
    state = apply(state, { type: 'PLAN_READY' }, result.replans).state;
    state = apply(state, { type: 'EXECUTION_DONE' }, result.replans).state;
    state = apply(state, { type: 'VERIFY_PARTIAL' }, result.replans).state;
    expect(state).toBe('COMPLETED_PARTIAL');
  });

  test('enforces the three-replan cap', () => {
    expect(MAX_REPLANS).toBe(3);
    expect(() => transitionRun('VERIFYING', { type: 'REPLAN' }, { replans: 3 })).toThrow(/replan limit/i);
  });

  test('nothing leaves HALTED_NEEDS_OWNER except an owner action', () => {
    expect(transitionRun('PLANNING', { type: 'HALT' }, { replans: 0 }).state).toBe('HALTED_NEEDS_OWNER');
    expect(() => transitionRun('HALTED_NEEDS_OWNER', { type: 'EXECUTION_DONE' }, { replans: 0 })).toThrow(/owner/i);
    expect(transitionRun('HALTED_NEEDS_OWNER', { type: 'OWNER_CONTINUE' }, { replans: 1 }).state).toBe('PLANNING');
  });

  test('kill switch aborts from an active state and terminal states stay closed', () => {
    expect(transitionRun('EXECUTING', { type: 'ABORT' }, { replans: 0 }).state).toBe('ABORTED');
    expect(() => transitionRun('COMPLETED', { type: 'REPLAN' }, { replans: 0 })).toThrow(/terminal/i);
  });
});
