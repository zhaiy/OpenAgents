/**
 * WorkflowOverviewPage - T16
 *
 * Workflow overview page with:
 * - Workflow header with name, description, and stats
 * - Mini DAG preview with React Flow
 * - Node detail panel when node selected
 * - Input schema summary
 * - Run CTA button
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { visualApi, diagnosticsApi, type WorkflowVisualNode, type WorkflowQualitySummary } from '../api';
import { adaptWorkflowToFlowNodes, adaptWorkflowToFlowEdges } from '../lib/graph';
import { layoutDAG } from '../lib/graph';
import { NodeCard } from '../components/nodes/NodeCard';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

// Custom node component for React Flow (read-only overview)
function VisualizationNode({ data }: { data: Record<string, unknown> }) {
  const isSelected = data.selected as boolean;
  const nodeType = (data.type as 'agent' | 'gate' | 'eval' | 'script' | 'start' | 'end') || 'agent';

  return (
    <NodeCard
      name={data.label as string}
      type={nodeType}
      status="pending"
      state={isSelected ? 'selected' : 'default'}
      hasGate={data.hasGate as boolean}
      hasEval={data.hasEval as boolean}
    />
  );
}

const nodeTypes: NodeTypes = {
  visualizationNode: VisualizationNode,
};

export default function WorkflowOverviewPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Local state
  const [selectedNode, setSelectedNode] = useState<WorkflowVisualNode | null>(null);

  // Fetch workflow visual summary
  const { data: summary, isLoading, error } = useApi(
    () => workflowId ? visualApi.getWorkflowSummary(workflowId) : Promise.reject(new Error('No workflowId')),
    [workflowId]
  );

  // Fetch workflow quality summary - E3
  const { data: qualitySummary } = useApi(
    () => workflowId ? diagnosticsApi.getWorkflowQualitySummary(workflowId) : Promise.resolve(null),
    [workflowId]
  );

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Build graph when summary loads
  useEffect(() => {
    if (!summary) return;

    // Apply layout
    const layoutPositions = layoutDAG(
      summary.visualNodes.map((n) => ({ id: n.id })),
      summary.visualEdges.map((e) => ({ source: e.source, target: e.target })),
      { direction: 'LR', nodeGapX: 100, nodeGapY: 80 }
    );

    // Convert to flow nodes with positions
    const flowNodes = adaptWorkflowToFlowNodes(summary, layoutPositions);
    const flowEdges = adaptWorkflowToFlowEdges(summary.visualEdges);

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [summary, setNodes, setEdges]);

  // Handle node click
  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    if (!summary) return;
    const visualNode = summary.visualNodes.find((n) => n.id === node.id);
    setSelectedNode(visualNode || null);
  }, [summary]);

  // Handle pane click (deselect)
  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Handle run button
  const handleRun = () => {
    if (!workflowId) return;
    navigate(`/workflows/${workflowId}/run`);
  };

  // E3 - Quality trend helpers
  const getTrendIcon = (trend?: 'improving' | 'declined' | 'stable' | 'insufficient_data') => {
    switch (trend) {
      case 'improving':
        return { icon: '↗', color: 'text-green-600 dark:text-green-400', label: 'Improving' };
      case 'declined':
        return { icon: '↘', color: 'text-red-600 dark:text-red-400', label: 'Declining' };
      case 'stable':
        return { icon: '→', color: 'text-blue-600 dark:text-blue-400', label: 'Stable' };
      default:
        return { icon: '?', color: 'text-muted', label: 'Insufficient data' };
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-center">
        <p className="text-danger">{t('common.error')}</p>
        <Button variant="secondary" onClick={() => navigate(-1)} className="mt-4">
          ← {t('common.back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-line bg-panel px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-semibold truncate">{summary.name}</h1>
                {summary.gateCount > 0 && (
                  <Badge variant="warning">{summary.gateCount} 🚧</Badge>
                )}
                {summary.evalCount > 0 && (
                  <Badge variant="default">{summary.evalCount} 📊</Badge>
                )}
              </div>
              {summary.description && (
                <p className="text-sm text-muted line-clamp-2">{summary.description}</p>
              )}
            </div>
            <Button variant="primary" onClick={handleRun} size="lg">
              ▶ {t('workflows.run')}
            </Button>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted">Nodes:</span>
              <span className="font-medium">{summary.nodeCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted">Edges:</span>
              <span className="font-medium">{summary.edgeCount}</span>
            </div>
            {summary.inputSchemaSummary && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Inputs:</span>
                  <span className="font-medium">
                    {summary.inputSchemaSummary.totalFields} fields
                    {summary.inputSchemaSummary.requiredFields > 0 && (
                      <span className="text-danger"> ({summary.inputSchemaSummary.requiredFields} required)</span>
                    )}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Quality Trend - E3 */}
          {qualitySummary && qualitySummary.totalRuns > 0 && (
            <div className="mt-4 p-3 bg-surface rounded-lg border border-line">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {/* Success Rate */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">Success Rate</span>
                    <span className={`text-lg font-semibold ${
                      qualitySummary.successRate >= 80 ? 'text-green-600 dark:text-green-400' :
                      qualitySummary.successRate >= 60 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {qualitySummary.successRate.toFixed(0)}%
                    </span>
                    {qualitySummary.evalSummary?.trend && (
                      <span className={`text-sm ${getTrendIcon(qualitySummary.evalSummary.trend).color}`} title={getTrendIcon(qualitySummary.evalSummary.trend).label}>
                        {getTrendIcon(qualitySummary.evalSummary.trend).icon}
                      </span>
                    )}
                  </div>
                  {/* Runs count */}
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{qualitySummary.totalRuns} runs</span>
                    {qualitySummary.avgDurationMs && (
                      <>
                        <span>·</span>
                        <span>Avg {formatDuration(qualitySummary.avgDurationMs)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Failure indicator */}
                  {qualitySummary.failureCount > 0 && (
                    <Badge variant="error" className="text-xs">
                      {qualitySummary.failureCount} failed
                    </Badge>
                  )}
                  {/* Primary failure type */}
                  {qualitySummary.failureTypes[0] && (
                    <span className="text-xs text-muted truncate max-w-[120px]" title={qualitySummary.failureTypes[0].errorType}>
                      {qualitySummary.failureTypes[0].errorType}
                    </span>
                  )}
                  {/* Gate wait indicator */}
                  {qualitySummary.gateWaitStats.totalGateWaits > 0 && (
                    <Badge variant="warning" className="text-xs">
                      🚧 {qualitySummary.gateWaitStats.totalGateWaits} gates
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Graph area */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-left" className="bg-panel border border-line rounded-lg p-2 shadow-md">
              <div className="text-xs text-muted">
                {t('execution.clickNodeHint')}
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Right sidebar */}
        <div className="w-80 border-l border-line flex flex-col overflow-hidden bg-panel">
          <div className="flex-1 overflow-auto">
            {selectedNode ? (
              <div className="p-4 space-y-4">
                {/* Node detail */}
                <div>
                  <h3 className="text-sm font-medium mb-3">{selectedNode.name}</h3>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">
                        {selectedNode.type}
                      </Badge>
                      {selectedNode.hasGate && (
                        <Badge variant="warning">🚧 Gate</Badge>
                      )}
                      {selectedNode.hasEval && (
                        <Badge variant="default">📊 Eval</Badge>
                      )}
                    </div>

                    {selectedNode.description && (
                      <div>
                        <label className="text-xs text-muted">Description</label>
                        <p className="text-sm mt-1">{selectedNode.description}</p>
                      </div>
                    )}

                    {selectedNode.agentId && (
                      <div>
                        <label className="text-xs text-muted">Agent ID</label>
                        <p className="text-sm font-mono mt-1">{selectedNode.agentId}</p>
                      </div>
                    )}

                    <div>
                      <label className="text-xs text-muted">Upstream</label>
                      <p className="text-sm mt-1">
                        {selectedNode.upstreamIds.length > 0
                          ? selectedNode.upstreamIds.join(', ')
                          : 'None'}
                      </p>
                    </div>

                    <div>
                      <label className="text-xs text-muted">Downstream</label>
                      <p className="text-sm mt-1">
                        {selectedNode.downstreamIds.length > 0
                          ? selectedNode.downstreamIds.join(', ')
                          : 'None'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : summary.inputSchemaSummary && summary.inputSchemaSummary.fields.length > 0 ? (
              /* Input schema */
              <div className="p-4 space-y-4">
                <h3 className="text-sm font-medium">Input Schema</h3>
                <div className="space-y-3">
                  {summary.inputSchemaSummary.fields.map((field) => (
                    <div key={field.name} className="border border-line rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{field.name}</span>
                        {field.required && (
                          <Badge variant="error">Required</Badge>
                        )}
                        <Badge variant="default">{field.type}</Badge>
                      </div>
                      {field.description && (
                        <p className="text-xs text-muted mt-1">{field.description}</p>
                      )}
                      {field.defaultValue !== undefined && (
                        <p className="text-xs text-muted mt-1">
                          Default: {JSON.stringify(field.defaultValue)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Empty state */
              <div className="flex items-center justify-center h-full p-4">
                <p className="text-sm text-muted text-center">
                  {t('execution.clickNodeHint')}
                </p>
              </div>
            )}
          </div>

          {/* Bottom CTA */}
          <div className="border-t border-line p-4">
            <Button variant="primary" onClick={handleRun} className="w-full">
              ▶ {t('workflows.run')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
