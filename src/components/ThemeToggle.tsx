import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Light / dark switch. The initial theme is set by the inline script in
 * index.html (saved choice, else the device setting) before the page paints,
 * so there is no flash; this button only flips and remembers it.
 *
 * Every instance (header, each panel) reads the same source of truth, the
 * `dark` class on <html>: flipping it in a panel updates the header's icon too.
 */
const isDark = () => document.documentElement.classList.contains('dark');

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function setDarkTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#080e1f' : '#012362');
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    // Private browsing: the choice lasts for this visit only.
  }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark);
  const label = dark ? 'Activer le mode clair' : 'Activer le mode sombre';
  return (
    <button type="button" onClick={() => setDarkTheme(!dark)} aria-label={label} title={label} className={`icon-btn ${className}`}>
      {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
