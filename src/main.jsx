import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { msalInstance } from './auth/msalConfig';
import { AuthProvider } from './context/AuthContext';
import './index.css';
import App from './App.jsx';

msalInstance.initialize()
  .then(() => msalInstance.handleRedirectPromise())
  .catch(error => {
    console.error('MSAL init/redirect error:', error);
  })
  .finally(() => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <MsalProvider instance={msalInstance}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MsalProvider>
      </StrictMode>,
    );
  });
