import client from './client';
import type {
  ApiResponse,
  PaginatedResponse,
  Project,
  UploadResponse,
  ReviewStartResponse,
  ChatResponse,
  UsageStats,
} from '../types/api';
import type { BoardData } from '../types/board';
import type { ReviewResult } from '../types/review';

/** List all projects for the current user */
export async function listProjects(page = 1, pageSize = 20): Promise<PaginatedResponse<Project>> {
  const { data } = await client.get<PaginatedResponse<Project>>('/projects', {
    params: { page, pageSize },
  });
  return data;
}

/** Get a single project by ID */
export async function getProject(projectId: string): Promise<ApiResponse<Project>> {
  const { data } = await client.get<ApiResponse<Project>>(`/projects/${projectId}`);
  return data;
}

/** Upload a PCB design file (zip) */
export async function uploadProject(
  file: File,
  name: string,
  description?: string,
  onProgress?: (progress: number) => void
): Promise<ApiResponse<UploadResponse>> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }

  const { data } = await client.post<ApiResponse<UploadResponse>>('/projects/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (event.total && onProgress) {
        onProgress(Math.round((event.loaded * 100) / event.total));
      }
    },
  });
  return data;
}

/** Delete a project */
export async function deleteProject(projectId: string): Promise<ApiResponse<void>> {
  const { data } = await client.delete<ApiResponse<void>>(`/projects/${projectId}`);
  return data;
}

/** Get parsed board data for rendering */
export async function getBoardData(projectId: string): Promise<ApiResponse<BoardData>> {
  const { data } = await client.get<ApiResponse<BoardData>>(`/projects/${projectId}/board`);
  return data;
}

/** Start an AI review for a project */
export async function startReview(projectId: string): Promise<ApiResponse<ReviewStartResponse>> {
  const { data } = await client.post<ApiResponse<ReviewStartResponse>>(
    `/projects/${projectId}/review`
  );
  return data;
}

/** Get review results */
export async function getReview(
  projectId: string,
  reviewId?: string
): Promise<ApiResponse<ReviewResult | null>> {
  const url = reviewId
    ? `/projects/${projectId}/reviews/${reviewId}`
    : `/projects/${projectId}/review`;
  const { data } = await client.get<ApiResponse<ReviewResult | null>>(url);
  return data;
}

/** Send a chat message about the board */
export async function sendChatMessage(
  projectId: string,
  message: string,
  conversationId?: string
): Promise<ApiResponse<ChatResponse>> {
  const { data } = await client.post<ApiResponse<ChatResponse>>(
    `/projects/${projectId}/chat`,
    { message, conversationId }
  );
  return data;
}

/** Get usage statistics */
export async function getUsageStats(): Promise<ApiResponse<UsageStats>> {
  const { data } = await client.get<ApiResponse<UsageStats>>('/user/usage');
  return data;
}

/** Export review as PDF */
export async function exportReview(projectId: string, reviewId: string): Promise<Blob> {
  const { data } = await client.get(`/projects/${projectId}/reviews/${reviewId}/export`, {
    responseType: 'blob',
  });
  return data;
}
