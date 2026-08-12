import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installStaleBuildReload } from './lib/staleBuildReload';
import './styles/global.css';

// Before the first render: a tab open across a deploy fails on its next lazy import, and the listener
// has to be attached when that happens rather than after React has already unmounted into a boundary.
installStaleBuildReload();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
