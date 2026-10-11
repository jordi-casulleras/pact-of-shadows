/** Cloudflare Turnstile's site key (public). Without it no check is made, which only works while the project does not demand one. */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT = 60_000;

interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      callback(token: string): void;
      'error-callback'(): void;
    },
  ): string;
  remove(widget: string): void;
}

let loading: Promise<Turnstile> | null = null;

function load(): Promise<Turnstile> {
  return (loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => {
      loading = null;
      reject(new Error('captcha script failed to load'));
    };
    document.head.append(script);
  }));
}

/**
 * Proof for the sign-in that a person's browser is asking. Usually nothing is shown; when
 * Cloudflare wants a click, its box appears at the bottom of the screen. Resolves to
 * undefined when no site key is configured.
 */
export async function captchaToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  const turnstile = await load();
  const box = document.createElement('div');
  box.className = 'captcha';
  document.body.append(box);
  let widget: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('captcha timed out')), TIMEOUT);
      widget = turnstile.render(box, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        callback: (token) => {
          clearTimeout(timer);
          resolve(token);
        },
        'error-callback': () => {
          clearTimeout(timer);
          reject(new Error('captcha failed'));
        },
      });
    });
  } finally {
    if (widget) turnstile.remove(widget);
    box.remove();
  }
}
