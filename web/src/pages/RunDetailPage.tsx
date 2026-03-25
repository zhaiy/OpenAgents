import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { runApi, diagnosticsApi, createSSEConnection, type RunEvent, type Step, type DiagnosticsSummary } from '../api';
import { Badge } from '../components/ui/Badge';

type Tab = 'steps' | 'output' | 'logs' | 'eval';

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('steps');
  const [streamBuffer, setStreamBuffer] = useState<Record<string, string>>({});
  const [gateWaiting, setGateWaiting] = useState<{ stepId: string; output: string } | null>(null);
  const [editText, setEditText] = useState('');
  const [isSubmittingGate, setIsSubmittingGate] = useState(false);
  const streamRef = useRef<HTMLPreElement>(null);

  const { data: run, isLoading, refetch } = useApi(() => runId ? runApi.get(runId) : Promise.resolve(null), [runId]);

  // Fetch diagnostics for failed runs - E5 uses failureRecap and sourceRunInfo
  const { data: diagnostics } = useApi(
    () => runId && run?.status === 'failed' ? diagnosticsApi.getRunDiagnostics(runId) : Promise.resolve(null),
    [runId, run?.status]
  );

  useEffect(() => {
    if (!runId) return;
    const es = createSSEConnection(
      runId,
      (event: RunEvent) => {
        if (event.type === 'step.stream' && event.stepId && event.chunk) {
          setStreamBuffer((prev) => ({
            ...prev,
            [event.stepId!]: (prev[event.stepId!] || '') + event.chunk,
          }));
        }
        if (event.type === 'gate.waiting' && event.stepId) {
          setGateWaiting({ stepId: event.stepId, output: (event as Record<string, string>).preview || '' });
          setEditText((event as Record<string, string>).preview || '');
        }
        if (event.type === 'gate.resolved') {
          setGateWaiting(null);
        }
        if (event.type === 'workflow.completed' || event.type === 'workflow.failed') {
          refetch();
        }
        if (event.type === 'step.completed' || event.type === 'step.failed') {
          refetch();
        }
      },
      () => {}
    );
    return () => es.close();
  }, [runId, refetch]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamBuffer]);

  const handleGateAction = async (action: 'approve' | 'reject' | 'edit') => {
    if (!runId || !gateWaiting) return;
    setIsSubmittingGate(true);
    try {
      await runApi.gateAction(runId, gateWaiting.stepId, {
        action,
        editedOutput: action === 'edit' ? editText : undefined,
      });
      setGateWaiting(null);
    } catch (err) {
      console.error('Gate action failed:', err);
    } finally {
      setIsSubmittingGate(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 text-center">
        <p className="text-danger">{t('common.error')}</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'steps', label: t('runDetail.steps') },
    { id: 'output', label: t('runDetail.output') },
    { id: 'logs', label: t('runDetail.logs') },
    { id: 'eval', label: t('runDetail.eval') },
  ];

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'failed':
        return 'badge-danger';
      case 'running':
        return 'badge-brand';
      case 'gate_waiting':
        return 'badge-warning';
      case 'skipped':
        return 'bg-muted/20 text-muted';
      default:
        return 'bg-line text-muted';
    }
  };

  const outputSteps = run.steps.filter((s) => s.output || streamBuffer[s.stepId]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="text-2xl font-semibold text-text">{run.workflowName}</h2>
            <span className={`badge ${getStatusBadgeClass(run.status)}`}>
              {t(`status.${run.status}`)}
            </span>
            {/* Recovered from indicator - E5 */}
            {run.recoveredFrom && (
              <button
                onClick={() => navigate(`/runs/${run.recoveredFrom.runId}`)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-lg transition-colors"
                title={`Recovered from ${run.recoveredFrom.runId}`}
              >
                ♻️ From: {run.recoveredFrom.runId.slice(0, 8)}...
              </button>
            )}
          </div>
          {/* Re-run Actions */}
          <div className="flex items-center gap-2">
            {run.status === 'failed' && (
              <>
                <button
                  onClick={() => navigate('/diagnostics')}
                  className="px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg transition-colors"
                >
                  🔍 {t('runDetail.viewDiagnostics') || 'Diagnostics'}
                </button>
                <button
                  onClick={() => navigate(`/runs/compare?runA=${run.runId}`)}
                  className="px-3 py-1.5 text-sm bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-lg transition-colors"
                >
                  ⚖️ {t('comparison.compare')}
                </button>
              </>
            )}
            <Link
              to={`/workflows/${run.workflowId}/run`}
              state={{ sourceRunId: run.runId }}
              className="px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg transition-colors"
            >
              ↻ {t('rerun.editAndRerun')}
            </Link>
            <button
              onClick={() => navigate(`/runs/${run.runId}/execute`)}
              className="px-3 py-1.5 text-sm bg-panel hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border border-line rounded-lg transition-colors"
            >
              📊 {t('rerun.viewInConsole')}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{t('runDetail.runId')}: {run.runId}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2">
          <div className="bg-panel rounded-xl border border-line overflow-hidden">
            <div className="flex overflow-x-auto border-b border-line">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 sm:px-6 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id ? 'text-brand border-b-2 border-brand' : 'text-muted hover:text-text'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4 sm:p-6">
              {activeTab === 'steps' && (
                <div className="space-y-3">
                  {run.steps.map((step: Step) => (
                    <div key={step.stepId} className="flex items-start gap-4">
                      <div className={`w-3 h-3 mt-1 rounded-full flex-shrink-0 ${
                        step.status === 'completed' ? 'bg-success' :
                        step.status === 'failed' ? 'bg-danger' :
                        step.status === 'running' ? 'bg-brand animate-pulse' :
                        step.status === 'gate_waiting' ? 'bg-warning animate-pulse-slow' :
                        step.status === 'skipped' ? 'bg-muted' :
                        'bg-line'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{step.name}</span>
                          <span className="text-xs text-muted">{t(`status.${step.status}`)}</span>
                        </div>
                        {(streamBuffer[step.stepId] || step.output) && (
                          <pre
                            ref={streamRef}
                            className="mt-2 p-3 bg-bg rounded text-xs font-mono overflow-x-auto max-h-48"
                          >
                            {streamBuffer[step.stepId] || step.output}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'output' && (
                <div className="space-y-4">
                  {outputSteps.map((step: Step) => (
                    <div key={step.stepId} className="border border-line rounded-lg p-4">
                      <h4 className="text-sm font-medium mb-2">{step.name}</h4>
                      <pre className="text-xs font-mono text-muted whitespace-pre-wrap break-words">
                        {streamBuffer[step.stepId] || step.output}
                      </pre>
                    </div>
                  ))}
                  {outputSteps.length === 0 && (
                    <div className="py-8 text-sm text-muted text-center">
                      {t('comparison.noOutputDiff') || 'No output available for this run yet.'}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'logs' && (
                <p className="text-muted text-sm">{t('runDetail.eventsComingSoon')}</p>
              )}

              {activeTab === 'eval' && (
                <p className="text-muted text-sm">{t('runDetail.evalComingSoon')}</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {run.tokenUsage && (
            <div className="bg-panel rounded-xl border border-line p-6">
              <h4 className="text-sm font-medium mb-4">{t('runDetail.tokenUsage')}</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">{t('runDetail.promptTokens')}</span>
                  <span>{run.tokenUsage.promptTokens?.toLocaleString() ?? '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('runDetail.completionTokens')}</span>
                  <span>{run.tokenUsage.completionTokens?.toLocaleString() ?? '-'}</span>
                </div>
                <div className="flex justify-between font-medium pt-2 border-t border-line">
                  <span>{t('runDetail.totalTokens')}</span>
                  <span>{run.tokenUsage.totalTokens.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {run.durationMs && (
            <div className="bg-panel rounded-xl border border-line p-6">
              <h4 className="text-sm font-medium mb-4">{t('runs.duration')}</h4>
              <p className="text-2xl font-semibold">
                {run.durationMs < 1000 ? `${run.durationMs}ms` :
                 run.durationMs < 60000 ? `${(run.durationMs / 1000).toFixed(1)}s` :
                 `${(run.durationMs / 60000).toFixed(1)}m`}
              </p>
            </div>
          )}

          {/* Failure Recap - visible for all failed runs */}
          {run.status === 'failed' && diagnostics?.failureRecap && (
            <div className="bg-panel rounded-xl border border-red-200 dark:border-red-800 p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🧭</span>
                <h4 className="text-sm font-medium">{t('diagnostics.title') || 'Failure Recap'}</h4>
                <Badge variant="error" className="text-xs">
                  {diagnostics.failureRecap.primaryErrorType}
                </Badge>
              </div>
              <p className="text-sm mb-2">{diagnostics.failureRecap.summary}</p>
              <p className="text-xs text-muted mb-3">
                {diagnostics.failureRecap.totalAffectedNodes} affected
                {diagnostics.failureRecap.blocksExecution ? ' · blocks downstream execution' : ''}
              </p>
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-xs text-red-700 dark:text-red-300">
                  💡 {diagnostics.failureRecap.insight}
                </p>
              </div>
            </div>
          )}

          {/* Recovery Context - E5: source linkage */}
          {(run.recoveredFrom || diagnostics?.sourceRunInfo) && (
            <div className="bg-panel rounded-xl border border-purple-200 dark:border-purple-800 p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">♻️</span>
                <h4 className="text-sm font-medium">{t('runDetail.recoveredFrom') || 'Recovery Context'}</h4>
                {diagnostics?.sourceRunInfo && (
                  <Badge variant="default" className="text-xs">
                    {diagnostics.sourceRunInfo.relationship}
                  </Badge>
                )}
              </div>

              <div className="space-y-2 text-sm">
                {/* Source Run Link - prefer sourceRunInfo */}
                {diagnostics?.sourceRunInfo ? (
                  <button
                    onClick={() => navigate(`/runs/${diagnostics.sourceRunInfo.sourceRunId}`)}
                    className="block w-full text-left px-3 py-2 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/40 rounded-lg transition-colors"
                  >
                    <div className="text-xs text-muted mb-1">Source Run</div>
                    <div className="font-mono text-xs truncate">{diagnostics.sourceRunInfo.sourceRunId}</div>
                  </button>
                ) : run.recoveredFrom ? (
                  <button
                    onClick={() => navigate(`/runs/${run.recoveredFrom.runId}`)}
                    className="block w-full text-left px-3 py-2 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/40 rounded-lg transition-colors"
                  >
                    <div className="text-xs text-muted mb-1">Source Run</div>
                    <div className="font-mono text-xs truncate">{run.recoveredFrom.runId}</div>
                  </button>
                ) : null}

                {/* Step counts - prefer sourceRunInfo */}
                <div className="flex items-center gap-2 text-xs text-muted">
                  {diagnostics?.sourceRunInfo ? (
                    <>
                      <span>Reused: {diagnostics.sourceRunInfo.reusedStepCount} steps</span>
                      <span>·</span>
                      <span>Re-run: {diagnostics.sourceRunInfo.rerunStepCount} steps</span>
                    </>
                  ) : run.recoveredFrom ? (
                    <>
                      <span>Reused: {run.recoveredFrom.reusedStepIds.length} steps</span>
                      <span>·</span>
                      <span>Re-run: {run.recoveredFrom.rerunStepIds.length} steps</span>
                    </>
                  ) : null}
                </div>

              </div>
            </div>
          )}
        </div>
      </div>

      {gateWaiting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-panel rounded-xl border border-line max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold mb-4">{t('runDetail.gateWaiting')}</h3>
            <pre className="p-4 bg-bg rounded text-sm font-mono mb-6 max-h-48 overflow-auto">
              {gateWaiting.output}
            </pre>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={4}
              className="w-full p-3 bg-bg border border-line rounded text-sm font-mono mb-6 resize-none"
              placeholder={t('runDetail.editPlaceholder')}
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => handleGateAction('approve')}
                disabled={isSubmittingGate}
                className="flex-1 px-4 py-2.5 bg-success text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {t('runDetail.approve')}
              </button>
              <button
                onClick={() => handleGateAction('reject')}
                disabled={isSubmittingGate}
                className="flex-1 px-4 py-2.5 bg-danger text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {t('runDetail.reject')}
              </button>
              <button
                onClick={() => handleGateAction('edit')}
                disabled={isSubmittingGate}
                className="flex-1 px-4 py-2.5 bg-brand text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {t('runDetail.edit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
