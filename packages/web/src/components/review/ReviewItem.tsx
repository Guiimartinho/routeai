import { useProjectStore } from '../../stores/projectStore';
import type { ReviewItem as ReviewItemType } from '../../types/review';
import {
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Info,
  MapPin,
  Lightbulb,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';

interface ReviewItemProps {
  item: ReviewItemType;
}

const severityConfig: Record<string, { icon: typeof AlertOctagon; color: string; bgColor: string }> = {
  critical: { icon: AlertOctagon, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  error: { icon: AlertTriangle, color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  warning: { icon: AlertCircle, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  info: { icon: Info, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
};

const categoryLabels: Record<string, string> = {
  drc: 'DRC',
  clearance: 'Clearance',
  trace_width: 'Trace Width',
  via: 'Via',
  thermal: 'Thermal',
  signal_integrity: 'Signal Integrity',
  power_integrity: 'Power Integrity',
  manufacturing: 'Manufacturing',
  placement: 'Placement',
  routing: 'Routing',
  impedance: 'Impedance',
  emi: 'EMI/EMC',
  best_practice: 'Best Practice',
};

export default function ReviewItemCard({ item }: ReviewItemProps) {
  const [expanded, setExpanded] = useState(false);
  const navigateTo = useProjectStore((s) => s.navigateTo);
  const setSelectedElement = useProjectStore((s) => s.setSelectedElement);

  const severity = severityConfig[item.severity] ?? severityConfig.info;
  const Icon = severity.icon;

  const handleLocationClick = () => {
    if (item.location) {
      navigateTo(item.location.x, item.location.y, 30);
      if (item.location.elementIds?.[0]) {
        setSelectedElement(item.location.elementIds[0], 'review');
      }
    }
  };

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        item.severity === 'critical'
          ? 'border-red-500/30'
          : item.severity === 'error'
          ? 'border-orange-500/30'
          : item.severity === 'warning'
          ? 'border-yellow-500/30'
          : 'border-blue-500/30'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-start gap-2 p-3 text-left ${severity.bgColor} hover:brightness-110 transition-all`}
      >
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${severity.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${severity.color} uppercase`}>
              {item.severity}
            </span>
            <span className="text-[10px] text-gray-500 px-1.5 py-0.5 rounded bg-gray-800/50">
              {categoryLabels[item.category] ?? item.category}
            </span>
          </div>
          <p className="text-sm text-gray-200 mt-1 line-clamp-2">{item.title}</p>
        </div>
        <div className="shrink-0 mt-1">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="p-3 bg-gray-900/50 space-y-3 text-sm">
          {/* Description */}
          <p className="text-gray-300 leading-relaxed">{item.message}</p>

          {/* Location */}
          {item.location && (
            <button
              onClick={handleLocationClick}
              className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              <MapPin className="w-3 h-3" />
              Go to location ({item.location.x.toFixed(1)}, {item.location.y.toFixed(1)})
              {item.location.layer && (
                <span className="text-gray-500 ml-1">on {item.location.layer}</span>
              )}
            </button>
          )}

          {/* Related components/nets */}
          {((item.relatedComponents?.length ?? 0) > 0 || (item.relatedNets?.length ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {item.relatedComponents?.map((ref) => (
                <span
                  key={ref}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700"
                >
                  {ref}
                </span>
              ))}
              {item.relatedNets?.map((net) => (
                <span
                  key={net}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700"
                >
                  {net}
                </span>
              ))}
            </div>
          )}

          {/* Suggestion */}
          {item.suggestion && (
            <div className="flex items-start gap-2 p-2 rounded bg-emerald-500/5 border border-emerald-500/20">
              <Lightbulb className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-300">{item.suggestion}</p>
            </div>
          )}

          {/* Citation */}
          {item.citation && (
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <BookOpen className="w-3 h-3 mt-0.5 shrink-0" />
              <p className="italic">{item.citation}</p>
            </div>
          )}

          {/* Auto-fix */}
          {item.autoFixAvailable && (
            <button className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
              <Wrench className="w-3 h-3" />
              Auto-fix available
            </button>
          )}
        </div>
      )}
    </div>
  );
}
