import { AppWorkspace } from "@/components/app-workspace";
import type { ViewKey } from "@/components/app-workspace";

const viewKeys = new Set(["dashboard", "imports", "transactions", "reviews", "reports", "settings"]);

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const view = resolvedSearchParams?.view;
  const initialView = view && viewKeys.has(view) ? (view as ViewKey) : "dashboard";

  return <AppWorkspace initialView={initialView} />;
}
