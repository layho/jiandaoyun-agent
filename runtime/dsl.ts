/**
 * runtime/dsl.ts — V2 DSL Compiler
 *
 * Compiles an AST document into executable workflow calls.
 * This is the bridge between declarative application definitions
 * and the Playwright-based workflow runtime.
 *
 * The DSL compiler does NOT execute — it translates.
 * The DAG runtime (dag.ts) handles execution ordering.
 */

import type {
  ASTDocument,
  AnyASTNode,
  FormNode,
  FieldNode,
  RelationNode,
  AggregateNode,
  AssistantNode as ASTAssistantNode,
  DataFactoryNode as ASTDataFactoryNode,
  ActionNode,
} from './ast';

// ---------------------------------------------------------------------------
// Compilation target
// ---------------------------------------------------------------------------

export interface WorkflowCall {
  workflow: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  nodeId: string;
}

export interface CompiledPlan {
  version: string;
  source: string;
  workflows: WorkflowCall[];
}

// ---------------------------------------------------------------------------
// Node → Workflow mapping
// ---------------------------------------------------------------------------

const NODE_TO_WORKFLOW: Record<string, string> = {
  form: 'create_form',
  field: 'create_field',
  relation: 'create_relation',
  aggregate: 'create_aggregate',
  assistant: 'create_assistant',
  data_factory: 'create_data_factory',
};

// ---------------------------------------------------------------------------
// Individual compilers
// ---------------------------------------------------------------------------

function compileForm(node: FormNode): WorkflowCall {
  return {
    workflow: 'create_form',
    params: {
      name: node.name,
      description: node.description ?? '',
    },
    dependsOn: [],
    nodeId: node.id,
  };
}

function compileField(node: FieldNode): WorkflowCall {
  return {
    workflow: 'create_field',
    params: {
      formName: node.parentForm,
      fieldName: node.fieldName,
      fieldType: node.fieldType,
      required: node.required ?? false,
      description: node.description ?? '',
    },
    dependsOn: [node.parentForm],
    nodeId: node.id,
  };
}

function compileRelation(node: RelationNode): WorkflowCall {
  return {
    workflow: 'create_relation',
    params: {
      sourceForm: node.sourceForm,
      sourceField: node.sourceField,
      targetForm: node.targetForm,
      targetField: node.targetField,
    },
    dependsOn: [node.sourceForm, node.targetForm],
    nodeId: node.id,
  };
}

function compileAggregate(node: AggregateNode): WorkflowCall {
  return {
    workflow: 'create_aggregate',
    params: {
      name: node.name,
      sourceForm: node.sourceForm,
      rowDimensions: node.rowDimensions,
      columnDimensions: node.columnDimensions ?? [],
      indicators: node.indicators,
    },
    dependsOn: [node.sourceForm],
    nodeId: node.id,
  };
}

function compileAssistant(node: ASTAssistantNode): WorkflowCall {
  return {
    workflow: 'create_assistant',
    params: {
      name: node.name,
      sourceForm: node.sourceForm,
      triggerType: node.triggerType,
      nodes: node.nodes,
    },
    dependsOn: [node.sourceForm],
    nodeId: node.id,
  };
}

function compileDataFactory(node: ASTDataFactoryNode): WorkflowCall {
  return {
    workflow: 'create_data_factory',
    params: {
      name: node.name,
      sourceForm: node.sourceForm,
      nodes: node.nodes,
    },
    dependsOn: [node.sourceForm],
    nodeId: node.id,
  };
}

function compileAction(node: ActionNode): WorkflowCall {
  return {
    workflow: node.action,
    params: node.params,
    dependsOn: node.dependsOn ?? [],
    nodeId: node.id,
  };
}

// ---------------------------------------------------------------------------
// Main compiler
// ---------------------------------------------------------------------------

/**
 * Compile an AST document into an ordered list of workflow calls.
 * Fields are sorted after their parent forms.
 */
export function compileAST(doc: ASTDocument): CompiledPlan {
  console.log('[DSL] compiling AST document');

  const workflows: WorkflowCall[] = [];

  for (const node of doc.nodes) {
    let call: WorkflowCall;

    switch (node.type) {
      case 'form':
        call = compileForm(node as FormNode);
        break;
      case 'field':
        call = compileField(node as FieldNode);
        break;
      case 'relation':
        call = compileRelation(node as RelationNode);
        break;
      case 'aggregate':
        call = compileAggregate(node as AggregateNode);
        break;
      case 'assistant':
        call = compileAssistant(node as ASTAssistantNode);
        break;
      case 'data_factory':
        call = compileDataFactory(node as ASTDataFactoryNode);
        break;
      case 'action':
        call = compileAction(node as ActionNode);
        break;
      case 'selector':
        // Selector nodes are metadata only — skip
        continue;
      default:
        // Exhaustive switch — all node types covered above
        throw new Error(`[DSL] unexpected node type: ${(node as AnyASTNode).type}`);
    }

    workflows.push(call);
  }

  const plan: CompiledPlan = {
    version: doc.version,
    source: 'V2 DSL Compiler',
    workflows,
  };

  console.log(`[DSL] compiled ${workflows.length} workflow calls`);
  return plan;
}

// ---------------------------------------------------------------------------
// DSL Parser (JSON → AST)
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into an AST document.
 * Throws if the structure is invalid.
 */
export function parseDSL(json: string): ASTDocument {
  console.log('[DSL] parsing DSL input');

  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error('[DSL] Invalid JSON input');
  }

  const d = doc as Record<string, unknown>;

  if (!d.version) {
    throw new Error('[DSL] Missing "version" field');
  }
  if (!Array.isArray(d.nodes)) {
    throw new Error('[DSL] Missing "nodes" array');
  }

  for (const node of d.nodes as Record<string, unknown>[]) {
    if (!node.type || !node.id) {
      throw new Error(`[DSL] Node missing type or id: ${JSON.stringify(node)}`);
    }
  }

  return doc as ASTDocument;
}

// ---------------------------------------------------------------------------
// Full pipeline: Parse → Validate → Compile
// ---------------------------------------------------------------------------

import { validateAST } from './ast';

export interface CompileResult {
  success: boolean;
  plan?: CompiledPlan;
  errors: string[];
}

export function compile(json: string): CompileResult {
  console.log('[DSL] ======== full pipeline start ========');

  try {
    // Step 1: Parse
    const doc = parseDSL(json);
    console.log(`[DSL] parsed ${doc.nodes.length} nodes`);

    // Step 2: Validate
    const validation = validateAST(doc);
    if (!validation.valid) {
      console.error('[DSL] validation failed');
      return { success: false, errors: validation.errors };
    }
    console.log('[DSL] validation passed');

    // Step 3: Compile
    const plan = compileAST(doc);
    console.log('[DSL] ======== pipeline complete ========');

    return { success: true, plan, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DSL] pipeline error: ${message}`);
    return { success: false, errors: [message] };
  }
}
