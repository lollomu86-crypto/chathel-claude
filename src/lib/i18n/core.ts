// Nucleo i18n senza dipendenze dai file di traduzione (usabile nei componenti client con UNA sola lingua).

export type Vars = Record<string, string | number>;

export function lookup(tree: unknown, key: string): string | undefined {
  let cur: unknown = tree;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}



export function hasKey(tree: unknown, key: string): boolean {
  return lookup(tree, key) !== undefined;
}

/** Traduce `key` dentro UN albero di messaggi; se manca restituisce la chiave stessa. */
export function translateTree(tree: unknown, key: string, vars?: Vars): string {
  return interpolate(lookup(tree, key) ?? key, vars);
}
