/**
 * RunExecutionPage - Visual Execution Console (T18/N3)
 *
 * Real-time DAG visualization with node status updates, timeline,
 * live output streaming, and gate handling.
 *
 * DESIGN PRINCIPLE:
 * - visualState (from run-store) is the SINGLE SOURCE OF TRUTH for node states
 * - React Flow nodes are DERIVED from visualState, not maintained separately
 * - SSE events update visualState, and React Flow re-renders accordingly
 *
 * N3 Enhancements:
 * - Unified error handling for run not found (S11)
 * - Gate action error feedback (S3/S4)
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { useApiError } from '../hooks/useApiError';
import {
  visualApi,
  runApi,
  createSSEConnection,
  type RunEvent,
  type NodeStatus,
  type WorkflowVisualSummary,
  ApiError,
} from '../api';
import { useGraphStore } from '../stores/graph-store';
import { useRunStore } from '../stores/run-store';
import { adaptWorkflowToFlowEdges } from '../lib/graph';
import { layoutDAG } from '../lib/graph';
import { NodeCard } from '../components/nodes/NodeCard';
import { InspectorPanel } from '../components/panels/InspectorPanel';
import { TimelineItem } from '../components/panels/TimelineItem';
import { MetricCard } from '../components/panels/MetricCard';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import type { BadgeVariant } from '../components/ui/Badge';
import { NotFoundState } from '../components/ui/NotFoundState';

// Custom node component for React Flow
function VisualizationNode({ data }: { data: Record<string, unknown> }) {
  const status = (data.status as NodeStatus) || 'pending';
  const isActive = data.isActive as boolean;
  const isFailed = data.isFailed as boolean;
  const isGateWaiting = data.isGateWaiting as boolean;

  let state: 'default' | 'hover' | 'selected' | 'active' | 'blocked' = 'default';
  if (isActive) state = 'active';
  else if (isFailed) state = 'blocked';
  else if (isGateWaiting) state = 'hover';

  return (
    <NodeCard
      name={data.label as string}
      type={(data.type as 'agent' | 'gate' | 'eval' | 'script' | 'start' | 'end') || 'agent'}
      status={status}
      state={state}
      durationMs={data.durationMs as number}
      tokenUsage={data.tokenUsage as { totalTokens: number }}
      errorMessage={data.errorMessage as string}
      hasGate={data.hasGate as boolean}
      hasEval={data.hasEval as boolean}
      isGateWaiting={isGateWaiting}
    />
  );
}

const nodeTypes: NodeTypes = {
  visualizationNode: VisualizationNode,
};

type TabType = 'timeline' | 'output' | 'details';

export default function RunExecutionPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Unified error handling (N3)
  const { isError, setError, clearError } = useApiError();
  const [runNotFound, setRunNotFound] = useState(false);

  // Graph store - only for selection (not for node state)
  const { selectNode, selectedNodeId } = useGraphStore();

  // Run store - SINGLE SOURCE OF TRUTH for visual state
  const {
    visualState,
    timeline,
    streamBuffers,
    connectionStatus,
    pendingGate,
    syncFromSnapshot,
    handleSSEEvent,
    setConnectionStatus,
    initRun,
    setTimeline,
    setPendingGate,
  } = useRunStore();

  // Local state for workflow layout (positions are not part of visual state)
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowVisualSummary | null>(null);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [activeTab, setActiveTab] = useState<TabType>('timeline');
  const [editText, setEditText] = useState('');
  const [isSubmittingGate, setIsSubmittingGate] = useState(false);
  const esRef = useRef<ReturnType<typeof createSSEConnection> | null>(null);
  const streamRef = useRef<HTMLPreElement>(null);

  // DERIVE React Flow nodes from visualState (single source of truth)
  const nodes = useMemo(() => {
    if (!workflowSummary || !visualState) return [];

    // Apply layout to get positions
    const layoutPositions = layoutDAG(
      workflowSummary.visualNodes.map((n) => ({ id: n.id })),
      workflowSummary.visualEdges.map((e) => ({ source: e.source, target: e.target })),
      { direction: 'LR' }
    );

    // Convert visual nodes to React Flow nodes, merging with visualState
    return workflowSummary.visualNodes.map((vn) => {
      const nodeState = visualState.nodeStates[vn.id];
      const position = layoutPositions.get(vn.id) ?? { x: 0, y: 0 };

      return {
        id: vn.id,
        type: 'visualizationNode',
        position,
        data: {
          id: vn.id,
          label: vn.name,
          type: vn.type,
          status: nodeState?.status ?? 'pending',
          durationMs: nodeState?.durationMs,
          tokenUsage: nodeState?.tokenUsage,
          errorMessage: nodeState?.errorMessage,
          hasGate: vn.hasGate,
          hasEval: vn.hasEval,
          isActive: visualState.currentActiveNodeIds.includes(vn.id),
          isFailed: visualState.failedNodeIds.includes(vn.id),
          isGateWaiting: visualState.gateWaitingNodeIds.includes(vn.id),
        },
      };
    });
  }, [workflowSummary, visualState]);

  // Fetch initial visual state and workflow summary
  const { isLoading: workflowLoading } = useApi(
    async () => {
      if (!runId) return null;

      try {
        // Fetch visual state (this is the authoritative snapshot)
        const state = await visualApi.getRunVisualState(runId);
        if (!state) {
          setRunNotFound(true);
          return null;
        }

        // Initialize run store with the snapshot
        initRun(runId, state.workflowId);
        syncFromSnapshot(state, 0);

        // Fetch workflow summary for layout
        const summary = await visualApi.getWorkflowSummary(state.workflowId);
        if (summary) {
          setWorkflowSummary(summary);
          // Set edges (static, from workflow definition)
          const flowEdges = adaptWorkflowToFlowEdges(summary.visualEdges);
          setEdges(flowEdges);
        }

        // Fetch timeline
        const timelineData = await visualApi.getRunTimeline(runId);
        if (timelineData) {
          setTimeline(timelineData);
        }

        return { visualState: state, workflowSummary: summary };
      } catch (err) {
        // Handle run not found (S11)
        if (err instanceof ApiError && err.code === 'NOT_FOUND') {
          setRunNotFound(true);
        } else {
          setError(err);
        }
        return null;
      }
    },
    [runId, initRun, setEdges, setError, setTimeline, syncFromSnapshot]
  );

  // Set up SSE connection for real-time updates
  useEffect(() => {
    if (!runId) return;

    setConnectionStatus('connecting');
    esRef.current = createSSEConnection(
      runId,
      (event: RunEvent, eventId?: string) => {
        // All state updates go through handleSSEEvent
        // which updates visualState (single source of truth)
        handleSSEEvent(event, eventId);
      },
      (error?: Error, retryCount?: number) => {
        console.warn('SSE error:', error?.message, 'retry:', retryCount);
        setConnectionStatus('error');
      },
      {
        onStatusChange: setConnectionStatus,
        maxRetries: 10,
      }
    );

    return () => {
      esRef.current?.close();
    };
  }, [runId, handleSSEEvent, setConnectionStatus]);

  // Update selected node data when selection changes
  const selectedNodeData = useMemo(() => {
    if (!selectedNodeId || !visualState?.nodeStates[selectedNodeId]) return null;
    return visualState.nodeStates[selectedNodeId];
  }, [selectedNodeId, visualState]);

  // Auto-scroll stream output
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamBuffers]);

  // Handle node click
  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    selectNode(node.id);
  }, [selectNode]);

  // Handle pane click (deselect)
  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Gate action handler (N3: enhanced error feedback)
  const [gateError, setGateError] = useState<string | null>(null);

  const handleGateAction = async (action: 'approve' | 'reject' | 'edit') => {
    if (!runId || !pendingGate) return;
    setGateError(null);
    setIsSubmittingGate(true);
    try {
      await runApi.gateAction(runId, pendingGate.stepId, {
        action,
        editedOutput: action === 'edit' ? editText : undefined,
      });
      setPendingGate(null);
      setEditText('');
    } catch (err) {
      // Enhanced error feedback (S3/S4)
      if (err instanceof ApiError) {
        setGateError(err.message || t('execution.gateActionFailed') || 'Gate action failed');
      } else {
        setGateError(t('execution.gateActionFailed') || 'Gate action failed');
      }
    } finally {
      setIsSubmittingGate(false);
    }
  };

  // Get connection status badge
  const getConnectionBadge = (): { variant: BadgeVariant; text: string } => {
    switch (connectionStatus) {
      case 'connected':
        return { variant: 'completed', text: t('execution.connected') };
      case 'connecting':
        return { variant: 'running', text: t('execution.connecting') };
      case 'reconnecting':
        return { variant: 'gate_waiting', text: t('execution.reconnecting') };
      case 'error':
        return { variant: 'failed', text: t('execution.error') };
      default:
        return { variant: 'pending', text: t('execution.disconnected') };
    }
  };

  // Get selected node from derived nodes
  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

  // Handle run not found (S11)
  if (runNotFound) {
    return <NotFoundState type="run" identifier={runId} />;
  }

  // Handle other errors
  if (isError && !visualState) {
    return (
      <NotFoundState
        type="run"
        identifier={runId}
        onRetry={() => {
          clearError();
          setRunNotFound(false);
          window.location.reload();
        }}
      />
    );
  }

  if (workflowLoading && !visualState) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const connectionBadge = getConnectionBadge();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-line bg-panel px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              ← {t('common.back')}
            </Button>
            <div>
              <h1 className="text-lg font-semibold">
                {workflowSummary?.name || t('execution.console')}
              </h1>
              <p className="text-xs text-muted">
                {t('execution.runId')}: {runId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={connectionBadge.variant}>
              {connectionBadge.text}
            </Badge>
            {visualState && (
              <span className="text-sm text-muted">
                {Object.values(visualState.nodeStates).filter(
                  (s) => s.status === 'completed' || s.status === 'skipped'
                ).length}/{Object.keys(visualState.nodeStates).length}{' '}
                {t('execution.nodesCompleted')}
              </span>
            )}
            {/* E5: Quick actions for failed runs */}
            {visualState?.status === 'failed' && (
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-line">
                <button
                  onClick={() => navigate('/diagnostics')}
                  className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded transition-colors"
                >
                  🔍 {t('runDetail.viewDiagnostics') || 'Diagnostics'}
                </button>
                <button
                  onClick={() => navigate(`/runs/compare?runA=${runId}`)}
                  className="px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded transition-colors"
                >
                  ⚖️ {t('comparison.compare')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Graph area */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.1}
            maxZoom={2}
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

          {/* Progress indicator */}
          {visualState && (
            <Panel position="bottom-left" className="bg-panel border border-line rounded-lg p-3 shadow-md">
              <div className="text-xs font-medium mb-1">
                {t('execution.progress')}
              </div>
              <div className="w-48 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand transition-all duration-300"
                  style={{
                    width: `${(Object.values(visualState.nodeStates).filter(
                      (s) => s.status === 'completed' || s.status === 'skipped' || s.status === 'cached'
                    ).length / Math.max(Object.keys(visualState.nodeStates).length, 1)) * 100}%`,
                  }}
                />
              </div>
            </Panel>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-80 border-l border-line flex flex-col overflow-hidden bg-panel">
          {/* Tab buttons */}
          <div className="flex border-b border-line">
            <button
              onClick={() => setActiveTab('timeline')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                activeTab === 'timeline'
                  ? 'text-brand border-b-2 border-brand'
                  : 'text-muted hover:text-text'
              }`}
            >
              {t('execution.timeline')}
            </button>
            <button
              onClick={() => setActiveTab('output')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                activeTab === 'output'
                  ? 'text-brand border-b-2 border-brand'
                  : 'text-muted hover:text-text'
              }`}
            >
              {t('execution.output')}
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                activeTab === 'details'
                  ? 'text-brand border-b-2 border-brand'
                  : 'text-muted hover:text-text'
              }`}
            >
              {t('execution.details')}
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'timeline' && (
              <div className="p-3 space-y-1">
                {timeline.length === 0 ? (
                  <p className="text-xs text-muted text-center py-4">
                    {t('execution.noTimelineEvents')}
                  </p>
                ) : (
                  timeline.map((entry) => (
                    <TimelineItem
                      key={entry.id}
                      event={entry.event}
                      timestamp={entry.timestamp}
                      details={entry.details}
                      status={entry.status}
                      nodeId={entry.stepId}
                      onClick={selectNode}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === 'output' && (
              <div className="p-3">
                {selectedNodeId && streamBuffers[selectedNodeId] ? (
                  <pre
                    ref={streamRef}
                    className="text-xs font-mono bg-bg rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words"
                  >
                    {streamBuffers[selectedNodeId]}
                  </pre>
                ) : (
                  <p className="text-xs text-muted text-center py-4">
                    {selectedNodeId
                      ? t('execution.noOutput')
                      : t('execution.selectNodeForOutput')}
                  </p>
                )}
              </div>
            )}

            {activeTab === 'details' && (
              <div className="p-3 space-y-4">
                {selectedNode && selectedNodeData ? (
                  <InspectorPanel
                    title={selectedNode.data.label as string}
                    nodeId={selectedNode.id}
                    status={(selectedNode.data.status as string) || 'pending'}
                    nodeType={selectedNode.data.type as string}
                    startedAt={selectedNodeData.startedAt
                      ? new Date(selectedNodeData.startedAt).toLocaleTimeString()
                      : undefined}
                    completedAt={selectedNodeData.completedAt
                      ? new Date(selectedNodeData.completedAt).toLocaleTimeString()
                      : undefined}
                    durationMs={selectedNodeData.durationMs}
                    tokenUsage={selectedNodeData.tokenUsage}
                    errorMessage={selectedNodeData.errorMessage}
                    inputPreview={selectedNodeData.inputPreview}
                    outputPreview={selectedNodeData.outputPreview}
                    logSummary={selectedNodeData.logSummary}
                    retryCount={selectedNodeData.retryCount}
                  />
                ) : (
                  <p className="text-xs text-muted text-center py-4">
                    {t('execution.selectNodeToInspect')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Metrics bar */}
          {visualState && (
            <div className="border-t border-line p-3 grid grid-cols-3 gap-2">
              <MetricCard
                label={t('execution.active')}
                value={visualState.currentActiveNodeIds.length}
              />
              <MetricCard
                label={t('execution.waiting')}
                value={visualState.gateWaitingNodeIds.length}
              />
              <MetricCard
                label={t('execution.failed')}
                value={visualState.failedNodeIds.length}
              />
            </div>
          )}
        </div>
      </div>

      {/* Gate Modal */}
      {pendingGate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-panel rounded-xl border border-line max-w-lg w-full p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center">
                <span className="text-xl">🚧</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{t('execution.gateWaiting')}</h3>
                <p className="text-xs text-muted font-mono">{pendingGate.stepId}</p>
              </div>
            </div>

            {/* Gate Error (N3) */}
            {gateError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-300">{gateError}</p>
              </div>
            )}

            {/* Preview */}
            <div className="mb-4">
              <label className="text-xs text-muted mb-1 block">Output Preview</label>
              <pre className="p-4 bg-bg rounded-lg border border-line text-sm font-mono max-h-48 overflow-auto whitespace-pre-wrap break-words">
                {pendingGate.preview || t('execution.noPreview')}
              </pre>
            </div>

            {/* Edit textarea */}
            <div className="mb-4">
              <label className="text-xs text-muted mb-1 block">Edit Output (Optional)</label>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full p-3 bg-bg border border-line rounded-lg text-sm font-mono resize-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                placeholder={t('execution.editPlaceholder')}
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="primary"
                onClick={() => handleGateAction('approve')}
                disabled={isSubmittingGate}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                ✓ {t('execution.approve')}
              </Button>
              <Button
                variant="danger"
                onClick={() => handleGateAction('reject')}
                disabled={isSubmittingGate}
                className="flex-1"
              >
                ✕ {t('execution.reject')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleGateAction('edit')}
                disabled={isSubmittingGate}
                className="flex-1"
              >
                ✎ {t('execution.edit')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
