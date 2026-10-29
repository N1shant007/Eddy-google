import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tailwind.css';
import './styles/app.css';
import './styles/editor.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// handy for debugging and automated tests
import { useApp } from './state/app';
import { useEditor } from './state/editor';
(window as any).__eddy = { useApp, useEditor };
