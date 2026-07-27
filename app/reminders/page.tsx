import { redirect } from "next/navigation";

export default function RemindersPage() {
  redirect("/tasks?view=upcoming");
}
