/**
 * RunComparisonPage - T22/N7
 *
 * Session-based run comparison page with enhanced diff summary
 * supporting tuning and review decisions.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { comparisonApi, runApi } from '../api';
import type { InputDiff, NodeStatusDiff, OutputDiffItem, ComparisonSummary, WorkflowConfigDiff } from '../api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

export default function RunComparisonPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const runAId = searchParams.get('runA') || '';
  const runBId = searchParams.get('runB') || '';
  const sessionId = searchParams.get('session') || '';

  const { data: session, isLoading, error } = useApi(
    () => sessionId ? comparisonApi.getSession(sessionId) : Promise.resolve(null),
    [sessionId]
  );

  const { data: runA } = useApi(
    () => runAId ? runApi.get(runAId) : Promise.resolve(null),
    [runAId]
  );

  const { data: runB } = useApi(
    () => runBId ? runApi.get(runBId) : Promise.resolve(null),
    [runBId]
  );

  const comparison = session?.comparison ?? null;
  const canCompare = Boolean(runAId && runBId && runAId !== runBId);

  const updateRunParam = (key: 'runA' | 'runB', value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('session');
    setSearchParams(params);
  };

  const handleCompare = async () => {
    if (!canCompare) return;
    setIsCreatingSession(true);
    try {
      const created = await comparisonApi.createSession(runAId, runBId);
      const params = new URLSearchParams(searchParams);
      params.set('session', created.sessionId);
      setSearchParams(params);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleClearComparison = async () => {
    if (sessionId) {
      try {
        await comparisonApi.deleteSession(sessionId);
      } catch {
        // Ignore missing session
      }
    }
    const params = new URLSearchParams(searchParams);
    params.delete('session');
    setSearchParams(params);
  };

  const handleViewRun = (runId: string) => {
    navigate(`/runs/${runId}/execute`);
  };

  // Handle recovery for a failed run (M3)
  const handleRecover = (runId: string, workflowId: string) => {
    navigate(`/workflows/${workflowId}/run`, {
      state: { sourceRunId: runId, mode: 'recovery' },
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getStatusBadge = (status: string): 'success' | 'error' | 'warning' | 'default' => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getDiffTypeBadge = (diffType: string): { label: string; variant: 'success' | 'error' | 'warning' | 'default' } => {
    switch (diffType) {
      case 'added':
        return { label: t('comparison.diffAdded') || 'Added', variant: 'success' };
      case 'removed':
        return { label: t('comparison.diffRemoved') || 'Removed', variant: 'error' };
      case 'changed':
        return { label: t('comparison.diffChanged') || 'Changed', variant: 'warning' };
      case 'type_changed':
        return { label: t('comparison.diffTypeChanged') || 'Type Changed', variant: 'warning' };
      default:
        return { label: diffType, variant: 'default' };
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text">{t('comparison.title')}</h1>
        <p className="text-sm text-muted mt-1">{t('comparison.subtitle')}</p>
      </header>

      {/* Run Selection */}
      <Card className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">{t('comparison.runA')}</label>
            <input
              type="text"
              value={runAId}
              onChange={(e) => updateRunParam('runA', e.target.value)}
              placeholder={t('comparison.enterRunId')}
              className="w-full px-3 py-2 border border-line rounded-lg bg-bg text-sm focus:ring-2 focus:ring-brand focus:border-transparent"
            />
            {runA && (
              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{runA.workflowName}</span>
                  <Badge variant={getStatusBadge(runA.status)}>{runA.status}</Badge>
                </div>
                <div className="text-xs text-muted space-y-1">
                  <div>{t('comparison.createdAt')}: {new Date(runA.startedAt).toLocaleString()}</div>
                  {runA.durationMs && <div>{t('comparison.duration')}: {formatDuration(runA.durationMs)}</div>}
                </div>
                {runA.recoveredFrom && (
                  <button
                    onClick={() => handleViewRun(runA.recoveredFrom!.runId)}
                    className="mt-2 flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    ♻️ From: {runA.recoveredFrom.runId.slice(0, 8)}...
                  </button>
                )}
                {runA.status === 'failed' && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-2"
                    onClick={() => handleRecover(runA.runId, runA.workflowId)}
                  >
                    {t('comparison.recover') || 'Recover'}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">{t('comparison.runB')}</label>
            <input
              type="text"
              value={runBId}
              onChange={(e) => updateRunParam('runB', e.target.value)}
              placeholder={t('comparison.enterRunId')}
              className="w-full px-3 py-2 border border-line rounded-lg bg-bg text-sm focus:ring-2 focus:ring-brand focus:border-transparent"
            />
            {runB && (
              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{runB.workflowName}</span>
                  <Badge variant={getStatusBadge(runB.status)}>{runB.status}</Badge>
                </div>
                <div className="text-xs text-muted space-y-1">
                  <div>{t('comparison.createdAt')}: {new Date(runB.startedAt).toLocaleString()}</div>
                  {runB.durationMs && <div>{t('comparison.duration')}: {formatDuration(runB.durationMs)}</div>}
                </div>
                {runB.recoveredFrom && (
                  <button
                    onClick={() => handleViewRun(runB.recoveredFrom!.runId)}
                    className="mt-2 flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    ♻️ From: {runB.recoveredFrom.runId.slice(0, 8)}...
                  </button>
                )}
                {runB.status === 'failed' && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-2"
                    onClick={() => handleRecover(runB.runId, runB.workflowId)}
                  >
                    {t('comparison.recover') || 'Recover'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {runAId === runBId && runAId && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-700 dark:text-yellow-300">{t('comparison.sameRunWarning')}</p>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={handleCompare}
            disabled={!canCompare || isLoading || isCreatingSession}
          >
            {t('comparison.compare')}
          </Button>
          {sessionId && (
            <Button variant="ghost" onClick={handleClearComparison}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400">
            {t('comparison.error')}: {error instanceof Error ? error.message : String(error)}
          </p>
        </Card>
      )}

      {/* Comparison Results */}
      {comparison && (
        <div className="space-y-6">
          {/* Summary Card - Key for decision making */}
          <SummaryCard summary={comparison.summary} t={t} />

          {/* E2: Structured Workflow Config Diff */}
          {comparison.workflowConfigDiff && (
            <WorkflowConfigDiffCard diff={comparison.workflowConfigDiff} />
          )}

          {/* Workflow Info */}
          {comparison.workflowInfo && !comparison.workflowInfo.isSameWorkflow && (
            <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
              <div className="flex items-start gap-3">
                <span className="text-yellow-600 dark:text-yellow-400 text-lg">⚠️</span>
                <div>
                  <h3 className="font-medium text-yellow-800 dark:text-yellow-200">
                    {t('comparison.differentWorkflows') || 'Different Workflows'}
                  </h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    {t('comparison.differentWorkflowsHint') || 'Comparing runs from different workflows may have limited value.'}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Status Diff */}
          <Card>
            <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
              <span>📊</span> {t('comparison.statusDiff')}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-xs text-muted mb-1">{t('comparison.runA')}: {comparison.runAId}</div>
                <Badge variant={getStatusBadge(comparison.statusDiff.runA)}>{comparison.statusDiff.runA}</Badge>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-xs text-muted mb-1">{t('comparison.runB')}: {comparison.runBId}</div>
                <Badge variant={getStatusBadge(comparison.statusDiff.runB)}>{comparison.statusDiff.runB}</Badge>
              </div>
            </div>
          </Card>

          {/* Input Diff */}
          {comparison.inputDiff && comparison.inputDiff.length > 0 && (
            <Card>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <span>📝</span> {t('comparison.inputDiff') || 'Input Differences'}
              </h2>
              
              {/* Input Summary */}
              {comparison.inputDiffSummary && (
                <div className="mb-4 flex flex-wrap gap-3 text-sm">
                  {comparison.inputDiffSummary.added > 0 && (
                    <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                      +{comparison.inputDiffSummary.added} added
                    </span>
                  )}
                  {comparison.inputDiffSummary.removed > 0 && (
                    <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
                      -{comparison.inputDiffSummary.removed} removed
                    </span>
                  )}
                  {comparison.inputDiffSummary.changed > 0 && (
                    <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                      ~{comparison.inputDiffSummary.changed} changed
                    </span>
                  )}
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-muted rounded">
                    {comparison.inputDiffSummary.unchanged} unchanged
                  </span>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3">{t('comparison.field') || 'Field'}</th>
                      <th className="text-left py-2 px-3">{t('comparison.type') || 'Type'}</th>
                      <th className="text-left py-2 px-3">{t('comparison.runA')}</th>
                      <th className="text-left py-2 px-3">{t('comparison.runB')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.inputDiff.map((diff) => (
                      <InputDiffRow key={diff.field} diff={diff} getDiffTypeBadge={getDiffTypeBadge} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Node Status Diff */}
          {comparison.nodeStatusDiff && comparison.nodeStatusDiff.length > 0 && (
            <Card>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <span>🔀</span> {t('comparison.nodeStatusDiff')}
              </h2>

              {/* Node Summary */}
              {comparison.nodeDiffSummary && (
                <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-center">
                    <div className="text-lg font-semibold">{comparison.nodeDiffSummary.totalNodes}</div>
                    <div className="text-xs text-muted">Total</div>
                  </div>
                  <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded text-center">
                    <div className="text-lg font-semibold text-green-600 dark:text-green-400">{comparison.nodeDiffSummary.identical}</div>
                    <div className="text-xs text-muted">Identical</div>
                  </div>
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-center">
                    <div className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">{comparison.nodeDiffSummary.different}</div>
                    <div className="text-xs text-muted">Different</div>
                  </div>
                  {comparison.nodeDiffSummary.onlyInA > 0 && (
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-center">
                      <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">{comparison.nodeDiffSummary.onlyInA}</div>
                      <div className="text-xs text-muted">Only in A</div>
                    </div>
                  )}
                  {comparison.nodeDiffSummary.onlyInB > 0 && (
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-center">
                      <div className="text-lg font-semibold text-purple-600 dark:text-purple-400">{comparison.nodeDiffSummary.onlyInB}</div>
                      <div className="text-xs text-muted">Only in B</div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {comparison.nodeStatusDiff.map((diff) => (
                  <NodeDiffRow key={diff.nodeId} diff={diff} formatDuration={formatDuration} getStatusBadge={getStatusBadge} />
                ))}
              </div>
            </Card>
          )}

          {/* Duration Diff */}
          {comparison.durationDiff && (
            <Card>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <span>⏱️</span> {t('comparison.durationDiff')}
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
                  <div className="text-2xl font-semibold">{formatDuration(comparison.durationDiff.runA)}</div>
                  <div className="text-xs text-muted mt-1">{t('comparison.runA')}</div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
                  <div className="text-2xl font-semibold">{formatDuration(comparison.durationDiff.runB)}</div>
                  <div className="text-xs text-muted mt-1">{t('comparison.runB')}</div>
                </div>
                <div className={`p-4 rounded-lg text-center ${
                  comparison.durationDiff.delta > 0 
                    ? 'bg-red-50 dark:bg-red-900/20' 
                    : 'bg-green-50 dark:bg-green-900/20'
                }`}>
                  <div className={`text-2xl font-semibold ${
                    comparison.durationDiff.delta > 0 
                      ? 'text-red-600 dark:text-red-400' 
                      : 'text-green-600 dark:text-green-400'
                  }`}>
                    {comparison.durationDiff.delta > 0 ? '+' : ''}{formatDuration(Math.abs(comparison.durationDiff.delta))}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {comparison.durationDiff.percentChange !== undefined && (
                      <span>({comparison.durationDiff.percentChange > 0 ? '+' : ''}{comparison.durationDiff.percentChange.toFixed(1)}%)</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Token Usage Diff */}
          {comparison.tokenUsageDiff && (
            <Card>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <span>💰</span> {t('comparison.tokenUsageDiff')}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3">{t('comparison.metric')}</th>
                      <th className="text-right py-2 px-3">{t('comparison.runA')}</th>
                      <th className="text-right py-2 px-3">{t('comparison.runB')}</th>
                      <th className="text-right py-2 px-3">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-line">
                      <td className="py-2 px-3">{t('comparison.promptTokens')}</td>
                      <td className="text-right py-2 px-3 font-mono">{comparison.tokenUsageDiff.runA.promptTokens?.toLocaleString() || '-'}</td>
                      <td className="text-right py-2 px-3 font-mono">{comparison.tokenUsageDiff.runB.promptTokens?.toLocaleString() || '-'}</td>
                      <td className="text-right py-2 px-3 font-mono">
                        {comparison.tokenUsageDiff.runA.promptTokens !== undefined && comparison.tokenUsageDiff.runB.promptTokens !== undefined
                          ? (comparison.tokenUsageDiff.runA.promptTokens - comparison.tokenUsageDiff.runB.promptTokens).toLocaleString()
                          : '-'}
                      </td>
                    </tr>
                    <tr className="border-b border-line">
                      <td className="py-2 px-3">{t('comparison.completionTokens')}</td>
                      <td className="text-right py-2 px-3 font-mono">{comparison.tokenUsageDiff.runA.completionTokens?.toLocaleString() || '-'}</td>
                      <td className="text-right py-2 px-3 font-mono">{comparison.tokenUsageDiff.runB.completionTokens?.toLocaleString() || '-'}</td>
                      <td className="text-right py-2 px-3 font-mono">
                        {comparison.tokenUsageDiff.runA.completionTokens !== undefined && comparison.tokenUsageDiff.runB.completionTokens !== undefined
                          ? (comparison.tokenUsageDiff.runA.completionTokens - comparison.tokenUsageDiff.runB.completionTokens).toLocaleString()
                          : '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium">{t('comparison.totalTokens')}</td>
                      <td className="text-right py-2 px-3 font-mono font-medium">{comparison.tokenUsageDiff.runA.totalTokens.toLocaleString()}</td>
                      <td className="text-right py-2 px-3 font-mono font-medium">{comparison.tokenUsageDiff.runB.totalTokens.toLocaleString()}</td>
                      <td className="text-right py-2 px-3 font-mono font-medium">
                        {comparison.tokenUsageDiff.delta?.toLocaleString() || '-'}
                        {comparison.tokenUsageDiff.percentChange !== undefined && (
                          <span className="text-xs text-muted ml-1">({comparison.tokenUsageDiff.percentChange.toFixed(1)}%)</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Output Diff */}
          {comparison.outputDiff && comparison.outputDiff.length > 0 && (
            <Card>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <span>📤</span> {t('comparison.outputDiff') || 'Output Differences'}
              </h2>
              <div className="space-y-3">
                {comparison.outputDiff.map((diff) => (
                  <OutputDiffRow key={diff.nodeId} diff={diff} />
                ))}
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => handleViewRun(comparison.runAId)}>
              {t('comparison.viewRunA')}
            </Button>
            <Button variant="secondary" onClick={() => handleViewRun(comparison.runBId)}>
              {t('comparison.viewRunB')}
            </Button>
          </div>
        </div>
      )}

      {!comparison && !isLoading && !error && (
        <Card>
          <div className="text-center py-8">
            <p className="text-sm text-muted">{t('comparison.enterRunIds')}</p>
            <p className="text-xs text-muted mt-2">{t('comparison.hint')}</p>
          </div>
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function SummaryCard({ summary, t }: { summary: ComparisonSummary; t: (key: string) => string }) {
  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <Card className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900">
      <div className="flex flex-col md:flex-row md:items-start gap-6">
        {/* Similarity Score */}
        <div className="text-center md:text-left">
          <div className="text-sm text-muted mb-1">{t('comparison.similarityScore') || 'Similarity Score'}</div>
          <div className={`text-5xl font-bold ${getScoreColor(summary.similarityScore)}`}>
            {summary.similarityScore}
          </div>
          <div className="text-xs text-muted mt-1">{t('comparison.outOf100') || 'out of 100'}</div>
        </div>

        {/* Key Differences, Recommendations, Warnings */}
        <div className="flex-1 space-y-4">
          {summary.keyDifferences.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                <span>🔍</span> {t('comparison.keyDifferences') || 'Key Differences'}
              </h3>
              <ul className="text-sm space-y-1">
                {summary.keyDifferences.map((diff, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted">•</span>
                    <span>{diff}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <span>💡</span> {t('comparison.recommendations') || 'Recommendations'}
              </h3>
              <ul className="text-sm space-y-1">
                {summary.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-blue-500">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.warnings.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <span>⚠️</span> {t('comparison.warnings') || 'Warnings'}
              </h3>
              <ul className="text-sm space-y-1">
                {summary.warnings.map((warn, i) => (
                  <li key={i} className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                    <span>!</span>
                    <span>{warn}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.versionDiffSummary && (
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2 text-purple-600 dark:text-purple-400">
                <span>🧬</span> {t('comparison.versionDiff') || 'Version Diff'}
              </h3>
              <div className="text-sm space-y-1">
                <p>{summary.versionDiffSummary.changeDescription}</p>
                <p className="text-xs text-muted">{summary.versionDiffSummary.impactAssessment}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function WorkflowConfigDiffCard({ diff }: { diff: WorkflowConfigDiff }) {
  const structure = diff.structureDiff;
  return (
    <Card>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
        <span>🧱</span> Workflow Config Diff
      </h2>
      <div className="text-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="text-xs text-muted">Total Changes</div>
            <div className="text-lg font-semibold">{diff.summary.totalChanges}</div>
          </div>
          <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
            <div className="text-xs text-muted">Execution Path</div>
            <div className="text-lg font-semibold text-orange-600 dark:text-orange-400">
              {diff.summary.executionPathChanges}
            </div>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="text-xs text-muted">Output Risk</div>
            <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
              {diff.summary.outputRiskChanges}
            </div>
          </div>
        </div>

        {(structure?.addedNodes?.length || structure?.removedNodes?.length) ? (
          <div className="p-3 border border-line rounded-lg text-xs space-y-1">
            {structure?.addedNodes?.length ? <p>+ Added: {structure.addedNodes.join(', ')}</p> : null}
            {structure?.removedNodes?.length ? <p>- Removed: {structure.removedNodes.join(', ')}</p> : null}
          </div>
        ) : null}

        {diff.nodeDiffs.length > 0 && (
          <div className="space-y-2">
            {diff.nodeDiffs.slice(0, 8).map((node) => (
              <div key={node.nodeId} className="p-3 border border-line rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{node.nodeName || node.nodeId}</span>
                  <Badge variant={node.impactType === 'execution_path' ? 'warning' : node.impactType === 'both' ? 'error' : 'default'}>
                    {node.impactType}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function InputDiffRow({ 
  diff, 
  getDiffTypeBadge 
}: { 
  diff: InputDiff; 
  getDiffTypeBadge: (type: string) => { label: string; variant: 'success' | 'error' | 'warning' | 'default' };
}) {
  const badge = getDiffTypeBadge(diff.diffType);

  const formatValue = (value: unknown): string => {
    if (value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <tr className="border-b border-line hover:bg-gray-50 dark:hover:bg-gray-800">
      <td className="py-2 px-3 font-mono text-sm">{diff.field}</td>
      <td className="py-2 px-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {diff.diffType === 'type_changed' && diff.typeA && diff.typeB && (
          <span className="text-xs text-muted ml-2">
            ({diff.typeA} → {diff.typeB})
          </span>
        )}
      </td>
      <td className="py-2 px-3 font-mono text-sm text-muted">{formatValue(diff.valueA)}</td>
      <td className="py-2 px-3 font-mono text-sm text-muted">{formatValue(diff.valueB)}</td>
    </tr>
  );
}

function NodeDiffRow({ 
  diff, 
  formatDuration, 
  getStatusBadge 
}: { 
  diff: NodeStatusDiff; 
  formatDuration: (ms?: number) => string;
  getStatusBadge: (status: string) => 'success' | 'error' | 'warning' | 'default';
}) {
  return (
    <div className={`p-3 bg-gray-50 dark:bg-gray-800 rounded-lg ${diff.isCritical ? 'ring-2 ring-red-300 dark:ring-red-700' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">{diff.nodeId}</span>
          {diff.isCritical && (
            <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
              Critical
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={getStatusBadge(diff.statusA)}>{diff.statusA}</Badge>
          <span className="text-muted">→</span>
          <Badge variant={getStatusBadge(diff.statusB)}>{diff.statusB}</Badge>
        </div>
      </div>
      
      {diff.durationDiff && (
        <div className="mt-2 text-xs text-muted">
          Duration: {formatDuration(diff.durationDiff.runA)} → {formatDuration(diff.durationDiff.runB)}
          {diff.durationDiff.delta !== undefined && (
            <span className={diff.durationDiff.delta > 0 ? 'text-red-500 ml-2' : 'text-green-500 ml-2'}>
              ({diff.durationDiff.delta > 0 ? '+' : ''}{formatDuration(Math.abs(diff.durationDiff.delta))})
            </span>
          )}
        </div>
      )}

      {(diff.errorA || diff.errorB) && (
        <div className="mt-2 space-y-1">
          {diff.errorA && (
            <div className="text-xs text-red-600 dark:text-red-400">
              Run A error: {diff.errorA}
            </div>
          )}
          {diff.errorB && (
            <div className="text-xs text-red-600 dark:text-red-400">
              Run B error: {diff.errorB}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OutputDiffRow({ diff }: { diff: OutputDiffItem }) {
  return (
    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm">{diff.nodeId}</span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${diff.hasOutputA ? 'bg-green-500' : 'bg-gray-300'}`} title="Run A output" />
          <span className={`w-2 h-2 rounded-full ${diff.hasOutputB ? 'bg-green-500' : 'bg-gray-300'}`} title="Run B output" />
        </div>
      </div>
      {!diff.isIdentical && (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted mb-1">Run A:</div>
            <pre className="bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto whitespace-pre-wrap">
              {diff.previewA || '(no output)'}
            </pre>
          </div>
          <div>
            <div className="text-muted mb-1">Run B:</div>
            <pre className="bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto whitespace-pre-wrap">
              {diff.previewB || '(no output)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
