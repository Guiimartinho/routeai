import { useState, useCallback, useMemo } from 'react';
import {
  Users,
  GitBranch,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  User,
  Plus,
  Send,
  MoreHorizontal,
  Eye,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  cursorColor: string;
  currentLayer?: string;
  lastActive: string; // ISO timestamp
  isOnline: boolean;
}

interface DesignVersion {
  id: string;
  hash: string; // short hash like git
  message: string;
  author: string;
  timestamp: string;
  branch: string;
  tags: string[];
  parent?: string;
}

interface Branch {
  name: string;
  headVersion: string;
  author: string;
  createdAt: string;
  isCurrent: boolean;
  ahead: number;
  behind: number;
}

interface ReviewComment {
  id: string;
  author: string;
  authorColor: string;
  timestamp: string;
  text: string;
  location?: { x: number; y: number; layer: string };
  resolved: boolean;
  replies: ReviewComment[];
}

type ApprovalStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected';

interface ApprovalEntry {
  reviewer: string;
  status: ApprovalStatus;
  timestamp?: string;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

const STATUS_STYLES: Record<ApprovalStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Pending' },
  approved: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', label: 'Approved' },
  changes_requested: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', label: 'Changes Requested' },
  rejected: { bg: 'bg-red-900/30', text: 'text-red-400', label: 'Rejected' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UserAvatar({ user, size = 'sm' }: { user: ActiveUser; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';
  const initial = user.name.charAt(0).toUpperCase();

  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold text-white shrink-0 relative`}
      style={{ backgroundColor: user.cursorColor }}
      title={`${user.name}${user.isOnline ? ' (online)' : ''}`}
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name} className="w-full h-full rounded-full object-cover" />
      ) : (
        initial
      )}
      {user.isOnline && (
        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-gray-900" />
      )}
    </div>
  );
}

function VersionNode({ version, isCurrent }: { version: DesignVersion; isCurrent: boolean }) {
  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(version.timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, [version.timestamp]);

  return (
    <div className={`flex items-start gap-2 py-1.5 ${isCurrent ? 'bg-brand-500/5 -mx-2 px-2 rounded' : ''}`}>
      {/* Timeline dot */}
      <div className="flex flex-col items-center mt-1">
        <div
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            isCurrent ? 'bg-brand-400 ring-2 ring-brand-400/30' : 'bg-gray-600'
          }`}
        />
        <div className="w-0.5 h-full bg-gray-800 mt-1" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-300 font-mono">{version.hash.slice(0, 7)}</span>
          {version.tags.map((tag) => (
            <span key={tag} className="px-1 py-0 text-[9px] bg-brand-900/50 text-brand-400 rounded">
              {tag}
            </span>
          ))}
          {isCurrent && (
            <span className="px-1 py-0 text-[9px] bg-emerald-900/50 text-emerald-400 rounded">HEAD</span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 truncate">{version.message}</p>
        <p className="text-[10px] text-gray-600">
          {version.author} &middot; {timeAgo}
        </p>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  onResolve,
}: {
  comment: ReviewComment;
  onResolve: (id: string) => void;
}) {
  const [showReplies, setShowReplies] = useState(false);

  return (
    <div className={`border rounded p-2 ${comment.resolved ? 'border-gray-800/50 opacity-60' : 'border-gray-800'}`}>
      <div className="flex items-start gap-2">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white font-bold shrink-0"
          style={{ backgroundColor: comment.authorColor }}
        >
          {comment.author.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-300 font-medium">{comment.author}</span>
            <span className="text-[10px] text-gray-600">
              {new Date(comment.timestamp).toLocaleDateString()}
            </span>
            {comment.resolved && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{comment.text}</p>
          {comment.location && (
            <button className="text-[10px] text-brand-400 hover:underline mt-0.5">
              View location ({comment.location.x.toFixed(1)}, {comment.location.y.toFixed(1)}) on {comment.location.layer}
            </button>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {!comment.resolved && (
              <button
                onClick={() => onResolve(comment.id)}
                className="text-[10px] text-gray-500 hover:text-emerald-400 transition-colors"
              >
                Resolve
              </button>
            )}
            {comment.replies.length > 0 && (
              <button
                onClick={() => setShowReplies(!showReplies)}
                className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showReplies ? 'Hide' : 'Show'} {comment.replies.length} replies
              </button>
            )}
          </div>
        </div>
      </div>
      {showReplies && comment.replies.length > 0 && (
        <div className="ml-7 mt-2 space-y-2 border-l border-gray-800 pl-2">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="text-xs">
              <span className="text-gray-300 font-medium">{reply.author}</span>
              <span className="text-gray-600 ml-1.5">
                {new Date(reply.timestamp).toLocaleDateString()}
              </span>
              <p className="text-gray-400 mt-0.5">{reply.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function CollaborationPanel() {
  const [activeTab, setActiveTab] = useState<'users' | 'history' | 'comments' | 'approval'>('users');
  const [activeUsers] = useState<ActiveUser[]>([]);
  const [versions] = useState<DesignVersion[]>([]);
  const [branches] = useState<Branch[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [approvals] = useState<ApprovalEntry[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const resolveComment = useCallback((id: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, resolved: true } : c)),
    );
  }, []);

  const submitComment = useCallback(() => {
    if (!newComment.trim()) return;
    const comment: ReviewComment = {
      id: `comment-${Date.now()}`,
      author: 'You',
      authorColor: CURSOR_COLORS[0],
      timestamp: new Date().toISOString(),
      text: newComment.trim(),
      resolved: false,
      replies: [],
    };
    setComments((prev) => [comment, ...prev]);
    setNewComment('');
  }, [newComment]);

  const filteredComments = useMemo(() => {
    if (showResolved) return comments;
    return comments.filter((c) => !c.resolved);
  }, [comments, showResolved]);

  const currentBranch = branches.find((b) => b.isCurrent);

  const tabs = [
    { id: 'users' as const, label: 'Users', icon: Users, count: activeUsers.filter((u) => u.isOnline).length },
    { id: 'history' as const, label: 'History', icon: Clock, count: versions.length },
    { id: 'comments' as const, label: 'Comments', icon: MessageSquare, count: comments.filter((c) => !c.resolved).length },
    { id: 'approval' as const, label: 'Approval', icon: CheckCircle2, count: null },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-brand-400" />
          <span className="text-sm font-semibold text-gray-200">Collaboration</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 bg-gray-900 rounded p-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-800 text-gray-200'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon className="w-3 h-3" />
                {tab.label}
                {tab.count !== null && tab.count > 0 && (
                  <span className="bg-brand-600 text-white text-[8px] px-1 rounded-full min-w-[14px] text-center">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-3">
        {/* Active Users */}
        {activeTab === 'users' && (
          <div className="space-y-3">
            {activeUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <User className="w-8 h-8 text-gray-700" />
                <p className="text-sm text-gray-400">No other users online</p>
                <p className="text-xs text-gray-600">Share the project link to collaborate in real-time.</p>
              </div>
            ) : (
              <>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Online ({activeUsers.filter((u) => u.isOnline).length})
                </p>
                {activeUsers
                  .filter((u) => u.isOnline)
                  .map((user) => (
                    <div key={user.id} className="flex items-center gap-2.5">
                      <UserAvatar user={user} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-200 font-medium truncate">{user.name}</div>
                        <div className="text-[10px] text-gray-500">
                          {user.currentLayer ? `Editing ${user.currentLayer}` : 'Viewing'}
                        </div>
                      </div>
                      <div
                        className="w-3 h-3 rounded-full border-2"
                        style={{ borderColor: user.cursorColor, backgroundColor: `${user.cursorColor}33` }}
                        title={`Cursor: ${user.cursorColor}`}
                      />
                    </div>
                  ))}

                {activeUsers.some((u) => !u.isOnline) && (
                  <>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-3">Offline</p>
                    {activeUsers
                      .filter((u) => !u.isOnline)
                      .map((user) => (
                        <div key={user.id} className="flex items-center gap-2.5 opacity-50">
                          <UserAvatar user={user} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-400 truncate">{user.name}</div>
                            <div className="text-[10px] text-gray-600">
                              Last seen {new Date(user.lastActive).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Version History */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {/* Branch controls */}
            <div className="flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-xs text-gray-300 font-mono">
                {currentBranch?.name ?? 'main'}
              </span>
              {currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) && (
                <span className="text-[10px] text-gray-500">
                  {currentBranch.ahead > 0 && `${currentBranch.ahead} ahead`}
                  {currentBranch.ahead > 0 && currentBranch.behind > 0 && ', '}
                  {currentBranch.behind > 0 && `${currentBranch.behind} behind`}
                </span>
              )}
            </div>

            {/* Branch actions */}
            <div className="flex gap-1.5">
              <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors">
                <GitBranch className="w-3 h-3" />
                New Branch
              </button>
              <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors">
                <GitMerge className="w-3 h-3" />
                Merge
              </button>
              <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors">
                <GitPullRequest className="w-3 h-3" />
                PR
              </button>
            </div>

            {/* All branches */}
            {branches.length > 1 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Branches</p>
                <div className="space-y-0.5">
                  {branches.map((branch) => (
                    <div
                      key={branch.name}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                        branch.isCurrent ? 'bg-brand-500/10 text-brand-400' : 'text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      <GitBranch className="w-3 h-3 shrink-0" />
                      <span className="font-mono truncate">{branch.name}</span>
                      {branch.isCurrent && (
                        <span className="text-[9px] bg-brand-800 px-1 rounded">current</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Version timeline */}
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Timeline</p>
              {versions.length === 0 ? (
                <div className="text-center py-6">
                  <Clock className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">No version history yet.</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {versions.map((v, i) => (
                    <VersionNode key={v.id} version={v} isCurrent={i === 0} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Review Comments */}
        {activeTab === 'comments' && (
          <div className="space-y-3">
            {/* New comment input */}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                placeholder="Add a comment..."
                className="flex-1 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500"
              />
              <button
                onClick={submitComment}
                disabled={!newComment.trim()}
                className="px-2.5 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded transition-colors"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>

            {/* Filter */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">
                {filteredComments.length} comment{filteredComments.length !== 1 ? 's' : ''}
              </span>
              <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600 text-brand-500 focus:ring-brand-500"
                />
                Show resolved
              </label>
            </div>

            {/* Comment list */}
            {filteredComments.length === 0 ? (
              <div className="text-center py-6">
                <MessageSquare className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No comments yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredComments.map((c) => (
                  <CommentCard key={c.id} comment={c} onResolve={resolveComment} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Approval Workflow */}
        {activeTab === 'approval' && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Review Status</p>
              {approvals.length === 0 ? (
                <div className="text-center py-6">
                  <Eye className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">No reviewers assigned.</p>
                  <button className="mt-2 flex items-center gap-1 mx-auto px-3 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors">
                    <Plus className="w-3 h-3" />
                    Add Reviewer
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {approvals.map((entry, i) => {
                    const style = STATUS_STYLES[entry.status];
                    return (
                      <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded ${style.bg}`}>
                        <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-white font-bold">
                          {entry.reviewer.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="text-xs text-gray-300">{entry.reviewer}</div>
                          {entry.timestamp && (
                            <div className="text-[10px] text-gray-600">
                              {new Date(entry.timestamp).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <span className={`text-[10px] font-medium ${style.text}`}>{style.label}</span>
                      </div>
                    );
                  })}

                  {/* Overall approval status */}
                  <div className="border-t border-gray-800 pt-2 mt-2">
                    {approvals.every((a) => a.status === 'approved') ? (
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">All Approved</span>
                      </div>
                    ) : approvals.some((a) => a.status === 'rejected') ? (
                      <div className="flex items-center gap-2 text-red-400">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">Rejected</span>
                      </div>
                    ) : approvals.some((a) => a.status === 'changes_requested') ? (
                      <div className="flex items-center gap-2 text-yellow-400">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">Changes Requested</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-400">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm font-medium">Awaiting Reviews</span>
                      </div>
                    )}
                  </div>

                  <button className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors">
                    <Plus className="w-3 h-3" />
                    Add Reviewer
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
