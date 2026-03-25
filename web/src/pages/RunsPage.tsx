/**
 * RunsPage - T26/N3
 *
 * Upgraded with:
 * - Status filter
 * - Workflow filter
 * - Time filter
 * - Quick rerun with error handling (N3)
 * - Quick compare entry
 * - Failed/gate badges
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { runApi, workflowApi, diagnosticsApi, ApiError, type WorkflowQualitySummary } from '../api';

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'interrupted';
type TimeFilter = 'all' | 'today' | 'week' | 'month';

export default function RunsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: runs, isLoading, refetch } = useApi(() => runApi.list());
  const { data: workflows } = useApi(() => workflowApi.list());
  const { data: qualitySummaries } = useApi(() => diagnosticsApi.listWorkflowQualitySummaries(10));

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [workflowFilter, setWorkflowFilter] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [compareRunA, setCompareRunA] = useState<string>('');
  const [compareRunB, setCompareRunB] = useState<string>('');
  const [rerunError, setRerunError] = useState<{ runId: string; message: string } | null>(null);

  // Filter runs
  const filteredRuns = useMemo(() => {
    if (!runs) return [];

    return runs.filter((run) => {
      // Status filter
      if (statusFilter !== 'all' && run.status !== statusFilter) return false;

      // Workflow filter
      if (workflowFilter !== 'all' && run.workflowId !== workflowFilter) return false;

      // Time filter
      if (timeFilter !== 'all') {
        const runDate = new Date(run.startedAt);
        const now = new Date();
        if (timeFilter === 'today') {
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (runDate < today) return false;
        } else if (timeFilter === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (runDate < weekAgo) return false;
        } else if (timeFilter === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (runDate < monthAgo) return false;
        }
      }

      return true;
    });
  }, [runs, statusFilter, workflowFilter, timeFilter]);

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

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

  const handleQuickRerun = async (runId: string) => {
    setRerunError(null);
    try {
      const nextRun = await runApi.rerun(runId);
      refetch();
      navigate(`/runs/${nextRun.runId}/execute`);
    } catch (err) {
      // Enhanced error handling (N3/S7)
      if (err instanceof ApiError) {
        if (err.code === 'NOT_FOUND') {
          setRerunError({ runId, message: t('errors.runNotFound') || 'Run not found' });
        } else {
          setRerunError({ runId, message: err.message || t('errors.rerunFailed') || 'Rerun failed' });
        }
      } else {
        setRerunError({ runId, message: t('errors.rerunFailed') || 'Rerun failed' });
      }
    }
  };

  const handleCompare = () => {
    if (compareRunA && compareRunB && compareRunA !== compareRunB) {
      navigate(`/runs/compare?runA=${compareRunA}&runB=${compareRunB}`);
    }
  };

  // Clear rerun error
  const clearRerunError = () => setRerunError(null);

  // Get unique workflows for filter
  const uniqueWorkflows = useMemo(() => {
    if (!runs || !workflows) return [];
    const workflowIds = [...new Set(runs.map((r) => r.workflowId))];
    return workflows.filter((w) => workflowIds.includes(w.id));
  }, [runs, workflows]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold text-text">{t('runs.title')}</h2>

        {/* Compare Section */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={compareRunA}
            onChange={(e) => setCompareRunA(e.target.value)}
            placeholder={t('comparison.runA')}
            className="px-3 py-1.5 bg-panel border border-line rounded-lg text-xs w-28 focus:outline-none focus:ring-2 focus:ring-brand/50"
          />
          <span className="text-muted">vs</span>
          <input
            type="text"
            value={compareRunB}
            onChange={(e) => setCompareRunB(e.target.value)}
            placeholder={t('comparison.runB')}
            className="px-3 py-1.5 bg-panel border border-line rounded-lg text-xs w-28 focus:outline-none focus:ring-2 focus:ring-brand/50"
          />
          <button
            onClick={handleCompare}
            disabled={!compareRunA || !compareRunB || compareRunA === compareRunB}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ⚖️ {t('comparison.compare')}
          </button>
        </div>
      </div>

      {/* Rerun Error (N3) */}
      {rerunError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {t('errors.rerunFailed') || 'Rerun Failed'}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {rerunError.message} (Run: {rerunError.runId})
            </p>
          </div>
          <button
            onClick={clearRerunError}
            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 bg-panel border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
        >
          <option value="all">{t('runs.filterAllStatus')}</option>
          <option value="running">{t('status.running')}</option>
          <option value="completed">{t('status.completed')}</option>
          <option value="failed">{t('status.failed')}</option>
          <option value="interrupted">{t('status.interrupted')}</option>
        </select>

        {/* Workflow filter */}
        <select
          value={workflowFilter}
          onChange={(e) => setWorkflowFilter(e.target.value)}
          className="px-3 py-2 bg-panel border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
        >
          <option value="all">{t('runs.filterAllWorkflows')}</option>
          {uniqueWorkflows.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        {/* Time filter */}
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
          className="px-3 py-2 bg-panel border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
        >
          <option value="all">{t('runs.filterAllTime')}</option>
          <option value="today">{t('runs.filterToday')}</option>
          <option value="week">{t('runs.filterWeek')}</option>
          <option value="month">{t('runs.filterMonth')}</option>
        </select>

        {/* Results count */}
        {runs && (
          <span className="text-sm text-muted self-center ml-auto">
            {t('runs.resultsCount').replace('{count}', String(filteredRuns.length))}
          </span>
        )}
      </div>

      {/* Quality Trend Summary - E3 */}
      {qualitySummaries && qualitySummaries.length > 0 && (
        <div className="mb-6 p-4 bg-panel rounded-xl border border-line">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">{t('runs.qualityTrends') || 'Quality Trends'}</h3>
            <button
              onClick={() => navigate('/diagnostics')}
              className="text-xs text-brand hover:underline"
            >
              {t('diagnostics.viewAll') || 'View diagnostics'} →
            </button>
          </div>
          <div className="flex flex-wrap gap-4">
            {qualitySummaries.slice(0, 4).map((qs: WorkflowQualitySummary) => (
              <div
                key={qs.workflowId}
                className="flex items-center gap-3 min-w-[200px] cursor-pointer hover:bg-bg/50 rounded-lg p-2 -m-2 transition-colors"
                onClick={() => navigate(`/workflows/${qs.workflowId}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{qs.workflowName || qs.workflowId}</span>
                    {qs.evalSummary?.trend === 'declined' && (
                      <span className="text-xs text-red-600 dark:text-red-400" title="Declining">↘</span>
                    )}
                    {qs.evalSummary?.trend === 'improving' && (
                      <span className="text-xs text-green-600 dark:text-green-400" title="Improving">↗</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className={qs.successRate >= 80 ? 'text-green-600 dark:text-green-400' : qs.successRate >= 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}>
                      {qs.successRate.toFixed(0)}%
                    </span>
                    <span>{qs.totalRuns} runs</span>
                  </div>
                </div>
                {qs.failureCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
                    {qs.failureCount} failed
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredRuns.length > 0 ? (
        <div className="bg-panel rounded-xl border border-line overflow-hidden">
          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left text-sm text-muted">
                  <th className="px-4 py-3 font-medium">{t('runs.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('runs.workflow')}</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">{t('runs.createdAt')}</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">{t('runs.duration')}</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('runs.score')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRuns.map((run) => (
                  <tr key={run.runId} className="hover:bg-bg/50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`badge ${getStatusBadgeClass(run.status)}`}>
                          {t(`status.${run.status}`)}
                        </span>
                        {run.status === 'failed' && (
                          <button
                            onClick={() => navigate('/diagnostics')}
                            className="text-xs text-red-600 dark:text-red-400 hover:underline"
                          >
                            🔍
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => navigate(`/workflows/${run.workflowId}`)}
                        className="text-sm font-medium hover:text-brand"
                      >
                        {run.workflowName}
                      </button>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted hidden md:table-cell">
                      {formatDate(run.startedAt)}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted hidden md:table-cell">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      {run.score !== undefined ? (
                        <span className={run.score >= 0.8 ? 'text-green-600 dark:text-green-400' : run.score >= 0.5 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}>
                          {(run.score * 100).toFixed(0)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {run.status === 'interrupted' && (
                          <button
                            onClick={() => runApi.resume(run.runId).then(() => navigate(`/runs/${run.runId}`))}
                            className="btn-primary px-3 py-1.5 text-sm"
                          >
                            {t('runs.resume')}
                          </button>
                        )}
                        <button
                          onClick={() => handleQuickRerun(run.runId)}
                          className="btn-secondary px-3 py-1.5 text-sm"
                          title={t('runs.quickRerun')}
                        >
                          ↻
                        </button>
                        <button
                          onClick={() => navigate(`/runs/${run.runId}`)}
                          className="btn-secondary px-3 py-1.5 text-sm"
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

          {/* Mobile card view */}
          <div className="sm:hidden divide-y divide-line">
            {filteredRuns.map((run) => (
              <div key={run.runId} className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${getStatusBadgeClass(run.status)}`}>
                      {t(`status.${run.status}`)}
                    </span>
                    <span className="text-sm font-medium">{run.workflowName}</span>
                  </div>
                  <span className="text-xs text-muted">{formatDate(run.startedAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted space-x-3">
                    <span>{formatDuration(run.durationMs)}</span>
                    {run.score !== undefined && (
                      <span className={run.score >= 0.8 ? 'text-green-600' : run.score >= 0.5 ? 'text-yellow-600' : 'text-red-600'}>
                        {(run.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {run.status === 'interrupted' && (
                      <button
                        onClick={() => runApi.resume(run.runId).then(() => navigate(`/runs/${run.runId}`))}
                        className="btn-primary px-3 py-1.5 text-sm"
                      >
                        {t('runs.resume')}
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/runs/${run.runId}`)}
                      className="btn-secondary px-3 py-1.5 text-sm"
                    >
                      {t('runs.viewDetail')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : runs && runs.length > 0 ? (
        <div className="text-center py-12 bg-panel rounded-lg border border-line">
          <p className="text-muted">{t('runs.noFilteredResults')}</p>
          <button
            onClick={() => { setStatusFilter('all'); setWorkflowFilter('all'); setTimeFilter('all'); }}
            className="mt-4 text-sm text-brand hover:underline"
          >
            {t('runs.clearFilters')}
          </button>
        </div>
      ) : (
        <div className="text-center py-16 bg-panel rounded-lg border border-line">
          <svg className="w-12 h-12 mx-auto text-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-muted">{t('runs.empty')}</p>
        </div>
      )}
    </div>
  );
}
