/**
 * DiagnosticsPage - T21 / M3
 *
 * Diagnostics dashboard showing failed runs, waiting gates,
 * and detailed run diagnostics with suggested actions.
 * M3 adds recovery preview and risk indication.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { diagnosticsApi, type DiagnosticsSummary, type RecommendedAction } from '../api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { WarningCallout } from '../components/panels/WarningCallout';
import { RecoveryPreviewPanel } from '../components/panels/RecoveryPreviewPanel';

type TabType = 'failed' | 'waiting';

function getPriorityBadge(priority: 'high' | 'medium' | 'low'): 'error' | 'warning' | 'default' {
  switch (priority) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'default';
  }
}

function getImpactTypeBadge(impactType: 'blocked' | 'skipped' | 'will_fail'): 'warning' | 'error' | 'default' {
  switch (impactType) {
    case 'blocked':
      return 'warning';
    case 'skipped':
      return 'default';
    case 'will_fail':
      return 'error';
  }
}

export default function DiagnosticsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('failed');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Fetch failed runs
  const { data: failedRuns, isLoading: failedLoading, refetch: refetchFailed } = useApi(
    () => diagnosticsApi.getFailedRuns(),
    []
  );

  // Fetch waiting gates
  const { data: waitingGates, isLoading: waitingLoading, refetch: refetchGates } = useApi(
    () => diagnosticsApi.getWaitingGates(),
    []
  );

  const { data: diagnosticsDetail, isLoading: diagnosticsLoading } = useApi(
    () => selectedRunId ? diagnosticsApi.getRunDiagnostics(selectedRunId) : Promise.resolve(null),
    [selectedRunId]
  );

  // Refresh data
  const handleRefresh = () => {
    refetchFailed();
    refetchGates();
  };

  // Navigate to run execution console
  const handleViewRun = (runId: string) => {
    setSelectedRunId(runId);
    navigate(`/runs/${runId}/execute`);
  };

  // Navigate to run diagnostics (opens execution console with diagnostics focus)
  const handleViewDiagnostics = (runId: string) => {
    setSelectedRunId(runId);
  };

  // Handle recommended action
  const handleAction = (action: RecommendedAction) => {
    if (action.type === 'rerun' || action.type === 'rerun_with_edits') {
      navigate(`/runs/${action.targetRunId}/rerun`);
    } else if (action.type === 'recover') {
      // Navigate to workflow run page with recovery mode
      if (selectedRunId && diagnosticsDetail) {
        navigate(`/workflows/${diagnosticsDetail.workflowId}/run`, {
          state: { sourceRunId: action.targetRunId, mode: 'recovery' },
        });
      }
    } else if (action.type === 'check_api') {
      navigate('/settings');
    }
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Format relative time
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  // Get error type badge variant
  const getErrorTypeBadge = (errorType?: string): 'error' | 'warning' | 'default' => {
    if (!errorType) return 'default';
    const lower = errorType.toLowerCase();
    if (lower.includes('timeout')) return 'warning';
    if (lower.includes('auth') || lower.includes('permission')) return 'error';
    return 'error';
  };

  // Summary counts
  const failedCount = failedRuns?.length || 0;
  const waitingCount = waitingGates?.length || 0;
  const totalAttention = failedCount + waitingCount;

  const isLoading = failedLoading || waitingLoading;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text">
              {t('diagnostics.title')}
            </h1>
            <p className="text-sm text-muted mt-1">
              {t('diagnostics.subtitle')}
            </p>
          </div>
          <Button variant="secondary" onClick={handleRefresh}>
            ↻ {t('diagnostics.refresh')}
          </Button>
        </div>
      </header>

      {/* Needs Attention Summary */}
      {totalAttention > 0 && (
        <div className="mb-8">
          <WarningCallout
            type={failedCount > 0 ? 'error' : 'warning'}
            title={t('diagnostics.needsAttention')}
          >
            <div className="flex items-center gap-4">
              {failedCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {failedCount} {t('diagnostics.failedRuns')}
                </span>
              )}
              {waitingCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  {waitingCount} {t('diagnostics.waitingGates')}
                </span>
              )}
            </div>
          </WarningCallout>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-line mb-6">
        <button
          onClick={() => setActiveTab('failed')}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'failed'
              ? 'text-brand border-b-2 border-brand'
              : 'text-muted'
          }`}
        >
          {t('diagnostics.failedRunsTab')}
          {failedCount > 0 && (
            <Badge variant="error" className="ml-2">
              {failedCount}
            </Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab('waiting')}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'waiting'
              ? 'text-brand border-b-2 border-brand'
              : 'text-muted'
          }`}
        >
          {t('diagnostics.waitingGatesTab')}
          {waitingCount > 0 && (
            <Badge variant="warning" className="ml-2">
              {waitingCount}
            </Badge>
          )}
        </button>
      </div>

      {selectedRunId && (
        <div className="mb-6">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-medium">{t('diagnostics.runDiagnostics')}</h2>
                <p className="text-xs text-muted font-mono mt-1">{selectedRunId}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => navigate(`/runs/${selectedRunId}/execute`)}>
                {t('diagnostics.viewInConsole')}
              </Button>
            </div>
            {diagnosticsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              </div>
            ) : diagnosticsDetail ? (
              <DiagnosticsDetail
                diagnostics={diagnosticsDetail}
                onAction={handleAction}
                t={t}
              />
            ) : (
              <p className="text-sm text-muted">{t('diagnostics.noDiagnosticsAvailable')}</p>
            )}
          </Card>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Failed Runs */}
          {activeTab === 'failed' && (
            failedRuns && failedRuns.length > 0 ? (
              failedRuns.map((run) => (
                <Card
                  key={run.runId}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleViewRun(run.runId)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-medium">{run.runId}</span>
                        <Badge variant={getErrorTypeBadge(run.errorType)}>
                          {run.errorType || 'Unknown Error'}
                        </Badge>
                      </div>
                      {run.errorMessage && (
                        <p className="text-sm text-muted mb-2 line-clamp-2">
                          {run.errorMessage}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted">
                        {run.failedNodeId && (
                          <span>Node: {run.failedNodeId}</span>
                        )}
                        <span>{formatRelativeTime(run.failedAt)}</span>
                        <span>{formatTime(run.failedAt)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewRun(run.runId);
                        }}
                      >
                        {t('diagnostics.viewRun')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDiagnostics(run.runId);
                        }}
                      >
                        📊 {t('diagnostics.runDiagnostics')}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center py-12 text-muted">
                <div className="text-4xl mb-4">✓</div>
                <p>{t('diagnostics.noFailedRuns')}</p>
              </div>
            )
          )}

          {/* Waiting Gates */}
          {activeTab === 'waiting' && (
            waitingGates && waitingGates.length > 0 ? (
              waitingGates.map((gate) => (
                <Card
                  key={`${gate.runId}-${gate.stepId}`}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleViewRun(gate.runId)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-medium">{gate.runId}</span>
                        <Badge variant="warning">🚧 Gate Waiting</Badge>
                      </div>
                      {gate.preview && (
                        <p className="text-sm text-muted mb-2 line-clamp-2">
                          {gate.preview}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted">
                        <span>Step: {gate.stepId}</span>
                        <span>{formatRelativeTime(gate.waitedAt)}</span>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewRun(gate.runId);
                      }}
                    >
                      {t('diagnostics.handleGate')}
                    </Button>
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center py-12 text-muted">
                <div className="text-4xl mb-4">✓</div>
                <p>{t('diagnostics.noWaitingGates')}</p>
              </div>
            )
          )}
        </div>
      )}

      {/* Quick Access Links */}
      <div className="mt-12">
        <h2 className="text-lg font-medium mb-4">{t('diagnostics.quickLinks')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/runs')}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-lg">
                📋
              </div>
              <div>
                <h3 className="font-medium">{t('diagnostics.allRuns')}</h3>
                <p className="text-xs text-muted">{t('diagnostics.allRunsDesc')}</p>
              </div>
            </div>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/workflows')}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-lg">
                ⚙️
              </div>
              <div>
                <h3 className="font-medium">{t('diagnostics.workflows')}</h3>
                <p className="text-xs text-muted">{t('diagnostics.workflowsDesc')}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Diagnostics Detail Component
// =============================================================================

interface DiagnosticsDetailProps {
  diagnostics: DiagnosticsSummary;
  onAction: (action: RecommendedAction) => void;
  t: (key: string) => string;
}

function DiagnosticsDetail({ diagnostics, onAction, t }: DiagnosticsDetailProps) {
  return (
    <div className="space-y-6">
      {/* Workflow Info */}
      {diagnostics.workflowName && (
        <div className="text-sm">
          <span className="text-muted">{t('diagnostics.workflow')}: </span>
          <span className="font-medium">{diagnostics.workflowName}</span>
        </div>
      )}

      {/* Failure Propagation Summary */}
      {diagnostics.failurePropagation && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <h3 className="font-medium text-red-800 dark:text-red-200 mb-2">
            🔍 {t('diagnostics.failureAnalysis')}
          </h3>
          <p className="text-sm text-red-700 dark:text-red-300">
            {diagnostics.failurePropagation.summary}
          </p>
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">
            <span>{t('diagnostics.rootCause')}: </span>
            <span className="font-mono">{diagnostics.failurePropagation.rootCauseNodeId}</span>
            <span className="mx-2">•</span>
            <span>{t('diagnostics.affectedNodes')}: {diagnostics.failurePropagation.affectedNodeCount}</span>
          </div>
        </div>
      )}

      {/* Failed Nodes */}
      {diagnostics.failedNodes.length > 0 && (
        <div>
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <span className="text-red-500">✕</span>
            {t('diagnostics.failedNodes')} ({diagnostics.failedNodes.length})
          </h3>
          <div className="space-y-3">
            {diagnostics.failedNodes.map((node) => (
              <div
                key={node.nodeId}
                className="border border-red-200 dark:border-red-800 rounded-lg p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-sm">{node.nodeName || node.nodeId}</span>
                  <Badge variant="error">{node.errorType}</Badge>
                </div>
                <p className="text-xs text-muted whitespace-pre-wrap break-words mb-2">
                  {node.errorMessage}
                </p>
                {node.upstreamCompleted.length > 0 && (
                  <div className="text-xs text-muted">
                    <span className="text-green-600 dark:text-green-400">✓</span>
                    <span className="ml-1">{t('diagnostics.upstreamCompleted')}: </span>
                    <span className="font-mono">{node.upstreamCompleted.join(', ')}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Downstream Impact */}
      {diagnostics.downstreamImpact.length > 0 && (
        <div>
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <span className="text-yellow-500">⚠</span>
            {t('diagnostics.downstreamImpact')} ({diagnostics.downstreamImpact.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {diagnostics.downstreamImpact.map((node) => (
              <div
                key={node.nodeId}
                className="border border-line rounded-lg p-3 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs">{node.nodeName || node.nodeId}</span>
                  <Badge variant={getImpactTypeBadge(node.impactType)}>
                    {node.impactType}
                  </Badge>
                </div>
                <p className="text-xs text-muted">{node.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recovery Preview Panel - M3 */}
      {diagnostics.recoveryScope && (
        <RecoveryPreviewPanel
          runId={diagnostics.runId}
          initialPreview={diagnostics.recoveryScope}
          compact={false}
        />
      )}

      {/* Recommended Actions */}
      {diagnostics.recommendedActions.length > 0 && (
        <div>
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <span>💡</span>
            {t('diagnostics.recommendedActions')}
          </h3>
          <div className="space-y-2">
            {diagnostics.recommendedActions.map((action, index) => (
              <div
                key={index}
                className="border border-line rounded-lg p-3 flex items-start justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{action.title}</span>
                    <Badge variant={getPriorityBadge(action.priority)}>
                      {action.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">{action.description}</p>
                </div>
                {(action.type === 'rerun' || action.type === 'rerun_with_edits' || action.type === 'recover' || action.type === 'check_api') && (
                  <Button
                    variant={action.type === 'recover' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => onAction(action)}
                  >
                    {action.type === 'check_api' ? t('diagnostics.goToSettings') :
                     action.type === 'recover' ? (t('diagnostics.recover') || 'Recover') :
                     t('diagnostics.takeAction')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Node States */}
      <details className="border border-line rounded-lg">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium">
          {t('diagnostics.allNodeStates')} ({Object.keys(diagnostics.upstreamStates).length})
        </summary>
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Object.entries(diagnostics.upstreamStates).map(([nodeId, status]) => (
              <div key={nodeId} className="flex items-center justify-between gap-2 p-2 bg-surface rounded">
                <span className="font-mono truncate">{nodeId}</span>
                <Badge
                  variant={
                    status === 'completed' ? 'default' :
                    status === 'failed' ? 'error' :
                    status === 'running' ? 'warning' :
                    'default'
                  }
                >
                  {status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
