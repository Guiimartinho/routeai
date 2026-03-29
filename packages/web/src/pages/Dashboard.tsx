import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useProjectStore } from '../stores/projectStore';
import Header from '../components/common/Header';
import UploadZone from '../components/upload/UploadZone';
import {
  CircuitBoard,
  Clock,
  Trash2,
  ChevronRight,
  Zap,
  BarChart3,
  Cpu,
  Star,
} from 'lucide-react';
import type { Project } from '../types/api';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: Project['status']) {
  const map: Record<string, { label: string; className: string }> = {
    uploading: { label: 'Uploading', className: 'bg-blue-500/20 text-blue-400' },
    parsing: { label: 'Parsing', className: 'bg-yellow-500/20 text-yellow-400' },
    ready: { label: 'Ready', className: 'bg-green-500/20 text-green-400' },
    reviewing: { label: 'Reviewing', className: 'bg-purple-500/20 text-purple-400' },
    reviewed: { label: 'Reviewed', className: 'bg-emerald-500/20 text-emerald-400' },
    error: { label: 'Error', className: 'bg-red-500/20 text-red-400' },
  };
  const s = map[status] || { label: status, className: 'bg-gray-500/20 text-gray-400' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}

function scoreColor(score?: number): string {
  if (score === undefined || score === null) return 'text-gray-500';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { projects, projectsLoading, fetchProjects, deleteProject } = useProjectStore();
  const [showUpload, setShowUpload] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    setDeletingId(id);
    try {
      await deleteProject(id);
    } finally {
      setDeletingId(null);
    }
  };

  const reviewsUsed = user?.reviewsUsed ?? 0;
  const reviewsLimit = user?.reviewsLimit ?? 5;
  const usagePercent = reviewsLimit > 0 ? (reviewsUsed / reviewsLimit) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="card flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-600/20">
              <CircuitBoard className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Projects</p>
              <p className="text-xl font-semibold">{projects.length}</p>
            </div>
          </div>

          <div className="card flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-600/20">
              <BarChart3 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Reviews Used</p>
              <p className="text-xl font-semibold">
                {reviewsUsed} / {reviewsLimit}
              </p>
            </div>
          </div>

          <div className="card flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-600/20">
              <Cpu className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Avg Score</p>
              <p className="text-xl font-semibold">
                {projects.filter((p) => p.lastReviewScore != null).length > 0
                  ? Math.round(
                      projects
                        .filter((p) => p.lastReviewScore != null)
                        .reduce((acc, p) => acc + (p.lastReviewScore ?? 0), 0) /
                        projects.filter((p) => p.lastReviewScore != null).length
                    )
                  : '--'}
              </p>
            </div>
          </div>

          <div className="card flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-600/20">
              <Star className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Tier</p>
              <p className="text-xl font-semibold capitalize">{user?.tier ?? 'Free'}</p>
            </div>
          </div>
        </div>

        {/* Usage bar + upgrade CTA for free tier */}
        {user?.tier === 'free' && (
          <div className="card mb-8 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-400">Review usage</span>
                <span className="text-sm text-gray-300">
                  {reviewsUsed} / {reviewsLimit}
                </span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {reviewsLimit - reviewsUsed} reviews remaining this month
              </p>
            </div>
            <button className="btn-primary flex items-center gap-2 whitespace-nowrap">
              <Zap className="w-4 h-4" />
              Upgrade to Pro
            </button>
          </div>
        )}

        {/* Header row */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Your Projects</h2>
          <button onClick={() => setShowUpload(true)} className="btn-primary">
            Upload Design
          </button>
        </div>

        {/* Upload zone */}
        {showUpload && (
          <div className="mb-6">
            <UploadZone
              onUploadComplete={(projectId) => {
                setShowUpload(false);
                navigate(`/projects/${projectId}`);
              }}
              onCancel={() => setShowUpload(false)}
            />
          </div>
        )}

        {/* Projects list */}
        {projectsLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <CircuitBoard className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-gray-400 mb-2">No projects yet</h3>
            <p className="text-gray-500 mb-6">Upload your first PCB design to get started.</p>
            <button onClick={() => setShowUpload(true)} className="btn-primary">
              Upload Design
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="card hover:border-gray-700 cursor-pointer transition-all duration-150 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate group-hover:text-brand-400 transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5 uppercase">{project.format}</p>
                  </div>
                  {statusBadge(project.status)}
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">Layers</p>
                    <p className="text-gray-300">{project.layerCount}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Components</p>
                    <p className="text-gray-300">{project.componentCount}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Nets</p>
                    <p className="text-gray-300">{project.netCount}</p>
                  </div>
                </div>

                {project.lastReviewScore != null && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Review Score</span>
                      <span className={`font-semibold ${scoreColor(project.lastReviewScore)}`}>
                        {project.lastReviewScore}/100
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full mt-1 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          project.lastReviewScore >= 80
                            ? 'bg-emerald-500'
                            : project.lastReviewScore >= 60
                            ? 'bg-yellow-500'
                            : project.lastReviewScore >= 40
                            ? 'bg-orange-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${project.lastReviewScore}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(project.updatedAt)}
                  </div>
                  <div className="flex items-center gap-1">
                    <span>{formatFileSize(project.fileSize)}</span>
                    <button
                      onClick={(e) => handleDelete(e, project.id)}
                      disabled={deletingId === project.id}
                      className="ml-2 p-1 text-gray-600 hover:text-red-400 transition-colors"
                      title="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-brand-400 transition-colors" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
