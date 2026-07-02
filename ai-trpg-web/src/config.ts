// SECTION: 前端接口配置
// NOTE: 本地测试统一走 Vite 代理端口 5174，避免前端代码里散落多个后端地址。
export const API_BASE_URL = 'http://localhost:5174';
export const SOCKET_URL = 'http://localhost:5174';

// SECTION: API 地址拼接
// NOTE: 页面只传 /api/... 路径，方便之后切换环境变量或部署域名。
export const apiUrl = (path: string) => `${API_BASE_URL}${path}`;
