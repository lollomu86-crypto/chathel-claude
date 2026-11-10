/** Bandiere SVG inline (una per lingua dell'app) per il selettore della lingua. Solo markup: decorative (aria-hidden).
 *  Il nome della lingua va SEMPRE nel testo o nell'aria-label del pulsante: la bandiera e' una nazione, non una lingua.
 *  L'inglese usa la bandiera del Regno Unito, con etichetta "English". Classi: .flag, .flag-lg, .flag-sm (globals.css). */
const PATHS: Record<string, React.ReactNode> = {
  it: (<><rect width="8" height="16" fill="#009246" /><rect x="8" width="8" height="16" fill="#fff" /><rect x="16" width="8" height="16" fill="#CE2B37" /></>),
  en: (<><rect width="24" height="16" fill="#012169" /><path d="M0 0L24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" /><path d="M0 0L24 16M24 0L0 16" stroke="#C8102E" strokeWidth="1.3" /><path d="M12 0V16M0 8H24" stroke="#fff" strokeWidth="5.2" /><path d="M12 0V16M0 8H24" stroke="#C8102E" strokeWidth="3" /></>),
  de: (<><rect width="24" height="5.4" fill="#000" /><rect y="5.3" width="24" height="5.4" fill="#DD0000" /><rect y="10.6" width="24" height="5.4" fill="#FFCE00" /></>),
  ru: (<><rect width="24" height="5.4" fill="#fff" /><rect y="5.3" width="24" height="5.4" fill="#0039A6" /><rect y="10.6" width="24" height="5.4" fill="#D52B1E" /></>),
  fr: (<><rect width="8" height="16" fill="#0055A4" /><rect x="8" width="8" height="16" fill="#fff" /><rect x="16" width="8" height="16" fill="#EF4135" /></>),
  es: (<><rect width="24" height="16" fill="#AA151B" /><rect y="4" width="24" height="8" fill="#F1BF00" /></>),
  nl: (<><rect width="24" height="5.4" fill="#AE1C28" /><rect y="5.3" width="24" height="5.4" fill="#fff" /><rect y="10.6" width="24" height="5.4" fill="#21468B" /></>),
  pl: (<><rect width="24" height="8" fill="#fff" /><rect y="8" width="24" height="8" fill="#DC143C" /></>),
  sv: (<><rect width="24" height="16" fill="#006AA7" /><rect x="7" width="3" height="16" fill="#FECC00" /><rect y="6.5" width="24" height="3" fill="#FECC00" /></>),
  pt: (<><rect width="24" height="16" fill="#FF0000" /><rect width="9.6" height="16" fill="#006600" /><circle cx="9.6" cy="8" r="2.6" fill="#FFCC00" /></>),
  cs: (<><rect width="24" height="8" fill="#fff" /><rect y="8" width="24" height="8" fill="#D7141A" /><path d="M0 0L12 8L0 16Z" fill="#11457E" /></>),
  zh: (<><rect width="24" height="16" fill="#DE2910" /><path d="M4.5 2.2l.9 2.6h2.7l-2.2 1.6.9 2.6-2.3-1.6-2.2 1.6.8-2.6L.9 4.8h2.7z" fill="#FFDE00" /></>),
};

export function Flag({ locale, size }: { locale: string; size?: 'sm' | 'lg' }) {
  return (
    <svg className={`flag${size ? ` flag-${size}` : ''}`} viewBox="0 0 24 16" aria-hidden="true" focusable="false">
      {PATHS[locale] ?? PATHS.en}
    </svg>
  );
}
