/** Review result types */

export type Severity = 'critical' | 'error' | 'warning' | 'info';

export type Category =
  | 'drc'
  | 'clearance'
  | 'trace_width'
  | 'via'
  | 'thermal'
  | 'signal_integrity'
  | 'power_integrity'
  | 'manufacturing'
  | 'placement'
  | 'routing'
  | 'impedance'
  | 'emi'
  | 'best_practice';

export interface ReviewResult {
  id: string;
  projectId: string;
  status: ReviewStatus;
  score: number;
  summary: string;
  totalIssues: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  items: ReviewItem[];
  createdAt: string;
  completedAt?: string;
  modelUsed: string;
  tokensUsed: number;
}

export type ReviewStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ReviewItem {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  message: string;
  location?: ReviewLocation;
  suggestion?: string;
  citation?: string;
  relatedNets?: string[];
  relatedComponents?: string[];
  autoFixAvailable: boolean;
}

export interface ReviewLocation {
  x: number;
  y: number;
  radius?: number;
  layer?: string;
  elementIds?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  references?: BoardReference[];
  isStreaming?: boolean;
}

export interface BoardReference {
  type: 'component' | 'net' | 'trace' | 'via' | 'zone' | 'location';
  id?: string;
  name?: string;
  location?: { x: number; y: number };
}
