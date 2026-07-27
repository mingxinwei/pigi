import './assets/main.css';
import './assets/searchHighlights.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Toaster } from './components/ui/sonner';
import { applyThemeAccent, DEFAULT_THEME_ACCENT_ID } from './lib/themeAccents';

// Publish the app accent before first paint. Synchronous, so no color flash.
// A future settings page will call applyThemeAccent with the user's choice.
applyThemeAccent(DEFAULT_THEME_ACCENT_ID);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
