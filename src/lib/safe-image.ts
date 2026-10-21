/** Un indirizzo immagine si mostra solo se e' un percorso interno ("/demo/x.svg") o https: mai javascript:, data:, http:. */
export function safeImage(url: string | null | undefined): string | null {
  if (!url || url.length > 500) return null;
  return /^(\/[^/]|https:\/\/)/.test(url) ? url : null;
}
