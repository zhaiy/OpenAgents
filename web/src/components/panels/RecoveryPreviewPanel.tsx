/**
 * RecoveryPreviewPanel - M3
 *
 * Shared component for displaying recovery preview information.
 * Used by DiagnosticsPage, WorkflowRunPage, and RunComparisonPage
 * to provide consistent preview and risk indication before recovery.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { useApi } from '../../hooks/useApi';
import { runApi } from '../../api';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

export interface RecoveryPreviewPanelProps {
  /** Source run ID to recover from */
  runId: string;
  /** Initial preview data if already loaded (e.g., from diagnostics) */
  initialPreview?: {
    reusedCount: number;
    rerunCount: number;
    invalidatedCount: number;
    riskLevel: 'low' | 'medium' | 'high';
    summary: string;
  };
  /** Callback when recovery is confirmed */
  onRecover?: (newRunId: string) => void;
  /** Show expanded details */
  expanded?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

/**
 * Get badge variant for risk level
 */
function getRiskBadge(riskLevel: 'low' | 'medium' | 'high'): 'success' | 'warning' | 'error' {
  switch (riskLevel) {
    case 'low':
      return 'success';
    case 'medium':
      return 'warning';
    case 'high':
      return 'error';
  }
}

/**
 * Get icon for step type
 */
function getStepTypeIcon(type: 'reused' | 'rerun' | 'invalidated' | 'at_risk'): string {
  switch (type) {
    case 'reused':
      return '✓';
    case 'rerun':
      return '↻';
    case 'invalidated':
      return '⚠';
    case 'at_risk':
      return '?';
  }
}

/**
 * RecoveryPreviewPanel - Displays recovery preview with risk indication
 */
export function RecoveryPreviewPanel({
  runId,
  initialPreview,
  onRecover,
  expanded = false,
  compact = false,
}: RecoveryPreviewPanelProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isRecovering, setIsRecovering] = useState(false);
  const [showDetails, setShowDetails] = useState(expanded);

  // Fetch detailed recovery preview from API
  const { data: detailedPreview, isLoading: previewLoading } = useApi(
    () => runApi.getRecoveryPreview(runId),
    [runId]
  );

  // Use initial preview for quick display, detailed preview when expanded
  const preview = detailedPreview || initialPreview;
  const isLoading = previewLoading && !preview;

  // Handle recovery action
  const handleRecover = async () => {
    setIsRecovering(true);
    try {
      const result = await runApi.recover(runId, { sourceRunId: runId });
      if (onRecover) {
        onRecover(result.newRunId);
      } else {
        navigate(`/runs/${result.newRunId}/execute`);
      }
    } catch (error) {
      console.error('Recovery failed:', error);
      setIsRecovering(false);
    }
  };

  // Navigate to workflow run page with recovery
  const handleViewRecovery = () => {
    const workflowId = detailedPreview?.workflow?.workflowId || '';
    navigate(`/workflows/${workflowId}/run`, {
      state: { sourceRunId: runId, mode: 'recovery' },
    });
  };

  if (!preview && !isLoading) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className={compact ? 'p-3' : 'p-4'}>
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-sm text-muted">Loading preview...</span>
        </div>
      </Card>
    );
  }

  const riskLevel = preview?.riskLevel || 'medium';
  const reusedCount = initialPreview?.reusedCount ?? detailedPreview?.reusedSteps?.length ?? 0;
  const rerunCount = initialPreview?.rerunCount ?? detailedPreview?.rerunSteps?.length ?? 0;
  const invalidatedCount = initialPreview?.invalidatedCount ?? detailedPreview?.invalidatedSteps?.length ?? 0;

  return (
    <Card className={`${compact ? 'p-3' : 'p-4'} border-l-4 ${
      riskLevel === 'high' ? 'border-l-red-500' :
      riskLevel === 'medium' ? 'border-l-yellow-500' :
      'border-l-green-500'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium">{t('recovery.previewTitle') || 'Recovery Preview'}</h3>
            <Badge variant={getRiskBadge(riskLevel)}>
              {riskLevel === 'low' ? (t('recovery.riskLow') || 'Low Risk') :
               riskLevel === 'medium' ? (t('recovery.riskMedium') || 'Medium Risk') :
               (t('recovery.riskHigh') || 'High Risk')}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            {preview?.summary || initialPreview?.summary || t('recovery.computing') || 'Computing...'}
          </p>
        </div>

        {!compact && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleRecover}
            disabled={isRecovering || isLoading}
          >
            {isRecovering ? (
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t('recovery.recovering') || 'Recovering...'}
              </span>
            ) : (
              t('recovery.startRecovery') || 'Start Recovery'
            )}
          </Button>
        )}
      </div>

      {/* Step Summary */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <span className="text-green-600 dark:text-green-400 font-medium">{getStepTypeIcon('reused')}</span>
          <span className="text-sm">
            <span className="font-semibold">{reusedCount}</span>
            <span className="text-muted ml-1">{t('recovery.stepsReused') || 'reused'}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <span className="text-blue-600 dark:text-blue-400 font-medium">{getStepTypeIcon('rerun')}</span>
          <span className="text-sm">
            <span className="font-semibold">{rerunCount}</span>
            <span className="text-muted ml-1">{t('recovery.stepsRerun') || 'to rerun'}</span>
          </span>
        </div>

        {invalidatedCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">{getStepTypeIcon('invalidated')}</span>
            <span className="text-sm">
              <span className="font-semibold">{invalidatedCount}</span>
              <span className="text-muted ml-1">{t('recovery.stepsInvalidated') || 'may change'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Detailed Preview (when expanded) */}
      {showDetails && detailedPreview && (
        <div className="mt-4 space-y-4">
          {/* Reused Steps */}
          {detailedPreview.reusedSteps && detailedPreview.reusedSteps.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <span className="text-green-500">{getStepTypeIcon('reused')}</span>
                {t('recovery.reusedSteps') || 'Steps to Reuse'}
              </h4>
              <div className="space-y-1">
                {detailedPreview.reusedSteps.map((step) => (
                  <div key={step.stepId} className="flex items-center gap-2 text-sm pl-6">
                    <span className="font-mono text-xs text-muted">{step.stepId}</span>
                    {step.stepName && <span className="text-muted">({step.stepName})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rerun Steps */}
          {detailedPreview.rerunSteps && detailedPreview.rerunSteps.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <span className="text-blue-500">{getStepTypeIcon('rerun')}</span>
                {t('recovery.rerunSteps') || 'Steps to Re-run'}
              </h4>
              <div className="space-y-1">
                {detailedPreview.rerunSteps.map((step) => (
                  <div key={step.stepId} className="flex items-center gap-2 text-sm pl-6">
                    <span className="font-mono text-xs text-muted">{step.stepId}</span>
                    {step.stepName && <span className="text-muted">({step.stepName})</span>}
                    <span className="text-xs text-muted">- {step.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {detailedPreview.warnings && detailedPreview.warnings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <span className="text-yellow-500">⚠</span>
                {t('recovery.warnings') || 'Warnings'}
              </h4>
              <div className="space-y-1">
                {detailedPreview.warnings.map((warning, idx) => (
                  <div key={idx} className="text-sm pl-6 text-yellow-700 dark:text-yellow-300">
                    {warning.description}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions Footer */}
      <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-sm text-muted hover:text-text flex items-center gap-1"
        >
          {showDetails ? '▲' : '▼'} {showDetails ? 'Hide' : 'Show'} details
        </button>

        {compact && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleViewRecovery}
          >
            {t('recovery.viewFullPreview') || 'View Full Preview'}
          </Button>
        )}
      </div>
    </Card>
  );
}

export default RecoveryPreviewPanel;
