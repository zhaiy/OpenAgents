/**
 * WorkflowRunPage - T17/T23/N3/N6
 *
 * Workflow run configuration page with support for:
 * - Normal workflow execution (text/JSON input)
 * - Re-run from previous config
 * - Edit and re-run with modified config
 * - From Previous Run mode (T17 enhancement)
 * - Draft save/load (T17 draft CRUD)
 * - Pre-run summary (T17 pre-run confirmation)
 * - Field validation (T17 input validation)
 * - Unified error handling (N3)
 * - Rerun diff preview (N6)
 */
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useApi } from '../hooks/useApi';
import { useApiError } from '../hooks/useApiError';
import { workflowApi, runApi, draftApi, visualApi, ApiError } from '../api';
import type { ConfigDraft, InputSchemaField } from '../api';
import { NotFoundState } from '../components/ui/NotFoundState';
import { ErrorState } from '../components/ui/ErrorState';
import { RecoveryPreviewPanel } from '../components/panels/RecoveryPreviewPanel';

type InputMode = 'text' | 'json' | 'fromPrevious' | 'draft';
const DEFAULT_RUNTIME_OPTIONS_KEY = 'openagents.defaultRuntimeOptions';

export default function WorkflowRunPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // Unified error handling (N3)
  const { error, isError, setError, clearError } = useApiError();

  // Check if this is a rerun (from previous run config)
  const sourceRunId = location.state?.sourceRunId as string | undefined;
  // Check if this is a recovery (M3)
  const isRecoveryMode = location.state?.mode === 'recovery';

  const [inputMode, setInputMode] = useState<InputMode>('json');
  const [input, setInput] = useState('');
  const [inputJson, setInputJson] = useState('{}');
  const [streaming, setStreaming] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [noEval, setNoEval] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isRerun, setIsRerun] = useState(false);
  const [sourceRunNotFound, setSourceRunNotFound] = useState(false);

  // Draft state (T17)
  const [showPreRunSummary, setShowPreRunSummary] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // Fetch workflow visual summary for schema info (T17)
  const { data: workflowVisual } = useApi(
    () => workflowId ? visualApi.getWorkflowSummary(workflowId) : Promise.resolve(null),
    [workflowId]
  );

  // Fetch saved drafts (T17)
  const { data: drafts, isLoading: draftsLoading, refetch: refetchDrafts } = useApi(
    () => workflowId ? draftApi.list(workflowId) : Promise.resolve([]),
    [workflowId]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DEFAULT_RUNTIME_OPTIONS_KEY);
      if (!raw) return;
      const defaults = JSON.parse(raw) as { stream?: boolean; autoApprove?: boolean; noEval?: boolean };
      if (typeof defaults.stream === 'boolean') setStreaming(defaults.stream);
      if (typeof defaults.autoApprove === 'boolean') setAutoApprove(defaults.autoApprove);
      if (typeof defaults.noEval === 'boolean') setNoEval(defaults.noEval);
    } catch {
      // Ignore invalid persisted settings
    }
  }, []);

  // Validate input against schema (T17)
  const validateInput = useCallback((): string | null => {
    if (inputMode === 'text' || inputMode === 'fromPrevious' || inputMode === 'draft') return null;

    const schema = workflowVisual?.inputSchemaSummary;
    if (!schema?.fields?.length) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(inputJson);
    } catch {
      return null; // JSON parse error is handled separately
    }

    // Check required fields
    for (const field of schema.fields) {
      if (field.required && (parsed[field.name] === undefined || parsed[field.name] === null || parsed[field.name] === '')) {
        return `Missing required field: ${field.name}`;
      }
    }

    return null;
  }, [inputMode, inputJson, workflowVisual]);

  const validationError = validateInput();

  // Fetch workflow info
  const { data: workflow } = useApi(
    () => workflowId ? workflowApi.get(workflowId) : Promise.resolve(null),
    [workflowId]
  );

  // Fetch past runs for "From Previous Run" mode
  const { data: pastRuns, isLoading: pastRunsLoading } = useApi(
    () => workflowId ? runApi.list({ workflowId }) : Promise.resolve([]),
    [workflowId]
  );

  // Fetch reusable config if this is a rerun
  const { data: reusableConfig } = useApi(
    async () => {
      if (!sourceRunId) return null;
      try {
        const config = await runApi.getReusableConfig(sourceRunId);
        return config;
      } catch (err) {
        // Handle run not found (S11)
        if (err instanceof ApiError && err.code === 'NOT_FOUND') {
          setSourceRunNotFound(true);
        }
        return null;
      }
    },
    [sourceRunId]
  );

  // Fetch recovery preview if in recovery mode (M3)
  const { data: recoveryPreview } = useApi(
    () => sourceRunId && isRecoveryMode ? runApi.getRecoveryPreview(sourceRunId) : Promise.resolve(null),
    [sourceRunId, isRecoveryMode]
  );

  // Pre-fill form when reusable config is loaded
  useEffect(() => {
    if (reusableConfig) {
      setInputJson(JSON.stringify(reusableConfig.inputData || {}, null, 2));
      setInputMode('json');
      setIsRerun(true);

      // Set runtime options
      if (reusableConfig.runtimeOptions) {
        const opts = reusableConfig.runtimeOptions as Record<string, unknown>;
        if (typeof opts.stream === 'boolean') setStreaming(opts.stream);
        if (typeof opts.autoApprove === 'boolean') setAutoApprove(opts.autoApprove);
        if (typeof opts.noEval === 'boolean') setNoEval(opts.noEval);
      }
    }
  }, [reusableConfig]);

  const handleJsonChange = (value: string) => {
    setInputJson(value);
    if (inputMode === 'json') {
      try {
        JSON.parse(value);
        setJsonError(null);
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
      }
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    // For JSON mode, show pre-run summary instead of direct submit (T17)
    if (inputMode === 'json' && !jsonError) {
      handleOpenPreRunSummary();
      return;
    }
    if (!workflowId || (inputMode === 'json' && jsonError)) return;

    // Recovery mode submission (M3)
    if (isRecoveryMode && sourceRunId) {
      setIsSubmitting(true);
      try {
        let inputData: Record<string, unknown> | undefined;
        if (inputMode === 'json') {
          try {
            inputData = JSON.parse(inputJson);
          } catch {
            inputData = {};
          }
        }

        const result = await runApi.recover(sourceRunId, {
          sourceRunId,
          inputData,
          runtimeOptions: { stream: streaming, autoApprove, noEval },
        });
        navigate(`/runs/${result.newRunId}/execute`);
      } catch (err) {
        setError(err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Normal submission
    setIsSubmitting(true);
    try {
      let inputData: Record<string, unknown> | undefined;
      if (inputMode === 'json') {
        try {
          inputData = JSON.parse(inputJson);
        } catch {
          inputData = {};
        }
      }

      const result = await runApi.start({
        workflowId,
        input: inputMode === 'text' ? input : undefined,
        inputData,
        stream: streaming,
        autoApprove,
        noEval,
      });
      navigate(`/runs/${result.runId}/execute`);
    } catch (err) {
      // Unified error handling (N3)
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle quick rerun (same config)
  const handleQuickRerun = async () => {
    if (!sourceRunId) return;
    clearError();
    setIsSubmitting(true);
    try {
      const result = await runApi.rerun(sourceRunId);
      navigate(`/runs/${result.runId}/execute`);
    } catch (err) {
      // Unified error handling (N3)
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle selecting a past run to rerun
  const handleSelectPastRun = (runId: string) => {
    navigate(`/workflows/${workflowId}/run`, { state: { sourceRunId: runId }, replace: true });
  };

  // Handle selecting a draft to load (T17)
  const handleSelectDraft = (draft: ConfigDraft) => {
    setInputMode('json');
    setInputJson(JSON.stringify(draft.inputData || {}, null, 2));
    if (draft.runtimeOptions) {
      const opts = draft.runtimeOptions as Record<string, unknown>;
      if (typeof opts.stream === 'boolean') setStreaming(opts.stream);
      if (typeof opts.autoApprove === 'boolean') setAutoApprove(opts.autoApprove);
      if (typeof opts.noEval === 'boolean') setNoEval(opts.noEval);
    }
    setDraftName(draft.name);
    setSelectedDraftId(draft.draftId);
  };

  // Handle save draft (T17)
  const handleSaveDraft = async () => {
    if (!workflowId || !draftName.trim()) return;
    setIsSavingDraft(true);
    try {
      let inputData: Record<string, unknown> = {};
      try {
        inputData = JSON.parse(inputJson);
      } catch {
        // ignore
      }
      if (selectedDraftId) {
        await draftApi.update(workflowId, selectedDraftId, {
          name: draftName.trim(),
          inputData,
          runtimeOptions: { stream: streaming, autoApprove, noEval },
        });
      } else {
        await draftApi.create(workflowId, {
          name: draftName.trim(),
          inputData,
          runtimeOptions: { stream: streaming, autoApprove, noEval },
        });
      }
      await refetchDrafts();
      setDraftName('');
      setSelectedDraftId(null);
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Handle delete draft (T17)
  const handleDeleteDraft = async (draftId: string) => {
    if (!workflowId) return;
    try {
      await draftApi.delete(workflowId, draftId);
      if (selectedDraftId === draftId) {
        setSelectedDraftId(null);
        setDraftName('');
      }
      await refetchDrafts();
    } catch (err) {
      console.error('Failed to delete draft:', err);
    }
  };

  // Open pre-run summary modal
  const handleOpenPreRunSummary = () => {
    if (inputMode === 'json' && jsonError) return;
    setShowPreRunSummary(true);
  };

  // Handle actual submission from pre-run modal
  const handleConfirmRun = async () => {
    setShowPreRunSummary(false);
    await handleSubmitInternal();
  };

  // Internal submit handler (T17)
  const handleSubmitInternal = async () => {
    if (!workflowId || (inputMode === 'json' && jsonError)) return;
    setIsSubmitting(true);
    clearError();
    try {
      let inputData: Record<string, unknown> | undefined;
      if (inputMode === 'json') {
        try {
          inputData = JSON.parse(inputJson);
        } catch {
          inputData = {};
        }
      }

      const result = await runApi.start({
        workflowId,
        input: inputMode === 'text' ? input : undefined,
        inputData,
        stream: streaming,
        autoApprove,
        noEval,
      });
      navigate(`/runs/${result.runId}/execute`);
    } catch (err) {
      // Unified error handling (N3)
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  // Handle workflow not found (S11)
  if (workflowId && !workflow && !reusableConfig) {
    // Check if we're still loading
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Handle source run not found for rerun (S11)
  if (sourceRunNotFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <NotFoundState type="run" identifier={sourceRunId} />
      </div>
    );
  }

  // Handle workflow not found (S11)
  if (!workflow && !reusableConfig) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <NotFoundState type="workflow" identifier={workflowId} />
      </div>
    );
  }

  const workflowName = reusableConfig ? `${workflow?.name || 'Workflow'} (Rerun)` : workflow?.name || '';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-text">{t('runForm.title')}</h2>
          <p className="text-muted mt-1">{workflowName}</p>
        </div>
        {sourceRunId && reusableConfig && (
          <button
            onClick={() => navigate(`/runs/${sourceRunId}`)}
            className="text-sm text-muted hover:text-text"
          >
            ← {t('rerun.viewOriginal')}
          </button>
        )}
      </div>

      {/* Rerun Banner */}
      {isRerun && sourceRunId && reusableConfig && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-medium text-blue-900 dark:text-blue-100">
                {t('rerun.rerunConfig')}
              </h3>
              <div className="mt-2 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p>
                  <span className="font-medium">{t('rerun.sourceRun')}: </span>
                  <span className="font-mono text-xs">{sourceRunId}</span>
                </p>
                <p>
                  <span className="font-medium">{t('rerun.originalStatus')}: </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    reusableConfig.runStatus === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                    reusableConfig.runStatus === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                  }`}>
                    {reusableConfig.runStatus}
                  </span>
                </p>
                <p>
                  <span className="font-medium">{t('rerun.originalDuration')}: </span>
                  {formatDuration(reusableConfig.durationMs)}
                </p>
              </div>
              {reusableConfig.runStatus === 'failed' && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ {t('rerun.failedWarning')}
                </p>
              )}
            </div>
            <button
              onClick={handleQuickRerun}
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isSubmitting ? t('rerun.running') : t('rerun.rerunSame')}
            </button>
          </div>
        </div>
      )}

      {/* Recovery Preview Panel - M3 */}
      {isRecoveryMode && sourceRunId && (
        <div className="mb-6">
          <RecoveryPreviewPanel
            runId={sourceRunId}
            initialPreview={recoveryPreview ? {
              reusedCount: recoveryPreview.reusedSteps?.length ?? 0,
              rerunCount: recoveryPreview.rerunSteps?.length ?? 0,
              invalidatedCount: recoveryPreview.invalidatedSteps?.length ?? 0,
              riskLevel: recoveryPreview.riskLevel ?? 'medium',
              summary: recoveryPreview.summary ?? '',
            } : undefined}
            expanded={true}
            compact={false}
          />
        </div>
      )}

      {/* Error State (N3) */}
      {isError && (
        <div className="mb-6">
          <ErrorState
            code={error?.code}
            message={error?.message}
            details={error?.details}
            onRetry={clearError}
            showHomeButton={false}
          />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
            <span className="text-sm font-medium">{t('runForm.inputMode')}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInputMode('text')}
                className={`px-3 py-1.5 text-sm rounded ${
                  inputMode === 'text' ? 'bg-brand text-white' : 'bg-panel border border-line'
                }`}
              >
                {t('runForm.plainText')}
              </button>
              <button
                type="button"
                onClick={() => setInputMode('json')}
                className={`px-3 py-1.5 text-sm rounded ${
                  inputMode === 'json' ? 'bg-brand text-white' : 'bg-panel border border-line'
                }`}
              >
                {t('runForm.json')}
              </button>
              <button
                type="button"
                onClick={() => setInputMode('fromPrevious')}
                className={`px-3 py-1.5 text-sm rounded ${
                  inputMode === 'fromPrevious' ? 'bg-brand text-white' : 'bg-panel border border-line'
                }`}
              >
                {t('runForm.fromPrevious')}
              </button>
              <button
                type="button"
                onClick={() => setInputMode('draft')}
                className={`px-3 py-1.5 text-sm rounded ${
                  inputMode === 'draft' ? 'bg-brand text-white' : 'bg-panel border border-line'
                }`}
              >
                {t('runForm.fromDraft') || 'Draft'}
              </button>
            </div>
            {isRerun && (
              <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">
                {t('rerun.editable')}
              </span>
            )}
          </div>

          {inputMode === 'fromPrevious' ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">{t('runForm.fromPreviousHint')}</p>
              {pastRunsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              ) : pastRuns && pastRuns.length > 0 ? (
                <div className="border border-line rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-panel border-b border-line">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted">{t('runs.status')}</th>
                        <th className="px-3 py-2 text-left font-medium text-muted">{t('runs.createdAt')}</th>
                        <th className="px-3 py-2 text-left font-medium text-muted hidden sm:table-cell">{t('runs.duration')}</th>
                        <th className="px-3 py-2 text-right font-medium text-muted"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pastRuns.slice(0, 10).map((run) => (
                        <tr key={run.runId} className="hover:bg-panel/50">
                          <td className="px-3 py-2">
                            <span className={`badge ${
                              run.status === 'completed' ? 'badge-success' :
                              run.status === 'failed' ? 'badge-danger' :
                              run.status === 'running' ? 'badge-brand' : 'bg-line text-muted'
                            }`}>
                              {t(`status.${run.status}`)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted">{formatDate(run.startedAt)}</td>
                          <td className="px-3 py-2 text-muted hidden sm:table-cell">{formatDuration(run.durationMs)}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleSelectPastRun(run.runId)}
                              className="text-xs text-brand hover:underline"
                            >
                              {t('runs.useAsBase')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted text-center py-4">{t('runForm.noPastRuns')}</p>
              )}
            </div>
          ) : inputMode === 'text' ? (
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('runForm.inputPlaceholder')}
              rows={6}
              className="input resize-none"
            />
          ) : inputMode === 'draft' ? (
            // Draft mode: manage and load saved drafts (T17)
            <div className="space-y-4">
              {/* Save current as draft */}
              <div className="border border-line rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-medium">{t('runForm.saveAsDraft') || 'Save Current as Draft'}</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder={t('runForm.draftNamePlaceholder') || 'Draft name...'}
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={isSavingDraft || !draftName.trim()}
                    className="btn-secondary"
                  >
                    {isSavingDraft
                      ? t('common.loading')
                      : selectedDraftId
                        ? (t('common.update') || 'Update')
                        : (t('common.save') || 'Save')}
                  </button>
                </div>
              </div>

              {/* Draft list */}
              <div>
                <h4 className="text-sm font-medium mb-2">{t('runForm.savedDrafts') || 'Saved Drafts'}</h4>
                {draftsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : drafts && drafts.length > 0 ? (
                  <div className="border border-line rounded-lg divide-y divide-line">
                    {drafts.map((draft) => (
                      <div key={draft.draftId} className="p-3 flex items-center justify-between hover:bg-panel/50">
                        <div className="flex-1">
                          <p className="text-sm font-medium">{draft.name}</p>
                          <p className="text-xs text-muted">
                            {formatDate(draft.createdAt)}
                            {draft.inputData && Object.keys(draft.inputData).length > 0 && (
                              <span> · {Object.keys(draft.inputData).length} fields</span>
                            )}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectDraft(draft)}
                            className="text-xs text-brand hover:underline"
                          >
                            {t('common.load') || 'Load'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDraft(draft.draftId)}
                            className="text-xs text-danger hover:underline"
                          >
                            {t('common.delete') || 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted text-center py-4">{t('runForm.noDrafts') || 'No saved drafts'}</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <textarea
                value={inputJson}
                onChange={(e) => handleJsonChange(e.target.value)}
                placeholder="{}"
                rows={8}
                className={`input resize-none font-mono text-sm ${jsonError ? 'border-danger' : ''}`}
              />
              {jsonError && (
                <p className="mt-2 text-sm text-danger">{jsonError}</p>
              )}
              {validationError && !jsonError && (
                <p className="mt-2 text-sm text-warning">{validationError}</p>
              )}
            </div>
          )}
        </div>

        <details className="group">
          <summary className="text-sm font-medium text-muted cursor-pointer hover:text-text list-none flex items-center gap-2">
            <span className="transition-transform group-open:rotate-90">▶</span>
            {t('runForm.options')}
          </summary>
          <div className="mt-4 space-y-3 pl-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={streaming}
                onChange={(e) => setStreaming(e.target.checked)}
                className="w-4 h-4 rounded border-line text-brand focus:ring-brand"
              />
              <span className="text-sm">{t('runForm.enableStreaming')}</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                className="w-4 h-4 rounded border-line text-brand focus:ring-brand"
              />
              <span className="text-sm">{t('runForm.autoApproveGates')}</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={noEval}
                onChange={(e) => setNoEval(e.target.checked)}
                className="w-4 h-4 rounded border-line text-brand focus:ring-brand"
              />
              <span className="text-sm">{t('runForm.skipEval')}</span>
            </label>
          </div>
        </details>

        <button
          type="submit"
          disabled={isSubmitting || (inputMode === 'json' && (!!jsonError || !!validationError)) || inputMode === 'fromPrevious' || inputMode === 'draft'}
          className="w-full btn-primary py-3 disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t('runForm.running')}
            </span>
          ) : isRerun ? t('rerun.runWithChanges') : t('runForm.submit')}
        </button>
      </form>

      {/* Pre-run Summary Modal (T17) */}
      {showPreRunSummary && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-panel rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">{t('runForm.preRunSummary') || 'Pre-run Summary'}</h3>

            <div className="space-y-4 text-sm">
              <div className="border border-line rounded-lg p-3">
                <p className="text-muted mb-1">{t('runForm.workflow') || 'Workflow'}</p>
                <p className="font-medium">{workflow?.name || workflowId}</p>
              </div>

              {workflowVisual?.inputSchemaSummary?.fields && workflowVisual.inputSchemaSummary.fields.length > 0 && (
                <div className="border border-line rounded-lg p-3">
                  <p className="text-muted mb-2">{t('runForm.inputFields') || 'Input Fields'}</p>
                  <ul className="space-y-1">
                    {workflowVisual.inputSchemaSummary.fields.map((field: InputSchemaField) => (
                      <li key={field.name} className="flex items-center gap-2">
                        <span className={field.required ? 'text-danger' : 'text-muted'}>
                          {field.required ? '*' : '○'}
                        </span>
                        <span className="font-mono text-xs">{field.name}</span>
                        <span className="text-muted text-xs">({field.type})</span>
                        {field.description && <span className="text-muted text-xs truncate">- {field.description}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border border-line rounded-lg p-3">
                <p className="text-muted mb-1">{t('runForm.runtimeOptions') || 'Runtime Options'}</p>
                <div className="flex flex-wrap gap-2">
                  <span className={`badge ${streaming ? 'badge-success' : 'bg-line text-muted'}`}>
                    {streaming ? '✓' : '✗'} Streaming
                  </span>
                  <span className={`badge ${autoApprove ? 'badge-success' : 'bg-line text-muted'}`}>
                    {autoApprove ? '✓' : '✗'} Auto-approve Gates
                  </span>
                  <span className={`badge ${noEval ? 'badge-warning' : 'bg-line text-muted'}`}>
                    {noEval ? '✓' : '✗'} Skip Eval
                  </span>
                </div>
              </div>

              {workflowVisual && (
                <div className="flex gap-4 text-xs text-muted">
                  <span>{workflowVisual.nodeCount} nodes</span>
                  {workflowVisual.gateCount > 0 && <span>{workflowVisual.gateCount} gates</span>}
                  {workflowVisual.evalCount > 0 && <span>{workflowVisual.evalCount} evals</span>}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowPreRunSummary(false)}
                className="flex-1 btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmRun}
                disabled={isSubmitting}
                className="flex-1 btn-primary"
              >
                {t('runForm.confirmRun') || 'Confirm & Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
