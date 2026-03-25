/**
 * HomePage - T24 (Workbench Upgrade)
 *
 * Upgraded to a workbench dashboard with:
 * - Needs Attention section (failed runs + waiting gates)
 * - Quick actions
 * - Recent runs
 * - Environment status
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { runApi, diagnosticsApi, type WorkflowQualitySummary } from '../api';
import { Badge } from '../components/ui/Badge';

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: runs, isLoading: runsLoading } = useApi(() => runApi.list());
  const { data: failedRuns, isLoading: failedLoading } = useApi(() => diagnosticsApi.getFailedRuns());
  const { data: waitingGates, isLoading: gatesLoading } = useApi(() => diagnosticsApi.getWaitingGates());
  const { data: qualitySummaries, isLoading: qualityLoading } = useApi(() => diagnosticsApi.listWorkflowQualitySummaries(10));

  const needsAttention = (failedRuns?.length || 0) + (waitingGates?.length || 0);
  const isLoading = runsLoading || failedLoading || gatesLoading || qualityLoading;

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'failed':
        return 'badge-danger';
      case 'running':
        return 'badge-brand';
      case 'interrupted':
        return 'badge-warning';
      default:
        return 'bg-line text-muted';
    }
  };

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

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 80) return 'text-green-600 dark:text-green-400';
    if (rate >= 60) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <section className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-text mb-2">{t('home.title')}</h1>
        <p className="text-muted text-base">{t('home.subtitle')}</p>
      </section>

      {/* Needs Attention Section */}
      {needsAttention > 0 && (
        <section className="mb-8">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <h2 className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">
                  {t('diagnostics.needsAttention')}
                </h2>
                <Badge variant="warning">{needsAttention}</Badge>
              </div>
              <button
                onClick={() => navigate('/diagnostics')}
                className="text-sm text-yellow-700 dark:text-yellow-300 hover:underline"
              >
                {t('diagnostics.title')} →
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Failed Runs */}
              {failedRuns && failedRuns.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-yellow-100 dark:border-yellow-900">
                  <h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                    🔴 {t('diagnostics.failedRunsTab')} ({failedRuns.length})
                  </h3>
                  <div className="space-y-2">
                    {failedRuns.slice(0, 3).map((run) => (
                      <div key={run.runId} className="flex items-center justify-between">
                        <button
                          onClick={() => navigate(`/runs/${run.runId}`)}
                          className="text-sm text-muted hover:text-text truncate max-w-[180px]"
                        >
                          {run.workflowId}
                        </button>
                        <button
                          onClick={() => navigate(`/runs/${run.runId}/execute`)}
                          className="text-xs text-red-600 dark:text-red-400 hover:underline ml-2"
                        >
                          {t('diagnostics.viewRun')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Waiting Gates */}
              {waitingGates && waitingGates.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-yellow-100 dark:border-yellow-900">
                  <h3 className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-2">
                    🚧 {t('diagnostics.waitingGatesTab')} ({waitingGates.length})
                  </h3>
                  <div className="space-y-2">
                    {waitingGates.slice(0, 3).map((gate) => (
                      <div key={`${gate.runId}-${gate.stepId}`} className="flex items-center justify-between">
                        <button
                          onClick={() => navigate(`/runs/${gate.runId}/execute`)}
                          className="text-sm text-muted hover:text-text truncate max-w-[180px]"
                        >
                          {gate.workflowId}
                        </button>
                        <button
                          onClick={() => navigate(`/runs/${gate.runId}/execute`)}
                          className="text-xs text-yellow-600 dark:text-yellow-400 hover:underline ml-2"
                        >
                          {t('diagnostics.handleGate')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="mb-8">
        <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">{t('home.quickActions')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => navigate('/workflows')}
            className="btn-primary px-4 py-3 text-left"
          >
            <span className="block text-lg mb-1">▶</span>
            <span className="text-sm font-medium">{t('home.runTemplate')}</span>
          </button>
          <button
            onClick={() => navigate('/runs')}
            className="btn-secondary px-4 py-3 text-left"
          >
            <span className="block text-lg mb-1">📋</span>
            <span className="text-sm font-medium">{t('runs.title')}</span>
          </button>
          <button
            onClick={() => navigate('/diagnostics')}
            className="btn-secondary px-4 py-3 text-left"
          >
            <span className="block text-lg mb-1">🔍</span>
            <span className="text-sm font-medium">{t('diagnostics.title')}</span>
          </button>
          <button
            onClick={() => navigate('/runs/compare')}
            className="btn-secondary px-4 py-3 text-left"
          >
            <span className="block text-lg mb-1">⚖️</span>
            <span className="text-sm font-medium">{t('comparison.title')}</span>
          </button>
        </div>
      </section>

      {/* Quality Trends - E3 */}
      {qualitySummaries && qualitySummaries.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted uppercase tracking-wide">
              {t('home.qualityTrends') || 'Quality Trends'}
            </h3>
            <button
              onClick={() => navigate('/workflows')}
              className="text-sm text-brand hover:underline"
            >
              {t('home.viewAllWorkflows') || 'View workflows'} →
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {qualitySummaries.slice(0, 6).map((summary: WorkflowQualitySummary) => {
              const trend = getTrendIcon(summary.evalSummary?.trend);
              return (
                <div
                  key={summary.workflowId}
                  className="bg-panel rounded-xl border border-line p-4 hover:border-brand/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/workflows/${summary.workflowId}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h4 className="font-medium text-sm truncate flex-1 mr-2">
                      {summary.workflowName || summary.workflowId}
                    </h4>
                    <span className={`text-lg ${trend.color}`} title={trend.label}>
                      {trend.icon}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">Success Rate</span>
                      <span className={`text-sm font-medium ${getSuccessRateColor(summary.successRate)}`}>
                        {summary.successRate.toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          summary.successRate >= 80 ? 'bg-green-500' :
                          summary.successRate >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${summary.successRate}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{summary.successCount}/{summary.totalRuns} runs</span>
                      {summary.avgDurationMs && (
                        <span>Avg: {formatDuration(summary.avgDurationMs)}</span>
                      )}
                    </div>
                    {summary.failureCount > 0 && (
                      <div className="flex items-center gap-2 pt-1 border-t border-line">
                        <Badge variant="error" className="text-xs">
                          {summary.failureCount} failed
                        </Badge>
                        {summary.failureTypes[0] && (
                          <span className="text-xs text-muted truncate">
                            {summary.failureTypes[0].errorType}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {qualitySummaries.length > 6 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => navigate('/workflows')}
                className="text-sm text-brand hover:underline"
              >
                {t('home.moreWorkflows') || `+${qualitySummaries.length - 6} more workflows`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Recent Runs */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-muted uppercase tracking-wide">{t('home.recentRuns')}</h3>
          <button
            onClick={() => navigate('/runs')}
            className="text-sm text-brand hover:underline"
          >
            {t('diagnostics.allRuns')} →
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : runs && runs.length > 0 ? (
          <div className="bg-panel rounded-xl border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line text-left text-sm text-muted">
                    <th className="px-4 py-3 font-medium">{t('runs.status')}</th>
                    <th className="px-4 py-3 font-medium">{t('runs.workflow')}</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">{t('runs.createdAt')}</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">{t('runs.duration')}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {runs.slice(0, 5).map((run) => (
                    <tr key={run.runId} className="hover:bg-bg/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`badge ${getStatusBadgeClass(run.status)}`}>
                          {t(`status.${run.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">{run.workflowName}</td>
                      <td className="px-4 py-3 text-sm text-muted hidden sm:table-cell">
                        {formatDate(run.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted hidden sm:table-cell">
                        {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {run.status === 'running' && (
                            <button
                              onClick={() => navigate(`/runs/${run.runId}/execute`)}
                              className="text-xs text-brand hover:underline"
                            >
                              📊 {t('rerun.viewInConsole')}
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/runs/${run.runId}`)}
                            className="text-xs text-muted hover:text-text"
                          >
                            {t('runs.viewDetail')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 bg-panel rounded-lg border border-line">
            <svg className="w-12 h-12 mx-auto text-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-muted">{t('home.noRuns')}</p>
            <button
              onClick={() => navigate('/workflows')}
              className="mt-4 text-sm text-brand hover:underline"
            >
              {t('home.runTemplate')}
            </button>
          </div>
        )}
      </section>

      {/* Quick Links */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/workflows')}
          className="bg-panel border border-line rounded-xl p-4 text-left hover:border-brand/30 transition-colors"
        >
          <h3 className="font-medium mb-1">{t('diagnostics.workflows')}</h3>
          <p className="text-sm text-muted">{t('diagnostics.workflowsDesc')}</p>
        </button>
        <button
          onClick={() => navigate('/runs')}
          className="bg-panel border border-line rounded-xl p-4 text-left hover:border-brand/30 transition-colors"
        >
          <h3 className="font-medium mb-1">{t('diagnostics.allRuns')}</h3>
          <p className="text-sm text-muted">{t('diagnostics.allRunsDesc')}</p>
        </button>
      </section>
    </div>
  );
}
