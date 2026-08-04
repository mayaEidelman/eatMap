export type GoogleProfile = {
  googleId: string;
  name: string;
  email: string;
  picture?: string;
};

type GoogleCredentialResponse = {
  credential: string;
};

type GoogleIdentityApi = {
  initialize: (config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
};

function getGoogleIdentityApi(): GoogleIdentityApi | null {
  const identity = (window as unknown as { google?: { accounts?: { id?: GoogleIdentityApi } } }).google;
  return identity?.accounts?.id ?? null;
}

let scriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript(): Promise<void> {
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google sign-in can only load in the browser.'));
      return;
    }

    if (getGoogleIdentityApi()) {
      resolve();
      return;
    }

    const existing = document.getElementById('google-identity-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in.')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google sign-in.'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** Decodes the payload of a Google ID token JWT. Not cryptographically verified — fine for a local-only
 * demo with no backend, since the decoded profile is only ever used to populate a local profile. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64Url = token.split('.')[1] ?? '';
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((char) => '%' + char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
  return JSON.parse(json);
}

export async function renderGoogleSignInButton(
  container: HTMLElement,
  onSignIn: (profile: GoogleProfile) => void,
  onError: (message: string) => void,
): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    onError('Missing VITE_GOOGLE_CLIENT_ID. Add it to a .env.local file and restart the dev server.');
    return;
  }

  try {
    await loadGoogleIdentityScript();
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Failed to load Google sign-in.');
    return;
  }

  const identity = getGoogleIdentityApi();
  if (!identity) {
    onError('Failed to load Google sign-in.');
    return;
  }

  identity.initialize({
    client_id: clientId,
    callback: (response) => {
      try {
        const payload = decodeJwtPayload(response.credential);
        const googleId = typeof payload.sub === 'string' ? payload.sub : '';
        if (!googleId) {
          throw new Error('Missing Google account id.');
        }

        onSignIn({
          googleId,
          name: typeof payload.name === 'string' ? payload.name : (payload.email as string) ?? 'Google user',
          email: typeof payload.email === 'string' ? payload.email : '',
          picture: typeof payload.picture === 'string' ? payload.picture : undefined,
        });
      } catch {
        onError('Could not read your Google profile. Please try again.');
      }
    },
  });

  container.innerHTML = '';
  identity.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    width: 320,
  });
}
