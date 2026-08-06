import { redirect } from "next/navigation";

export default function OperationalDayAutoRedirectPage() {
  redirect("/app/master/operations");
}
