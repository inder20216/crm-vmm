import { PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    navigateToLoginRequestUrl: false,
  },
};

export const loginRequest = {
  scopes: [
    'Mail.ReadWrite',
    'Mail.Send',
    'Mail.ReadWrite.Shared',
    'Mail.Send.Shared',
  ],
};

export const SHARED_MAILBOX = import.meta.env.VITE_SHARED_MAILBOX || 'vmm.helpdesk@openmind.in';

export const msalInstance = new PublicClientApplication(msalConfig);
