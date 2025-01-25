
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <>
      <div className="min-h-screen bg-[#312E2B] text-white">
      <main className="pl-20">
        <div className="container mx-auto p-4">
          <App/>
        </div>
      </main>
    </div>
    <App />
</>
)
