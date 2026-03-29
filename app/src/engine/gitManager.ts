// ─── Git Version Control Manager ─────────────────────────────────────────────
// Uses isomorphic-git for browser/Electron compatibility.
// In browser: uses LightningFS (IndexedDB-backed virtual filesystem)
// In Electron: uses native fs
//
// Each "commit" saves the full project JSON as a file in the virtual git repo.
// This gives us branch, diff, log, and revert capabilities for free.

import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommitInfo {
  oid: string;            // commit hash
  message: string;
  author: string;
  email: string;
  timestamp: number;      // unix seconds
  date: Date;
}

export interface FileDiff {
  filepath: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
  oldContent?: string;
  newContent?: string;
}

export interface FileStatus {
  filepath: string;
  status: 'new' | 'modified' | 'deleted' | 'unmodified';
  staged: boolean;
}

export interface ProjectChangeSummary {
  componentsAdded: string[];
  componentsRemoved: string[];
  componentsMoved: string[];
  tracesAdded: number;
  tracesRemoved: number;
  wiresAdded: number;
  wiresRemoved: number;
  netsChanged: number;
  metadataChanged: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_FILE = 'project.json';
const DEFAULT_BRANCH = 'main';
const FS_NAME_PREFIX = 'routeai-git-';

// ─── GitManager Class ───────────────────────────────────────────────────────

class GitManager {
  private fs: any = null;
  private dir: string = '';
  private initialized: boolean = false;
  private projectName: string = '';

  /**
   * Check if git repo is initialized for the current project.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the filesystem instance name (for debugging).
   */
  getProjectName(): string {
    return this.projectName;
  }

  /**
   * Initialize a git repository for a project.
   * Creates a LightningFS instance backed by IndexedDB and runs git init.
   */
  async init(projectName: string): Promise<void> {
    // Sanitize project name for filesystem
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'default';
    this.projectName = safeName;
    this.dir = '/' + safeName;

    // Create LightningFS instance (IndexedDB-backed)
    const fsInstance = new LightningFS(FS_NAME_PREFIX + safeName);
    this.fs = fsInstance;

    // Ensure the directory exists
    try {
      await this.fs.promises.stat(this.dir);
    } catch {
      await this.fs.promises.mkdir(this.dir, { recursive: true });
    }

    // Check if already a git repo
    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      this.initialized = true;
      return;
    } catch {
      // Not initialized yet, proceed with git init
    }

    // Initialize git repo
    await git.init({ fs: this.fs, dir: this.dir, defaultBranch: DEFAULT_BRANCH });
    this.initialized = true;
  }

  /**
   * Write project data and create a git commit.
   * Returns the commit hash (oid).
   */
  async commit(message: string, author: string, projectJson: string): Promise<string> {
    this._ensureInit();

    // Write the project JSON to the virtual filesystem
    const filepath = this.dir + '/' + PROJECT_FILE;
    await this.fs.promises.writeFile(filepath, projectJson, 'utf8');

    // Stage the file
    await git.add({ fs: this.fs, dir: this.dir, filepath: PROJECT_FILE });

    // Create the commit
    const oid = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author: {
        name: author || 'RouteAI User',
        email: 'user@routeai.local',
      },
    });

    return oid;
  }

  /**
   * Get commit history for the current branch.
   */
  async log(limit?: number): Promise<CommitInfo[]> {
    this._ensureInit();

    try {
      const commits = await git.log({
        fs: this.fs,
        dir: this.dir,
        depth: limit || 100,
      });

      return commits.map((entry) => ({
        oid: entry.oid,
        message: entry.commit.message,
        author: entry.commit.author.name,
        email: entry.commit.author.email,
        timestamp: entry.commit.author.timestamp,
        date: new Date(entry.commit.author.timestamp * 1000),
      }));
    } catch {
      // No commits yet
      return [];
    }
  }

  /**
   * Get the diff between working directory and last commit.
   * Returns a list of changed files with their content.
   */
  async diff(currentProjectJson: string): Promise<FileDiff[]> {
    this._ensureInit();

    const diffs: FileDiff[] = [];

    // Get the last committed version
    let lastContent: string | null = null;
    try {
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth: 1 });
      if (commits.length > 0) {
        const blob = await git.readBlob({
          fs: this.fs,
          dir: this.dir,
          oid: commits[0].oid,
          filepath: PROJECT_FILE,
        });
        lastContent = new TextDecoder().decode(blob.blob);
      }
    } catch {
      // No previous commit
    }

    if (lastContent === null) {
      // No previous commit, everything is new
      diffs.push({
        filepath: PROJECT_FILE,
        status: 'added',
        newContent: currentProjectJson,
      });
    } else if (lastContent !== currentProjectJson) {
      diffs.push({
        filepath: PROJECT_FILE,
        status: 'modified',
        oldContent: lastContent,
        newContent: currentProjectJson,
      });
    } else {
      diffs.push({
        filepath: PROJECT_FILE,
        status: 'unchanged',
        oldContent: lastContent,
        newContent: currentProjectJson,
      });
    }

    return diffs;
  }

  /**
   * Compare the current project JSON with the last committed version
   * and produce a human-readable summary of what changed.
   */
  diffSummary(oldJson: string | null, newJson: string): ProjectChangeSummary {
    const summary: ProjectChangeSummary = {
      componentsAdded: [],
      componentsRemoved: [],
      componentsMoved: [],
      tracesAdded: 0,
      tracesRemoved: 0,
      wiresAdded: 0,
      wiresRemoved: 0,
      netsChanged: 0,
      metadataChanged: false,
    };

    if (!oldJson) return summary;

    try {
      const oldData = JSON.parse(oldJson);
      const newData = JSON.parse(newJson);

      // Compare metadata
      if (JSON.stringify(oldData.metadata) !== JSON.stringify(newData.metadata)) {
        summary.metadataChanged = true;
      }

      // Compare schematic components
      const oldComps = new Map<string, any>();
      const newComps = new Map<string, any>();
      for (const c of (oldData.schematic?.components || [])) oldComps.set(c.id, c);
      for (const c of (newData.schematic?.components || [])) newComps.set(c.id, c);

      for (const [id, comp] of newComps) {
        if (!oldComps.has(id)) {
          summary.componentsAdded.push(comp.ref || comp.id);
        } else {
          const old = oldComps.get(id);
          if (old.x !== comp.x || old.y !== comp.y) {
            summary.componentsMoved.push(comp.ref || comp.id);
          }
        }
      }
      for (const [id, comp] of oldComps) {
        if (!newComps.has(id)) {
          summary.componentsRemoved.push(comp.ref || comp.id);
        }
      }

      // Compare board traces
      const oldTraceIds = new Set((oldData.board?.traces || []).map((t: any) => t.id));
      const newTraceIds = new Set((newData.board?.traces || []).map((t: any) => t.id));
      for (const id of newTraceIds) {
        if (!oldTraceIds.has(id)) summary.tracesAdded++;
      }
      for (const id of oldTraceIds) {
        if (!newTraceIds.has(id)) summary.tracesRemoved++;
      }

      // Compare wires
      const oldWireIds = new Set((oldData.schematic?.wires || []).map((w: any) => w.id));
      const newWireIds = new Set((newData.schematic?.wires || []).map((w: any) => w.id));
      for (const id of newWireIds) {
        if (!oldWireIds.has(id)) summary.wiresAdded++;
      }
      for (const id of oldWireIds) {
        if (!newWireIds.has(id)) summary.wiresRemoved++;
      }

      // Compare nets
      const oldNetCount = (oldData.nets || []).length;
      const newNetCount = (newData.nets || []).length;
      summary.netsChanged = Math.abs(newNetCount - oldNetCount);

    } catch {
      // If parsing fails, just return empty summary
    }

    return summary;
  }

  /**
   * Checkout a specific commit -- read the project file from that commit.
   * Returns the project JSON string from that commit.
   */
  async checkout(commitHash: string): Promise<string> {
    this._ensureInit();

    // Read the project file from the specified commit
    const blob = await git.readBlob({
      fs: this.fs,
      dir: this.dir,
      oid: commitHash,
      filepath: PROJECT_FILE,
    });

    const content = new TextDecoder().decode(blob.blob);

    // Also write it to the working directory so git status is clean
    const filepath = this.dir + '/' + PROJECT_FILE;
    await this.fs.promises.writeFile(filepath, content, 'utf8');
    await git.add({ fs: this.fs, dir: this.dir, filepath: PROJECT_FILE });

    return content;
  }

  /**
   * Create a new branch at the current HEAD.
   */
  async createBranch(name: string): Promise<void> {
    this._ensureInit();

    await git.branch({
      fs: this.fs,
      dir: this.dir,
      ref: name,
      checkout: false,
    });
  }

  /**
   * List all branches.
   */
  async listBranches(): Promise<string[]> {
    this._ensureInit();

    return git.listBranches({
      fs: this.fs,
      dir: this.dir,
    });
  }

  /**
   * Get the current branch name.
   */
  async currentBranch(): Promise<string> {
    this._ensureInit();

    const branch = await git.currentBranch({
      fs: this.fs,
      dir: this.dir,
    });

    return branch || DEFAULT_BRANCH;
  }

  /**
   * Switch to a different branch.
   * Returns the project JSON from the HEAD of that branch.
   */
  async switchBranch(name: string): Promise<string | null> {
    this._ensureInit();

    await git.checkout({
      fs: this.fs,
      dir: this.dir,
      ref: name,
    });

    // Read the project file from the switched branch
    try {
      const filepath = this.dir + '/' + PROJECT_FILE;
      const content = await this.fs.promises.readFile(filepath, 'utf8');
      return content as string;
    } catch {
      return null;
    }
  }

  /**
   * Get status of files in the working directory.
   */
  async getStatus(): Promise<FileStatus[]> {
    this._ensureInit();

    const statuses: FileStatus[] = [];

    try {
      const status = await git.statusMatrix({
        fs: this.fs,
        dir: this.dir,
      });

      for (const [filepath, head, workdir, stage] of status) {
        let fileStatus: FileStatus['status'] = 'unmodified';
        let staged = false;

        if (head === 0 && workdir === 2) {
          fileStatus = 'new';
        } else if (head === 1 && workdir === 2) {
          fileStatus = 'modified';
        } else if (head === 1 && workdir === 0) {
          fileStatus = 'deleted';
        }

        staged = stage === 2 || stage === 3;

        statuses.push({ filepath: filepath as string, status: fileStatus, staged });
      }
    } catch {
      // No commits yet, everything is new
    }

    return statuses;
  }

  /**
   * Read the project JSON from the last commit (HEAD).
   * Returns null if no commits exist.
   */
  async readLastCommit(): Promise<string | null> {
    this._ensureInit();

    try {
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth: 1 });
      if (commits.length === 0) return null;

      const blob = await git.readBlob({
        fs: this.fs,
        dir: this.dir,
        oid: commits[0].oid,
        filepath: PROJECT_FILE,
      });

      return new TextDecoder().decode(blob.blob);
    } catch {
      return null;
    }
  }

  /**
   * Check if there are uncommitted changes by comparing
   * the current project JSON with the last committed version.
   */
  async hasChanges(currentProjectJson: string): Promise<boolean> {
    const lastCommit = await this.readLastCommit();
    if (lastCommit === null) return true; // No commits yet
    return lastCommit !== currentProjectJson;
  }

  /**
   * Delete the entire repository (wipe IndexedDB store).
   */
  async destroy(): Promise<void> {
    if (this.fs) {
      try {
        // Delete the IndexedDB database for this project
        const dbName = FS_NAME_PREFIX + this.projectName;
        if (typeof indexedDB !== 'undefined') {
          indexedDB.deleteDatabase(dbName);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.initialized = false;
    this.fs = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private _ensureInit(): void {
    if (!this.initialized || !this.fs) {
      throw new Error('GitManager not initialized. Call init() first.');
    }
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const gitManager = new GitManager();
export default gitManager;
