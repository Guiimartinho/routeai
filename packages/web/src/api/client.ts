import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach auth token
client.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('routeai_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401, refresh token
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('routeai_refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          const newToken = data.data.access_token;
          localStorage.setItem('routeai_token', newToken);
          if (data.data.refresh_token) {
            localStorage.setItem('routeai_refresh_token', data.data.refresh_token);
          }
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return client(originalRequest);
        } catch {
          localStorage.removeItem('routeai_token');
          localStorage.removeItem('routeai_refresh_token');
          window.location.href = '/login';
          return Promise.reject(error);
        }
      } else {
        localStorage.removeItem('routeai_token');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default client;
