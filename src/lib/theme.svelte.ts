import { setAppIcon as _setAppIcon } from '$lib/icon-switcher';

export const theme = $state({
  logoEyeOpen: typeof localStorage !== 'undefined' && localStorage.getItem('logoEyeOpen') === 'true'
});

export function toggleLogoEye() {
  theme.logoEyeOpen = !theme.logoEyeOpen;
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem('logoEyeOpen', String(theme.logoEyeOpen)); } catch {}
  }
  try {
    const html = document.documentElement;
    const isDark = !theme.logoEyeOpen;
    html.classList.toggle('dark', isDark);
    html.classList.add('theme-transitioning');
    setTimeout(() => html.classList.remove('theme-transitioning'), 250);
    _setAppIcon(isDark ? 'dark' : 'light');
  } catch (e) {
    console.warn('[logoEye] failed to apply theme class', e);
  }
}
