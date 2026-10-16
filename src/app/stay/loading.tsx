import { LoadingSkeleton } from '@/components/ui/States';

/** Mostrato a ogni cambio di scheda mentre il server prepara la pagina (Wi-Fi debole degli hotel: il caso normale). */
export default function Loading() {
  return <LoadingSkeleton />;
}
