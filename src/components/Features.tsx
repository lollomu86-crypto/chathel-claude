'use client';
import { createContext, useContext } from 'react';
import { ALL_FEATURES_ON } from '@/lib/rules/features';
import type { HotelFeatures } from '@/lib/types';

/** Funzioni accese dal direttore (gia' effettive), per nascondere nell'app ospite quelle spente. */
const Ctx = createContext<HotelFeatures>(ALL_FEATURES_ON);

export function FeaturesProvider({ features, children }: { features: HotelFeatures; children: React.ReactNode }) {
  return <Ctx.Provider value={features}>{children}</Ctx.Provider>;
}
export function useFeatures(): HotelFeatures {
  return useContext(Ctx);
}
