import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";

export default async function Home() {
  const actor = await currentActor();
  if (actor?.kind === "admin") redirect("/admin");
  if (actor?.kind === "team") redirect("/dashboard");
  redirect("/login");
}
