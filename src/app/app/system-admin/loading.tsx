"use client";

import { SkeletonCard, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-fade-in-up">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}
