import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './lib/i18n';
import { installDevTelegram } from './lib/devTelegram';
import './styles/global.css';

// installDevTelegram is a no-op unless this is a DEV build opened with `?token=…&dev=1` outside
// Telegram; it installs a mock, backend-signed Telegram context so the full flow is testable locally.
async function boot(): Promise<void> {
  await installDevTelegram();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

void boot();
