// ─── Recent Projects Helper ─────────────────────────────────────────────────
// Manages recent projects list in localStorage for the WelcomeScreen.

const STORAGE_KEY = 'routeai_recent_projects';
const MAX_RECENT = 10;

export interface StoredRecentProject {
  name: string;
  date: number;           // timestamp (ms)
  componentCount: number;
  netCount: number;
}

/**
 * Read recent projects from localStorage.
 * Returns an array sorted by most recent first.
 */
export function getRecentProjects(): StoredRecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredRecentProject[];
  } catch {
    return [];
  }
}

/**
 * Add or update a project in the recent projects list.
 * If a project with the same name exists, it is updated (moved to top).
 * List is capped at MAX_RECENT entries.
 */
export function addToRecentProjects(
  name: string,
  date: number,
  componentCount?: number,
  netCount?: number,
): void {
  try {
    const existing = getRecentProjects();

    // Remove duplicate if exists
    const filtered = existing.filter((p) => p.name !== name);

    // Prepend new entry
    const entry: StoredRecentProject = {
      name,
      date,
      componentCount: componentCount ?? 0,
      netCount: netCount ?? 0,
    };

    const updated = [entry, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save recent project:', e);
  }
}

/**
 * Clear all recent projects from localStorage.
 */
export function clearRecentProjects(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
