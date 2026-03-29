import { create } from 'zustand';
import client from '../api/client';
import type { User, AuthResponse, LoginRequest, RegisterRequest, ApiResponse } from '../types/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (credentials: LoginRequest) => Promise<void>;
  register: (details: RegisterRequest) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('routeai_token'),
  isAuthenticated: !!localStorage.getItem('routeai_token'),
  isLoading: false,
  error: null,

  login: async (credentials: LoginRequest) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await client.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
      const auth = data.data;
      localStorage.setItem('routeai_token', auth.access_token);
      localStorage.setItem('routeai_refresh_token', auth.refresh_token);
      set({
        user: auth.user,
        token: auth.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: any) {
      const message = err.response?.data?.message || 'Login failed. Please check your credentials.';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  register: async (details: RegisterRequest) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await client.post<ApiResponse<AuthResponse>>('/auth/register', details);
      const auth = data.data;
      localStorage.setItem('routeai_token', auth.access_token);
      localStorage.setItem('routeai_refresh_token', auth.refresh_token);
      set({
        user: auth.user,
        token: auth.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: any) {
      const message = err.response?.data?.message || 'Registration failed. Please try again.';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  logout: () => {
    localStorage.removeItem('routeai_token');
    localStorage.removeItem('routeai_refresh_token');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    });
  },

  loadUser: async () => {
    const token = localStorage.getItem('routeai_token');
    if (!token) {
      set({ isAuthenticated: false, user: null });
      return;
    }
    set({ isLoading: true });
    try {
      const { data } = await client.get<ApiResponse<User>>('/auth/me');
      set({ user: data.data, isAuthenticated: true, isLoading: false });
    } catch {
      localStorage.removeItem('routeai_token');
      localStorage.removeItem('routeai_refresh_token');
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
