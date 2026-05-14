"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TimberTripsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/master/timber");
  }, [router]);
  return null;
}
