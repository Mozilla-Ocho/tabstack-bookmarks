import { createRoot } from 'react-dom/client';
import '@/src/ui/style.css';
import './popup.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
