// next/font/google: offline non scarica nulla. Restituisce solo il nome della variabile CSS (le famiglie ripiegano sui font di sistema).
export const Inter = (o: { variable: string }) => ({ variable: o.variable.replace('--', 'font-') });
export const Montserrat = Inter;
export const Fraunces = Inter;
