"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { TripsList } from "./trips-list";
import { TripEditor } from "./trip-editor";

/**
 * Viajes de madera: la lista o un viaje abierto. El viaje va en la URL (?viaje=) para que
 * recargar la tablet o volver atrás deje a la persona donde estaba.
 */
export function TimberWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams.get("viaje");

  function openTrip(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("viaje", id);
    else params.delete("viaje");
    const query = params.toString();
    router.push(query ? `?${query}` : "?", { scroll: true });
  }

  if (tripId) return <TripEditor key={tripId} tripId={tripId} onBack={() => openTrip(null)} />;
  return <TripsList onOpen={openTrip} />;
}
