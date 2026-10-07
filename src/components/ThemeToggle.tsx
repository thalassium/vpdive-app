import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Light / dark switch. The initial theme is set by the inline script in
 * index.html (saved choice, else the device setting) before the page paints,
 * so there is no flash; this button only flips and remembers it.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#080e1f' : '#012362');
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // Private browsing: the choice lasts for this visit only.
    }
    setDark(next);
  };

  const label = dark ? 'Activer le mode clair' : 'Activer le mode sombre';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`icon-btn ${className}`}
    >
      {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
