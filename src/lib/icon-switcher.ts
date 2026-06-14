let _ready: Promise<void> | null = null;
let _setIcon: ((icon: 'light' | 'dark') => Promise<void>) | null = null;

async function init() {
  const { Capacitor } = await import('@capacitor/core');
  const NativeIconSwitcher = Capacitor.isNativePlatform()
    ? (Capacitor as any).Plugins.IconSwitcher
    : null;

  if (NativeIconSwitcher) {
    _setIcon = async (icon: 'light' | 'dark') => {
      try {
        await NativeIconSwitcher.setIcon({ icon });
      } catch (e) {
        console.warn('IconSwitcher failed:', e);
      }
    };
  }
}

export async function setAppIcon(icon: 'light' | 'dark') {
  if (!_ready) {
    _ready = init();
  }
  await _ready;
  if (_setIcon) {
    await _setIcon(icon);
  }
}
