/** API response types */

export interface ApiResponse<T> {
  status: string;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  status: string;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export interface User {
  id: string;
  email: string;
  name: string;
  tier: 'free' | 'pro' | 'team';
  reviewsUsed: number;
  reviewsLimit: number;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  format: string;
  status: ProjectStatus;
  fileSize: number;
  layerCount: number;
  componentCount: number;
  netCount: number;
  lastReviewId?: string;
  lastReviewScore?: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'uploaded' | 'parsing' | 'parsed' | 'reviewing' | 'reviewed' | 'error';

export interface UploadResponse {
  projectId: string;
  status: ProjectStatus;
  message: string;
}

export interface ReviewStartResponse {
  reviewId: string;
  status: string;
  estimatedTime: number;
}

export interface ChatResponse {
  messageId: string;
  content: string;
  references?: import('./review').BoardReference[];
}

export interface UsageStats {
  reviewsUsed: number;
  reviewsLimit: number;
  storageUsed: number;
  storageLimit: number;
  tier: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}
