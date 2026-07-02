import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// SECTION: React 应用挂载
// NOTE: StrictMode 会在开发环境额外检查副作用，Socket 事件必须在组件里正确 off。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
