// ─── GitPanel.tsx ── Version Control Panel ───────────────────────────────────
// Provides git-based version control UI for the EDA project:
// - Commit history with visual timeline
// - Save Version (commit with message)
// - Diff view showing what changed since last commit
// - Branch selector and creation
// - Revert to any previous version
// - Auto-save indicator showing uncommitted changes

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import { serializeProject } from '../store/fileFormat';
import gitManager, { type CommitInfo, type ProjectChangeSummary } from '../engine/gitManager';

// ─── Props ──────────────────────────────────────────────────────────────────

interface GitPanelProps {
  open: boolean;
  onClose: () => void;
}

// ─── Subview tabs ───────────────────────────────────────────────────────────

type GitTab = 'history' | 'changes' | 'branches';

// ─── Styles ─────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 5000,
};

const dialogStyle: React.CSSProperties = {
  background: theme.bg1,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '10px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  width: '720px',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: theme.fontSans,
  color: theme.textPrimary,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 20px',
  borderBottom: `1px solid ${theme.bg3}`,
  flexShrink: 0,
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0',
  borderBottom: `1px solid ${theme.bg3}`,
  padding: '0 20px',
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  fontSize: '12px',
  fontWeight: active ? 600 : 400,
  color: active ? theme.blue : theme.textSecondary,
  background: 'transparent',
  border: 'none',
  borderBottom: active ? `2px solid ${theme.blue}` : '2px solid transparent',
  cursor: 'pointer',
  fontFamily: theme.fontSans,
  transition: 'all 0.12s',
});

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '16px 20px',
};

const btnPrimary: React.CSSProperties = {
  background: theme.blue,
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  padding: '7px 16px',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: theme.fontSans,
  cursor: 'pointer',
  transition: 'all 0.12s',
};

const btnSecondary: React.CSSProperties = {
  background: theme.bg3,
  color: theme.textSecondary,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '5px',
  padding: '7px 14px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: theme.fontSans,
  cursor: 'pointer',
  transition: 'all 0.12s',
};

const btnDanger: React.CSSProperties = {
  ...btnSecondary,
  borderColor: theme.red,
  color: theme.red,
};

const inputStyle: React.CSSProperties = {
  background: theme.bg0,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '5px',
  color: theme.textPrimary,
  fontSize: '12px',
  fontFamily: theme.fontSans,
  padding: '7px 10px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.textMuted,
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px',
  lineHeight: 1,
};

// ─── Helper: format relative time ──────────────────────────────────────────

function timeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(oid: string): string {
  return oid.substring(0, 7);
}

// ─── Main GitPanel Component ────────────────────────────────────────────────

const GitPanel: React.FC<GitPanelProps> = ({ open, onClose }) => {
  const [activeTab, setActiveTab] = useState<GitTab>('history');
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [commitMessage, setCommitMessage] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [changeSummary, setChangeSummary] = useState<ProjectChangeSummary | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const messageRef = useRef<HTMLInputElement>(null);

  const { saveProject, loadProject, metadata } = useProjectStore();

  // ── Get current project JSON ─────────────────────────────────────────

  const getCurrentProjectJson = useCallback((): string => {
    const data = saveProject();
    const file = serializeProject(data);
    return JSON.stringify(file, null, 2);
  }, [saveProject]);

  // ── Initialize git repo ──────────────────────────────────────────────

  const initRepo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      await gitManager.init(metadata.name || 'untitled');
      setInitialized(true);

      // Load data
      const [logResult, branchList, branch] = await Promise.all([
        gitManager.log(50),
        gitManager.listBranches(),
        gitManager.currentBranch(),
      ]);

      setCommits(logResult);
      setBranches(branchList);
      setCurrentBranch(branch);

      // Check for uncommitted changes
      const currentJson = getCurrentProjectJson();
      const hasChangesResult = await gitManager.hasChanges(currentJson);
      setHasUncommitted(hasChangesResult);

      // Calculate diff summary
      if (hasChangesResult) {
        const lastCommitJson = await gitManager.readLastCommit();
        const summary = gitManager.diffSummary(lastCommitJson, currentJson);
        setChangeSummary(summary);
      } else {
        setChangeSummary(null);
      }

      // Load saved author name
      const savedAuthor = localStorage.getItem('routeai_git_author') || '';
      setAuthorName(savedAuthor);

    } catch (err) {
      setError(`Failed to initialize: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [metadata.name, getCurrentProjectJson]);

  // ── Auto-init when panel opens ───────────────────────────────────────

  useEffect(() => {
    if (open) {
      initRepo();
    }
  }, [open, initRepo]);

  // ── Commit handler ───────────────────────────────────────────────────

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
      setError('Please enter a commit message.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const projectJson = getCurrentProjectJson();
      const author = authorName.trim() || 'RouteAI User';

      // Save author name for next time
      localStorage.setItem('routeai_git_author', author);

      const oid = await gitManager.commit(commitMessage.trim(), author, projectJson);

      setSuccess(`Version saved: ${shortHash(oid)}`);
      setCommitMessage('');
      setHasUncommitted(false);
      setChangeSummary(null);

      // Refresh commit list
      const logResult = await gitManager.log(50);
      setCommits(logResult);

      // Clear success after 3s
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      setError(`Commit failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [commitMessage, authorName, getCurrentProjectJson]);

  // ── Revert handler ───────────────────────────────────────────────────

  const handleRevert = useCallback(async (oid: string) => {
    const ok = window.confirm(
      'Revert to this version? Your current unsaved changes will be lost.'
    );
    if (!ok) return;

    try {
      setLoading(true);
      setError(null);

      const projectJson = await gitManager.checkout(oid);
      const parsed = JSON.parse(projectJson);

      // Reconstruct ProjectData from the stored RouteAIFile format
      const projectData = {
        metadata: {
          name: parsed.metadata?.name || metadata.name,
          version: parsed.version || '1.0.0',
          createdAt: parsed.metadata?.createdAt || new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          author: parsed.metadata?.author || '',
          description: parsed.metadata?.description || '',
        },
        schematic: parsed.schematic,
        board: parsed.board,
        nets: parsed.nets || [],
        designRules: parsed.designRules,
      };

      loadProject(projectData);
      setHasUncommitted(false);
      setChangeSummary(null);
      setSelectedCommit(null);
      setSuccess(`Reverted to version ${shortHash(oid)}`);

      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      setError(`Revert failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [loadProject, metadata.name]);

  // ── Create branch handler ────────────────────────────────────────────

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) {
      setError('Please enter a branch name.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await gitManager.createBranch(newBranchName.trim());
      setNewBranchName('');

      const branchList = await gitManager.listBranches();
      setBranches(branchList);

      setSuccess(`Branch "${newBranchName.trim()}" created`);
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      setError(`Failed to create branch: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [newBranchName]);

  // ── Switch branch handler ────────────────────────────────────────────

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    if (branchName === currentBranch) return;

    try {
      setLoading(true);
      setError(null);

      const projectJson = await gitManager.switchBranch(branchName);
      setCurrentBranch(branchName);

      if (projectJson) {
        const parsed = JSON.parse(projectJson);
        const projectData = {
          metadata: {
            name: parsed.metadata?.name || metadata.name,
            version: parsed.version || '1.0.0',
            createdAt: parsed.metadata?.createdAt || new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            author: parsed.metadata?.author || '',
            description: parsed.metadata?.description || '',
          },
          schematic: parsed.schematic,
          board: parsed.board,
          nets: parsed.nets || [],
          designRules: parsed.designRules,
        };
        loadProject(projectData);
      }

      // Refresh commits
      const logResult = await gitManager.log(50);
      setCommits(logResult);

      setSuccess(`Switched to branch "${branchName}"`);
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      setError(`Failed to switch branch: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [currentBranch, loadProject, metadata.name]);

  // ── Keyboard: Enter to commit ────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && commitMessage.trim()) {
      e.preventDefault();
      handleCommit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [commitMessage, handleCommit, onClose]);

  // ── Render nothing if not open ───────────────────────────────────────

  if (!open) return null;

  // ── Render: History tab ──────────────────────────────────────────────

  const renderHistory = () => (
    <div>
      {/* Save Version form */}
      <div style={{
        background: theme.bg2,
        borderRadius: '8px',
        padding: '14px',
        marginBottom: '16px',
        border: `1px solid ${theme.bg3}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: theme.textPrimary }}>
            Save Version
          </span>
          {hasUncommitted && (
            <span style={{
              fontSize: '10px',
              color: theme.orange,
              fontWeight: 600,
              background: theme.orangeDim,
              padding: '2px 6px',
              borderRadius: '3px',
            }}>
              Uncommitted changes
            </span>
          )}
          {!hasUncommitted && commits.length > 0 && (
            <span style={{
              fontSize: '10px',
              color: theme.green,
              fontWeight: 600,
              background: theme.greenDim,
              padding: '2px 6px',
              borderRadius: '3px',
            }}>
              Up to date
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input
            ref={messageRef}
            type="text"
            placeholder="Describe your changes (e.g., 'Added power section, routed bus traces')"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            type="text"
            placeholder="Author"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            style={{ ...inputStyle, width: '140px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: theme.textMuted }}>
            Branch: {currentBranch}
          </span>
          <button
            style={{
              ...btnPrimary,
              opacity: loading || !commitMessage.trim() ? 0.5 : 1,
              pointerEvents: loading || !commitMessage.trim() ? 'none' : 'auto',
            }}
            onClick={handleCommit}
            disabled={loading || !commitMessage.trim()}
          >
            {loading ? 'Saving...' : 'Save Version'}
          </button>
        </div>
      </div>

      {/* Commit timeline */}
      <div style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary, marginBottom: '10px' }}>
        Version History ({commits.length} version{commits.length !== 1 ? 's' : ''})
      </div>

      {commits.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '30px',
          color: theme.textMuted,
          fontSize: '12px',
        }}>
          No versions saved yet. Save your first version above.
        </div>
      )}

      <div style={{ position: 'relative' }}>
        {/* Timeline line */}
        {commits.length > 1 && (
          <div style={{
            position: 'absolute',
            left: '11px',
            top: '12px',
            bottom: '12px',
            width: '2px',
            background: theme.bg3,
            zIndex: 0,
          }} />
        )}

        {commits.map((commit, index) => {
          const isSelected = selectedCommit === commit.oid;
          const isFirst = index === 0;

          return (
            <div
              key={commit.oid}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '10px 0',
                position: 'relative',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedCommit(isSelected ? null : commit.oid)}
            >
              {/* Timeline dot */}
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: isFirst ? theme.blue : theme.bg3,
                border: `2px solid ${isFirst ? theme.blue : theme.bg3}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                zIndex: 1,
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: isFirst ? '#fff' : theme.textMuted,
                }} />
              </div>

              {/* Commit info */}
              <div style={{
                flex: 1,
                background: isSelected ? theme.bg2 : 'transparent',
                borderRadius: '6px',
                padding: isSelected ? '10px' : '0',
                border: isSelected ? `1px solid ${theme.bg3}` : '1px solid transparent',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: theme.textPrimary,
                    lineHeight: 1.4,
                  }}>
                    {commit.message}
                  </span>
                  {isFirst && (
                    <span style={{
                      fontSize: '9px',
                      color: theme.green,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      HEAD
                    </span>
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '10px',
                  color: theme.textMuted,
                }}>
                  <span style={{ fontFamily: theme.fontMono, color: theme.purple }}>
                    {shortHash(commit.oid)}
                  </span>
                  <span>{commit.author}</span>
                  <span title={formatDate(commit.date)}>{timeAgo(commit.date)}</span>
                </div>

                {/* Expanded details with revert button */}
                {isSelected && (
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      style={btnDanger}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevert(commit.oid);
                      }}
                    >
                      Revert to This Version
                    </button>
                    <span style={{ fontSize: '10px', color: theme.textMuted }}>
                      {formatDate(commit.date)}
                    </span>
                    <span style={{ fontSize: '10px', color: theme.textMuted, fontFamily: theme.fontMono }}>
                      {commit.oid}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Render: Changes tab ──────────────────────────────────────────────

  const renderChanges = () => (
    <div>
      {!hasUncommitted && commits.length > 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: theme.textMuted,
          fontSize: '12px',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.5 }}>
            {'\u2713'}
          </div>
          No changes since last saved version.
        </div>
      ) : changeSummary ? (
        <div>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: theme.textSecondary,
            marginBottom: '12px',
          }}>
            Changes since last version:
          </div>

          {/* Change items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {changeSummary.componentsAdded.length > 0 && (
              <ChangeRow
                icon="+"
                color={theme.green}
                label={`${changeSummary.componentsAdded.length} component(s) added`}
                detail={changeSummary.componentsAdded.join(', ')}
              />
            )}
            {changeSummary.componentsRemoved.length > 0 && (
              <ChangeRow
                icon="-"
                color={theme.red}
                label={`${changeSummary.componentsRemoved.length} component(s) removed`}
                detail={changeSummary.componentsRemoved.join(', ')}
              />
            )}
            {changeSummary.componentsMoved.length > 0 && (
              <ChangeRow
                icon="~"
                color={theme.orange}
                label={`${changeSummary.componentsMoved.length} component(s) moved`}
                detail={changeSummary.componentsMoved.join(', ')}
              />
            )}
            {changeSummary.wiresAdded > 0 && (
              <ChangeRow
                icon="+"
                color={theme.green}
                label={`${changeSummary.wiresAdded} wire(s) added`}
              />
            )}
            {changeSummary.wiresRemoved > 0 && (
              <ChangeRow
                icon="-"
                color={theme.red}
                label={`${changeSummary.wiresRemoved} wire(s) removed`}
              />
            )}
            {changeSummary.tracesAdded > 0 && (
              <ChangeRow
                icon="+"
                color={theme.green}
                label={`${changeSummary.tracesAdded} trace(s) added`}
              />
            )}
            {changeSummary.tracesRemoved > 0 && (
              <ChangeRow
                icon="-"
                color={theme.red}
                label={`${changeSummary.tracesRemoved} trace(s) removed`}
              />
            )}
            {changeSummary.netsChanged > 0 && (
              <ChangeRow
                icon="~"
                color={theme.cyan}
                label={`${changeSummary.netsChanged} net(s) changed`}
              />
            )}
            {changeSummary.metadataChanged && (
              <ChangeRow
                icon="~"
                color={theme.purple}
                label="Project metadata changed"
              />
            )}

            {/* Nothing detected */}
            {changeSummary.componentsAdded.length === 0 &&
             changeSummary.componentsRemoved.length === 0 &&
             changeSummary.componentsMoved.length === 0 &&
             changeSummary.wiresAdded === 0 &&
             changeSummary.wiresRemoved === 0 &&
             changeSummary.tracesAdded === 0 &&
             changeSummary.tracesRemoved === 0 &&
             changeSummary.netsChanged === 0 &&
             !changeSummary.metadataChanged &&
             commits.length === 0 && (
              <div style={{ color: theme.textMuted, fontSize: '12px', padding: '20px 0', textAlign: 'center' }}>
                No previous version to compare against. Save your first version.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: theme.textMuted,
          fontSize: '12px',
        }}>
          {commits.length === 0
            ? 'Save your first version to start tracking changes.'
            : 'Calculating changes...'
          }
        </div>
      )}
    </div>
  );

  // ── Render: Branches tab ─────────────────────────────────────────────

  const renderBranches = () => (
    <div>
      {/* Create branch form */}
      <div style={{
        background: theme.bg2,
        borderRadius: '8px',
        padding: '14px',
        marginBottom: '16px',
        border: `1px solid ${theme.bg3}`,
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
          Create Branch
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Branch name (e.g., experiment-layout-v2)"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newBranchName.trim()) {
                handleCreateBranch();
              }
            }}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            style={{
              ...btnPrimary,
              opacity: !newBranchName.trim() || loading ? 0.5 : 1,
              pointerEvents: !newBranchName.trim() || loading ? 'none' : 'auto',
            }}
            onClick={handleCreateBranch}
            disabled={!newBranchName.trim() || loading}
          >
            Create
          </button>
        </div>
        <div style={{ fontSize: '10px', color: theme.textMuted, marginTop: '6px' }}>
          Creates a new branch from the current HEAD. Use branches to experiment with different layouts.
        </div>
      </div>

      {/* Branch list */}
      <div style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary, marginBottom: '10px' }}>
        Branches ({branches.length})
      </div>

      {branches.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '20px',
          color: theme.textMuted,
          fontSize: '12px',
        }}>
          No branches yet. Save a version first, then create branches.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {branches.map((branch) => {
          const isCurrent = branch === currentBranch;
          return (
            <div
              key={branch}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: isCurrent ? theme.bg2 : 'transparent',
                borderRadius: '6px',
                border: isCurrent ? `1px solid ${theme.blue}` : `1px solid transparent`,
                cursor: isCurrent ? 'default' : 'pointer',
                transition: 'all 0.12s',
              }}
              onClick={() => !isCurrent && handleSwitchBranch(branch)}
              onMouseEnter={(e) => {
                if (!isCurrent) (e.currentTarget as HTMLElement).style.background = theme.bg2;
              }}
              onMouseLeave={(e) => {
                if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '14px',
                  color: isCurrent ? theme.blue : theme.textMuted,
                }}>
                  {isCurrent ? '\u2713' : '\u2022'}
                </span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: isCurrent ? 600 : 400,
                  color: isCurrent ? theme.blue : theme.textPrimary,
                  fontFamily: theme.fontMono,
                }}>
                  {branch}
                </span>
                {isCurrent && (
                  <span style={{
                    fontSize: '9px',
                    color: theme.green,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: theme.greenDim,
                    padding: '1px 5px',
                    borderRadius: '3px',
                  }}>
                    CURRENT
                  </span>
                )}
              </div>

              {!isCurrent && (
                <button
                  style={btnSecondary}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSwitchBranch(branch);
                  }}
                >
                  Switch
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: theme.textPrimary }}>
              Version Control
            </span>
            {hasUncommitted && (
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: theme.orange,
                display: 'inline-block',
              }}
                title="Uncommitted changes"
              />
            )}
            <span style={{
              fontSize: '10px',
              color: theme.textMuted,
              fontFamily: theme.fontMono,
              background: theme.bg2,
              padding: '2px 6px',
              borderRadius: '3px',
            }}>
              {currentBranch}
            </span>
          </div>
          <button style={closeBtn} onClick={onClose} title="Close">
            {'\u2715'}
          </button>
        </div>

        {/* Tab bar */}
        <div style={tabBarStyle}>
          <button style={tabStyle(activeTab === 'history')} onClick={() => setActiveTab('history')}>
            History
          </button>
          <button style={tabStyle(activeTab === 'changes')} onClick={() => setActiveTab('changes')}>
            Changes
            {hasUncommitted && (
              <span style={{
                marginLeft: '5px',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: theme.orange,
                display: 'inline-block',
              }} />
            )}
          </button>
          <button style={tabStyle(activeTab === 'branches')} onClick={() => setActiveTab('branches')}>
            Branches ({branches.length})
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div style={{
            margin: '12px 20px 0',
            padding: '8px 12px',
            background: theme.redDim,
            border: `1px solid ${theme.red}`,
            borderRadius: '5px',
            fontSize: '11px',
            color: theme.red,
          }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{
            margin: '12px 20px 0',
            padding: '8px 12px',
            background: theme.greenDim,
            border: `1px solid ${theme.green}`,
            borderRadius: '5px',
            fontSize: '11px',
            color: theme.green,
          }}>
            {success}
          </div>
        )}

        {/* Body */}
        <div style={bodyStyle}>
          {!initialized && loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: theme.textMuted, fontSize: '12px' }}>
              Initializing version control...
            </div>
          ) : (
            <>
              {activeTab === 'history' && renderHistory()}
              {activeTab === 'changes' && renderChanges()}
              {activeTab === 'branches' && renderBranches()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── ChangeRow sub-component ─────────────────────────────────────────────────

const ChangeRow: React.FC<{
  icon: string;
  color: string;
  label: string;
  detail?: string;
}> = ({ icon, color, label, detail }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 10px',
    background: theme.bg2,
    borderRadius: '5px',
    borderLeft: `3px solid ${color}`,
  }}>
    <span style={{
      fontFamily: theme.fontMono,
      fontSize: '14px',
      fontWeight: 700,
      color,
      width: '16px',
      textAlign: 'center',
    }}>
      {icon}
    </span>
    <div style={{ flex: 1 }}>
      <span style={{ fontSize: '12px', color: theme.textPrimary }}>{label}</span>
      {detail && (
        <div style={{
          fontSize: '10px',
          color: theme.textMuted,
          fontFamily: theme.fontMono,
          marginTop: '2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '500px',
        }}>
          {detail}
        </div>
      )}
    </div>
  </div>
);

export default GitPanel;
