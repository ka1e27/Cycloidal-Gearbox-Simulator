// Message protocol between the UI thread and the calc Web Worker.

import type { AdvisorOptions, AdvisorProgress, AdvisorResult } from './advisor';
import type { FixOptions, FixProgress, FixReport } from './fixes';
import type { SolverOptions, SolverProgress, SolverResult } from './solver';
import type { StatisticalFit, ToleranceOptions, ToleranceProgress, ToleranceResult } from './tolerance';
import type { ToleranceSpec } from './types';
import type { GearboxInputs } from './types';

export type WorkerRequest =
  | { type: 'solve'; id: number; inputs: GearboxInputs; options?: SolverOptions }
  | { type: 'advise'; id: number; inputs: GearboxInputs; options?: AdvisorOptions }
  | { type: 'fixes'; id: number; inputs: GearboxInputs; options?: FixOptions }
  | { type: 'tolerance'; id: number; inputs: GearboxInputs; options?: ToleranceOptions }
  | { type: 'statFit'; id: number; inputs: GearboxInputs; spec: ToleranceSpec }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; kind: 'solve'; progress: SolverProgress }
  | { type: 'progress'; id: number; kind: 'advise'; progress: AdvisorProgress }
  | { type: 'progress'; id: number; kind: 'fixes'; progress: FixProgress }
  | { type: 'progress'; id: number; kind: 'tolerance'; progress: ToleranceProgress }
  | { type: 'result'; id: number; kind: 'solve'; result: SolverResult }
  | { type: 'result'; id: number; kind: 'advise'; result: AdvisorResult }
  | { type: 'result'; id: number; kind: 'fixes'; result: FixReport }
  | { type: 'result'; id: number; kind: 'tolerance'; result: ToleranceResult }
  | { type: 'result'; id: number; kind: 'statFit'; result: StatisticalFit }
  | { type: 'error'; id: number; message: string };
