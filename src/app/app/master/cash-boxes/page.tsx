import { requireMaster } from "@/modules/auth/guards";
import { MasterCashBoxes } from "@/components/cash-boxes/master-cash-boxes";

export default async function MasterCashBoxesPage() {
  await requireMaster();

  return (
    <section className="space-y-6 animate-fade-in-up">
      <MasterCashBoxes />
    </section>
  );
}
