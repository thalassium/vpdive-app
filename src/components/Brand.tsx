/**
 * Logo officiel Septentrion Environnement (public/logo.png).
 *
 * The logo is a single navy ink on transparency. On dark backgrounds it is
 * turned white with a filter rather than shipping a second file:
 *   tone="auto"   navy in light mode, white in dark mode
 *   tone="white"  always white (navy bands, footer)
 */
export function Logo({ className = 'h-10', tone = 'auto' }: { className?: string; tone?: 'auto' | 'white' }) {
  return (
    <img
      src="/logo.png"
      alt="Septentrion Environnement"
      width={520}
      height={387}
      className={`${className} w-auto select-none ${tone === 'white' ? 'brightness-0 invert' : 'dark:brightness-0 dark:invert'}`}
      draggable={false}
    />
  );
}
