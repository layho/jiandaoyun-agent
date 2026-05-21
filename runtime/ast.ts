/**
 * runtime/ast.ts — V2 AST (Abstract Syntax Tree) Definitions
 *
 * Domain-specific AST for describing 简道云 application structures.
 * This is the intermediate representation between the DSL compiler
 * and the Playwright runtime.
 *
 * The AST is intentionally flat — no nested expressions, no closures.
 * DeepSeek V4 Pro generates these nodes; the DAG runtime executes them.
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export type ASTNodeType =
  | 'form'
  | 'field'
  | 'relation'
  | 'aggregate'
  | 'assistant'
  | 'data_factory'
  | 'selector'
  | 'action';

// ---------------------------------------------------------------------------
// Base node
// ---------------------------------------------------------------------------

export interface ASTNode {
  type: ASTNodeType;
  id: string;
  meta?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Concrete nodes
// ---------------------------------------------------------------------------

export interface FormNode extends ASTNode {
  type: 'form';
  name: string;
  description?: string;
  fields?: FieldNode[];
}

export interface FieldNode extends ASTNode {
  type: 'field';
  parentForm: string;
  fieldName: string;
  fieldType: string;
  required?: boolean;
  description?: string;
}

export interface RelationNode extends ASTNode {
  type: 'relation';
  sourceForm: string;
  sourceField: string;
  targetForm: string;
  targetField: string;
}

export interface AggregateNode extends ASTNode {
  type: 'aggregate';
  name: string;
  sourceForm: string;
  rowDimensions: { field: string }[];
  columnDimensions?: { field: string }[];
  indicators: { field: string; type: string }[];
}

export interface AssistantNode extends ASTNode {
  type: 'assistant';
  name: string;
  sourceForm: string;
  triggerType: string;
  nodes: { type: string; config?: Record<string, string> }[];
}

export interface DataFactoryNode extends ASTNode {
  type: 'data_factory';
  name: string;
  sourceForm: string;
  nodes: { type: string; config?: Record<string, string> }[];
}

export interface SelectorNode extends ASTNode {
  type: 'selector';
  target: string;
  selectors: string[][];
}

export interface ActionNode extends ASTNode {
  type: 'action';
  action: string;
  params: Record<string, string>;
  dependsOn?: string[];
}

// ---------------------------------------------------------------------------
// Union type for all AST nodes
// ---------------------------------------------------------------------------

export type AnyASTNode =
  | FormNode
  | FieldNode
  | RelationNode
  | AggregateNode
  | AssistantNode
  | DataFactoryNode
  | SelectorNode
  | ActionNode;

// ---------------------------------------------------------------------------
// AST document (collection of nodes)
// ---------------------------------------------------------------------------

export interface ASTDocument {
  version: '2.0.0';
  nodes: AnyASTNode[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an AST document has no missing references or cyclic dependencies.
 */
export function validateAST(doc: ASTDocument): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(doc.nodes.map((n) => n.id));

  for (const node of doc.nodes) {
    if (node.type === 'action' && 'dependsOn' in node && node.dependsOn) {
      for (const depId of node.dependsOn) {
        if (!ids.has(depId)) {
          errors.push(`Missing dependency: node "${node.id}" depends on "${depId}" which is not in the AST`);
        }
      }
    }

    if (node.type === 'field') {
      const fieldNode = node as FieldNode;
      if (fieldNode.parentForm && !ids.has(fieldNode.parentForm)) {
        errors.push(`Field "${node.id}" references missing form "${fieldNode.parentForm}"`);
      }
    }

    if (node.type === 'relation') {
      const rel = node as RelationNode;
      if (!ids.has(rel.sourceForm)) errors.push(`Relation "${node.id}": source form "${rel.sourceForm}" not found`);
      if (!ids.has(rel.targetForm)) errors.push(`Relation "${node.id}": target form "${rel.targetForm}" not found`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
export function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}_${Date.now().toString(36)}`;
}

export function createFormNode(name: string, description?: string): FormNode {
  return {
    type: 'form',
    id: nextId('form'),
    name,
    description,
    fields: [],
  };
}

export function createFieldNode(
  parentForm: string,
  fieldName: string,
  fieldType: string,
  required?: boolean
): FieldNode {
  return {
    type: 'field',
    id: nextId('field'),
    parentForm,
    fieldName,
    fieldType,
    required,
  };
}

export function createRelationNode(
  sourceForm: string,
  sourceField: string,
  targetForm: string,
  targetField: string
): RelationNode {
  return {
    type: 'relation',
    id: nextId('rel'),
    sourceForm,
    sourceField,
    targetForm,
    targetField,
  };
}

export function createAggregateNode(
  name: string,
  sourceForm: string,
  rowDimensions: { field: string }[],
  indicators: { field: string; type: string }[]
): AggregateNode {
  return {
    type: 'aggregate',
    id: nextId('agg'),
    name,
    sourceForm,
    rowDimensions,
    indicators,
  };
}
