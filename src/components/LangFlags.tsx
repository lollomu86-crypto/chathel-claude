/** Bandiere SVG inline (it, en, de, ru) per il selettore della lingua. Solo markup: decorative (aria-hidden).
 *  Il nome della lingua va SEMPRE nel testo o nell'aria-label del pulsante: la bandiera e' una nazione, non una lingua.
 *  L'inglese usa la bandiera del Regno Unito, con etichetta "English". Classi: .flag, .flag-lg, .flag-sm (globals.css). */
const PATHS: Record<string, React.ReactNode> = {
  it: (<><rect width="8" height="16" fill="#009246" /><rect x="8" width="8" height="16" fill="#fff" /><rect x="16" width="8" height="16" fill="#CE2B37" /></>),
  en: (<><rect width="24" height="16" fill="#012169" /><path d="M0 0L24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" /><path d="M0 0L24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.3" /><path d="M12 0V16M0 8H24" stroke="#fff" strokeWidth="5.2" /><path d="M12 0V16M0 8H24" stroke="#C8102E" strokeWidth="3" /></>),
  de: (<><rect width="24" height="5.4" fill="#000" /><rect y="5.3" width="24" height="5.4" fill="#DD0000" /><rect y="10.6" width="24" height="5.4" fill="#FFCE00" /></>),
  ru: (<><rect width="24" height="5.4" fill="#fff" /><rect y="5.3" width="24" height="5.4" fill="#0039A6" /><rect y="10.6" width="24" height="5.4" fill="#D52B1E" /></>),
};

export function Flag({ locale, size }: { locale: string; size?: 'sm' | 'lg' }) {
  return (
    <svg className={`flag${size ? ` flag-${size}` : ''}`} viewBox="0 0 24 16" aria-hidden="true" focusable="false">
      {PATHS[locale] ?? PATHS.en}
    </svg>
  );
}
