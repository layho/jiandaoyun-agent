/**
 * runtime/dag.ts — V2 DAG (Directed Acyclic Graph) Runtime
 *
 * Executes compiled workflow plans in dependency order.
 * Determines which workflows can run in parallel and which
 * must wait for dependencies.
 *
 * Features:
 *   - Topological sorting
 *   - Parallel execution of independent nodes
 *   - Sequential execution of dependent nodes
 *   - Cycle detection
 *   - Failure isolation (one node failure doesn't cascade)
 */

import type { WorkflowCall, CompiledPlan } from './dsl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  nodeId: string;
  workflow: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface DAGResult {
  success: boolean;
  completed: number;
  failed: number;
  total: number;
  results: ExecutionResult[];
  startTime: number;
  endTime: number;
}

export type WorkflowExecutor = (
  workflow: string,
  params: Record<string, unknown>
) => Promise<{ success: boolean; error?: string }>;

// ---------------------------------------------------------------------------
// Graph utilities
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  call: WorkflowCall;
  indegree: number;
  dependents: string[];
}

/**
 * Build a dependency graph from workflow calls.
 */
function buildGraph(workflows: WorkflowCall[]): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();
  const idSet = new Set(workflows.map((w) => w.nodeId));

  // Initialize nodes
  for (const w of workflows) {
    graph.set(w.nodeId, {
      id: w.nodeId,
      call: w,
      indegree: 0,
      dependents: [],
    });
  }

  // Wire dependencies (nodeId → nodeId)
  for (const w of workflows) {
    const node = graph.get(w.nodeId)!;
    for (const depId of w.dependsOn) {
      if (idSet.has(depId)) {
        const depNode = graph.get(depId);
        if (depNode) {
          depNode.dependents.push(w.nodeId);
          node.indegree++;
        }
      }
    }
  }

  return graph;
}

/**
 * Detect cycles in the graph using DFS.
 */
function detectCycles(graph: Map<string, GraphNode>): string[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[] = [];

  for (const id of graph.keys()) {
    color.set(id, WHITE);
  }

  function dfs(nodeId: string, path: string[]): boolean {
    color.set(nodeId, GRAY);
    path.push(nodeId);

    const node = graph.get(nodeId)!;
    for (const depId of node.dependents) {
      const c = color.get(depId);
      if (c === GRAY) {
        const cycleStart = path.indexOf(depId);
        cycles.push(path.slice(cycleStart).join(' → ') + ' → ' + depId);
        return true;
      }
      if (c === WHITE && dfs(depId, [...path])) {
        return true;
      }
    }

    color.set(nodeId, BLACK);
    return false;
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id, []);
    }
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topologicalSort(graph: Map<string, GraphNode>): string[][] {
  const levels: string[][] = [];
  const indegree = new Map<string, number>();

  for (const [id, node] of graph) {
    indegree.set(id, node.indegree);
  }

  while (indegree.size > 0) {
    // Find all nodes with indegree 0
    const ready: string[] = [];
    for (const [id, degree] of indegree) {
      if (degree === 0) {
        ready.push(id);
      }
    }

    if (ready.length === 0) {
      throw new Error('[DAG] Cycle detected — cannot sort');
    }

    levels.push(ready);

    // Remove ready nodes and decrement their dependents
    for (const id of ready) {
      indegree.delete(id);
      const node = graph.get(id)!;
      for (const depId of node.dependents) {
        const d = indegree.get(depId);
        if (d !== undefined) {
          indegree.set(depId, d - 1);
        }
      }
    }
  }

  return levels;
}

// ---------------------------------------------------------------------------
// Execution engine
// ---------------------------------------------------------------------------

/**
 * Execute a compiled plan using the provided executor function.
 *
 * - Parallel execution within each topological level
 * - Sequential progression between levels
 * - Failure in one node does not abort sibling nodes
 */
export async function execute(
  plan: CompiledPlan,
  executor: WorkflowExecutor
): Promise<DAGResult> {
  console.log('[DAG] ======== execution start ========');
  console.log(`[DAG] ${plan.workflows.length} workflows to execute`);

  const startTime = Date.now();
  const results: ExecutionResult[] = [];

  try {
    // Build graph
    const graph = buildGraph(plan.workflows);

    // Check for cycles
    const cycles = detectCycles(graph);
    if (cycles.length > 0) {
      console.error(`[DAG] Cycles detected: ${cycles.join('; ')}`);
      return {
        success: false,
        completed: 0,
        failed: plan.workflows.length,
        total: plan.workflows.length,
        results: [],
        startTime,
        endTime: Date.now(),
      };
    }

    // Sort into levels
    const levels = topologicalSort(graph);
    console.log(`[DAG] ${levels.length} execution levels`);

    let completed = 0;
    let failed = 0;

    // Execute level by level
    for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
      const level = levels[levelIdx];
      console.log(`[DAG] executing level ${levelIdx + 1}/${levels.length}: ${level.length} nodes`);

      const levelPromises = level.map(async (nodeId) => {
        const node = graph.get(nodeId)!;
        const t0 = Date.now();

        try {
          console.log(`[DAG] → ${node.call.workflow} (${nodeId})`);
          const result = await executor(node.call.workflow, node.call.params);

          const duration = Date.now() - t0;
          const execResult: ExecutionResult = {
            nodeId,
            workflow: node.call.workflow,
            success: result.success,
            error: result.error,
            durationMs: duration,
          };

          if (result.success) {
            completed++;
            console.log(`[DAG] ✓ ${node.call.workflow} (${duration}ms)`);
          } else {
            failed++;
            console.warn(`[DAG] ✗ ${node.call.workflow} (${duration}ms): ${result.error}`);
          }

          return execResult;
        } catch (error) {
          failed++;
          const duration = Date.now() - t0;
          const message = error instanceof Error ? error.message : String(error);

          console.error(`[DAG] ✗ ${node.call.workflow} (${duration}ms): ${message}`);

          return {
            nodeId,
            workflow: node.call.workflow,
            success: false,
            error: message,
            durationMs: duration,
          };
        }
      });

      const levelResults = await Promise.all(levelPromises);
      results.push(...levelResults);
    }

    const endTime = Date.now();
    const allSuccess = failed === 0;

    console.log(
      `[DAG] ======== execution complete: ${completed} ok, ${failed} failed, ${plan.workflows.length} total ========`
    );

    return {
      success: allSuccess,
      completed,
      failed,
      total: plan.workflows.length,
      results,
      startTime,
      endTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DAG] execution error: ${message}`);

    return {
      success: false,
      completed: 0,
      failed: plan.workflows.length,
      total: plan.workflows.length,
      results,
      startTime,
      endTime: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Dry-run (validation only, no execution)
// ---------------------------------------------------------------------------

export interface DryRunResult {
  valid: boolean;
  levels: { level: number; workflows: { nodeId: string; workflow: string }[] }[];
  cyclesFound: string[];
  totalWorkflows: number;
}

export function dryRun(plan: CompiledPlan): DryRunResult {
  console.log('[DAG] dry run');

  const graph = buildGraph(plan.workflows);
  const cyclesFound = detectCycles(graph);

  if (cyclesFound.length > 0) {
    console.error(`[DAG] dry run failed: ${cyclesFound.length} cycle(s)`);
    return { valid: false, levels: [], cyclesFound, totalWorkflows: plan.workflows.length };
  }

  const levels = topologicalSort(graph);

  const levelDetails = levels.map((level, idx) => ({
    level: idx + 1,
    workflows: level.map((nodeId) => {
      const node = graph.get(nodeId)!;
      return { nodeId, workflow: node.call.workflow };
    }),
  }));

  console.log(`[DAG] dry run valid: ${levels.length} levels`);
  return { valid: true, levels: levelDetails, cyclesFound: [], totalWorkflows: plan.workflows.length };
}
