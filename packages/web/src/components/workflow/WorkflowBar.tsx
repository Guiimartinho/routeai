/**
 * WorkflowBar - Horizontal progress bar showing all design stages.
 *
 * Displays each stage with status icon, clickable navigation, pulsing
 * indicator for the active stage, and brief status text.
 */

import { useCallback } from 'react';
import {
  FileText,
  Search,
  Download,
  LayoutGrid,
  Route,
  ShieldCheck,
  Factory,
  Check,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useWorkflowStore, type StageInfo, type WorkflowStageId } from '../../stores/workflowStore';

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const STAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  Search,
  Download,
  LayoutGrid,
  Route,
  ShieldCheck,
  Factory,
};

// ---------------------------------------------------------------------------
// Stage badge component
// ---------------------------------------------------------------------------

interface StageBadgeProps {
  stage: StageInfo;
  index: number;
  total: number;
  isCurrent: boolean;
  onClick: () => void;
}

function StageBadge({ stage, index, total, isCurrent, onClick }: StageBadgeProps) {
  const Icon = STAGE_ICONS[stage.icon] || FileText;

  const statusColors: Record<string, string> = {
    pending: 'border-gray-700 bg-gray-900 text-gray-500',
    active: 'border-brand-500 bg-brand-900/30 text-brand-400',
    completed: 'border-emerald-600 bg-emerald-900/20 text-emerald-400',
    error: 'border-red-600 bg-red-900/20 text-red-400',
  };

  const connectorColors: Record<string, string> = {
    pending: 'bg-gray-700',
    active: 'bg-brand-500',
    completed: 'bg-emerald-600',
    error: 'bg-red-600',
  };

  const renderStatusIcon = () => {
    switch (stage.status) {
      case 'completed':
        return <Check className="w-3 h-3" />;
      case 'error':
        return <AlertTriangle className="w-3 h-3" />;
      case 'active':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      default:
        return <Icon className="w-3 h-3" />;
    }
  };

  return (
    <div className="flex items-center">
      <button
        onClick={onClick}
        className={`flex flex-col items-center gap-1 group relative ${
          stage.status === 'pending' ? 'cursor-default' : 'cursor-pointer'
        }`}
        title={`${stage.name}: ${stage.description}`}
      >
        {/* Circle badge */}
        <div
          className={`relative w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${statusColors[stage.status]} ${
            isCurrent ? 'ring-2 ring-brand-500/30 ring-offset-1 ring-offset-gray-950' : ''
          } ${stage.status !== 'pending' ? 'group-hover:scale-110' : ''}`}
        >
          {renderStatusIcon()}

          {/* Pulsing indicator for active stage */}
          {isCurrent && stage.status === 'active' && (
            <span className="absolute inset-0 rounded-full border-2 border-brand-400 animate-ping opacity-30" />
          )}
        </div>

        {/* Label */}
        <span
          className={`text-[10px] font-medium whitespace-nowrap transition-colors ${
            isCurrent ? 'text-brand-300' : stage.status === 'completed' ? 'text-emerald-400' : stage.status === 'error' ? 'text-red-400' : 'text-gray-500'
          } ${stage.status !== 'pending' ? 'group-hover:text-gray-200' : ''}`}
        >
          {stage.name}
        </span>
      </button>

      {/* Connector line */}
      {index < total - 1 && (
        <div className="flex items-center mx-1.5 -mt-4">
          <div
            className={`h-0.5 w-6 md:w-10 lg:w-14 rounded-full transition-colors duration-300 ${
              stage.status === 'completed' ? connectorColors.completed : connectorColors.pending
            }`}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkflowBar() {
  const stages = useWorkflowStore((s) => s.stages);
  const currentStage = useWorkflowStore((s) => s.currentStage);
  const overallProgress = useWorkflowStore((s) => s.overallProgress);
  const goToStage = useWorkflowStore((s) => s.goToStage);

  const handleStageClick = useCallback(
    (stageId: WorkflowStageId, status: string) => {
      // Allow clicking completed or active stages, not pending ones
      if (status !== 'pending') {
        goToStage(stageId);
      }
    },
    [goToStage],
  );

  return (
    <div className="bg-gray-900/80 border-b border-gray-800 backdrop-blur-sm">
      {/* Progress track */}
      <div className="h-0.5 bg-gray-800">
        <div
          className="h-full bg-gradient-to-r from-brand-600 to-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${overallProgress}%` }}
        />
      </div>

      {/* Stage badges */}
      <div className="flex items-center justify-center py-2.5 px-4 overflow-x-auto">
        {stages.map((stage, idx) => (
          <StageBadge
            key={stage.id}
            stage={stage}
            index={idx}
            total={stages.length}
            isCurrent={currentStage === stage.id}
            onClick={() => handleStageClick(stage.id, stage.status)}
          />
        ))}
      </div>
    </div>
  );
}
