/**
 * Exact competition scoring helpers (RULES.txt "Scoring"), used by the local
 * leave-one-comparable-out backtest. The graded entry itself never scores.
 */
import { LEVELS } from './config.ts';

/** One (case,hour,level) pinball item on the log scale. y is floored at 1 viewer. */
export function pinball(y: number, q: number, tau: number): number {
  const d = Math.log(Math.max(1, y)) - Math.log(Math.max(1e-12, q));
  return 2 * Math.max(tau * d, (tau - 1) * d);
}

export interface HourScore {
  hour: number;
  y: number;
  missPct: number;
  covered: boolean;
}

export interface CaseScore {
  id: string;
  loss: number;
  typicalMissPct: number;
  coverage90: number;
  hours: HourScore[];
}

/** Score one case's five quantiles against the actual prints for hours 2..24. */
export function scoreCase(id: string, qByHour: Map<number, number[]>, actualByHour: Map<number, number>): CaseScore {
  let lossSum = 0, n = 0, absLogSum = 0, coverSum = 0;
  const hours: HourScore[] = [];
  for (const [h, y] of [...actualByHour.entries()].sort((a, b) => a[0] - b[0])) {
    const q = qByHour.get(h);
    if (!q || q.length !== 5) continue;
    let covered = true;
    for (let i = 0; i < 5; i++) {
      lossSum += pinball(y, q[i], LEVELS[i]);
      n++;
    }
    if (q[0] > y || q[4] < y) covered = false;
    const med = q[2];
    absLogSum += Math.abs(Math.log(Math.max(1, y)) - Math.log(Math.max(1e-12, med)));
    coverSum += covered ? 1 : 0;
    hours.push({ hour: h, y, missPct: 100 * (Math.exp(Math.abs(Math.log(Math.max(1, y)) - Math.log(Math.max(1e-12, med)))) - 1), covered });
  }
  const H = hours.length || 1;
  return {
    id,
    loss: n ? lossSum / n : NaN,
    typicalMissPct: 100 * (Math.exp(absLogSum / H) - 1),
    coverage90: coverSum / H,
    hours,
  };
}

export function aggregate(scores: CaseScore[]): { loss: number; typicalMissPct: number; coverage90: number; nCases: number } {
  const all = scores.filter((s) => Number.isFinite(s.loss));
  const nItems = all.reduce((a, s) => a + s.hours.length * 5, 0);
  const loss = all.reduce((a, s) => a + s.loss * s.hours.length * 5, 0) / (nItems || 1);
  const H = all.reduce((a, s) => a + s.hours.length, 0) || 1;
  const logMiss = all.reduce((a, s) => {
    const m = s.hours.reduce((x, hh) => x + Math.log(1 + hh.missPct / 100), 0);
    return a + m;
  }, 0);
  const cover = all.reduce((a, s) => a + s.coverage90 * s.hours.length, 0) / H;
  return {
    loss,
    typicalMissPct: 100 * (Math.exp(logMiss / H) - 1),
    coverage90: cover,
    nCases: all.length,
  };
}
