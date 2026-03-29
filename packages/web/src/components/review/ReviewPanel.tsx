import { useState, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import ReviewItemCard from './ReviewItem';
import type { Severity, Category } from '../../types/review';
import {
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Filter,
  Loader2,
} from 'lucide-react';

const severityOptions: { value: Severity; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
  { value: 'error', label: 'Error', color: 'text-orange-400' },
  { value: 'warning', label: 'Warning', color: 'text-yellow-400' },
  { value: 'info', label: 'Info', color: 'text-blue-400' },
];

const categoryOptions: { value: Category; label: string }[] = [
  { value: 'drc', label: 'DRC' },
  { value: 'clearance', label: 'Clearance' },
  { value: 'trace_width', label: 'Trace Width' },
  { value: 'via', label: 'Via' },
  { value: 'thermal', label: 'Thermal' },
  { value: 'signal_integrity', label: 'Signal Integrity' },
  { value: 'power_integrity', label: 'Power Integrity' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'placement', label: 'Placement' },
  { value: 'routing', label: 'Routing' },
  { value: 'impedance', label: 'Impedance' },
  { value: 'emi', label: 'EMI/EMC' },
  { value: 'best_practice', label: 'Best Practice' },
];

export default function ReviewPanel() {
  const reviewResult = useProjectStore((s) => s.reviewResult);
  const reviewLoading = useProjectStore((s) => s.reviewLoading);

  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<Category>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const filteredItems = useMemo(() => {
    if (!reviewResult) return [];
    return reviewResult.items.filter((item) => {
      if (severityFilter.size > 0 && !severityFilter.has(item.severity)) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(item.category)) return false;
      return true;
    });
  }, [reviewResult, severityFilter, categoryFilter]);

  const toggleSeverity = (s: Severity) => {
    const next = new Set(severityFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSeverityFilter(next);
  };

  const toggleCategory = (c: Category) => {
    const next = new Set(categoryFilter);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCategoryFilter(next);
  };

  // Loading state
  if (reviewLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        <p className="text-sm text-gray-400">Running AI review...</p>
        <p className="text-xs text-gray-600">This may take a minute.</p>
      </div>
    );
  }

  // No review yet
  if (!reviewResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <AlertCircle className="w-10 h-10 text-gray-700" />
        <p className="text-sm text-gray-400">No review results yet.</p>
        <p className="text-xs text-gray-600">
          Click "Run Review" to start an AI-powered analysis of your PCB design.
        </p>
      </div>
    );
  }

  const { score, totalIssues, criticalCount, errorCount, warningCount, infoCount, summary } =
    reviewResult;
  const passed = criticalCount === 0 && errorCount === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary */}
      <div className="p-4 border-b border-gray-800 shrink-0">
        {/* Score + Pass/Fail */}
        <div className="flex items-center gap-4 mb-3">
          <div className="text-center">
            <div
              className={`text-3xl font-bold ${
                score >= 80
                  ? 'text-emerald-400'
                  : score >= 60
                  ? 'text-yellow-400'
                  : score >= 40
                  ? 'text-orange-400'
                  : 'text-red-400'
              }`}
            >
              {score}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Score</div>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              {passed ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-400">PASS</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">FAIL</span>
                </>
              )}
            </div>
            <p className="text-xs text-gray-400 line-clamp-2">{summary}</p>
          </div>
        </div>

        {/* Issue counts */}
        <div className="grid grid-cols-4 gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <AlertOctagon className="w-3 h-3 text-red-400" />
            <span className="text-red-400 font-semibold">{criticalCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <AlertTriangle className="w-3 h-3 text-orange-400" />
            <span className="text-orange-400 font-semibold">{errorCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <AlertCircle className="w-3 h-3 text-yellow-400" />
            <span className="text-yellow-400 font-semibold">{warningCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Info className="w-3 h-3 text-blue-400" />
            <span className="text-blue-400 font-semibold">{infoCount}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {filteredItems.length} of {totalIssues} issues
          </span>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 text-xs transition-colors ${
              showFilters || severityFilter.size > 0 || categoryFilter.size > 0
                ? 'text-brand-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Filter className="w-3 h-3" />
            Filters
            {(severityFilter.size > 0 || categoryFilter.size > 0) && (
              <span className="bg-brand-600 text-white text-[9px] px-1 rounded-full">
                {severityFilter.size + categoryFilter.size}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-2">
            {/* Severity toggles */}
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Severity</p>
              <div className="flex flex-wrap gap-1">
                {severityOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleSeverity(opt.value)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                      severityFilter.has(opt.value)
                        ? `${opt.color} border-current bg-current/10`
                        : 'text-gray-600 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category toggles */}
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Category</p>
              <div className="flex flex-wrap gap-1">
                {categoryOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleCategory(opt.value)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                      categoryFilter.has(opt.value)
                        ? 'text-brand-400 border-brand-500/50 bg-brand-500/10'
                        : 'text-gray-600 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {(severityFilter.size > 0 || categoryFilter.size > 0) && (
              <button
                onClick={() => {
                  setSeverityFilter(new Set());
                  setCategoryFilter(new Set());
                }}
                className="text-[10px] text-gray-500 hover:text-gray-300"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Issues list */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-600">
            No issues match the current filters.
          </div>
        ) : (
          filteredItems.map((item) => <ReviewItemCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}
