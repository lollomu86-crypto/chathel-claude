/** Logo ChatHel: l'immagine ORIGINALE (public/brand) su tessera bianca arrotondata, mai ricolorata ne' ridisegnata.
 *  Il file e' un JPG 535x535 a bassa risoluzione: serve il vettoriale dal proprietario (docs/12, sezione 9).
 *  size: "md" (44 px, testata) | "lg" (96 px, login e ingresso) | "xl" (132 px, landing).
 *  Il logo contiene gia' la scritta "ChatHel": non aggiungere un wordmark in testo accanto. */
const SIZES = { md: { h: 44, cls: 'logo-tile' }, lg: { h: 96, cls: 'logo-tile logo-tile-lg' }, xl: { h: 132, cls: 'logo-tile logo-tile-xl' } } as const;
const RATIO = 428 / 404; // larghezza / altezza di public/brand/chathel-logo-tessera.png

/** "Powered by ChatHel" con la tessera piccola: dove il logo dell'hotel ha preso il posto di quello ChatHel. */
export function PoweredBy({ label }: { label: string }) {
  return (
    <p className="powered small muted">
      <span>{label}</span>
      <span className="logo-tile"><img src="/brand/chathel-logo-tessera.png" alt="ChatHel" width={Math.round(28 * RATIO)} height={28} /></span>
    </p>
  );
}

export function LogoMark({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <span className={`${s.cls} ${className}`.trim()}>
      <img src="/brand/chathel-logo-tessera.png" alt="ChatHel" width={Math.round(s.h * RATIO)} height={s.h} />
    </span>
  );
}
