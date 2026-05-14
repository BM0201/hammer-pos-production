"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmployeesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/master/users");
  }, [router]);
  return null;
}
