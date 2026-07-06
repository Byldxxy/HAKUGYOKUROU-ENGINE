// SECTION: 前端接口配置
// NOTE: 生产环境默认与页面同源；本地由 Vite 将 /api 和 /socket.io 代理到后端。
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

// SECTION: API 地址拼接
// NOTE: 页面只传 /api/... 路径，方便之后切换环境变量或部署域名。
export const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export const apiFetch = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
  });

  if (response.status === 401 && !['/api/login', '/api/register'].includes(path)) {
    localStorage.removeItem('trpg_username');
    localStorage.removeItem('trpg_current_char_id');
    if (window.location.pathname !== '/') window.location.assign('/');
  }
  return response;
};
