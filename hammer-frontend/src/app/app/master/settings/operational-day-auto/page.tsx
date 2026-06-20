import { redirect } from "next/navigation";

export default function OperationalDayAutoRedirectPage() {
  redirect("/app/master/settings/operational-automation");
}
