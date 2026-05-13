export class TurnRunner {
  constructor({ maxTurns = 15 } = {}) {
    this.maxTurns = maxTurns;
    this.turn = 0;
  }

  next(signal) {
    this.turn += 1;
    return {
      turn: this.turn,
      exceeded: this.turn > this.maxTurns,
      aborted: !!signal?.aborted,
    };
  }

  canContinue() {
    return this.turn < this.maxTurns;
  }
}

export function turnRunnerSnapshot(runner) {
  return {
    turn: runner?.turn || 0,
    maxTurns: runner?.maxTurns || 0,
    remaining: Math.max(0, (runner?.maxTurns || 0) - (runner?.turn || 0)),
  };
}
