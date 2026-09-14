import { supabase } from "@/lib/supabase";

export interface WarehouseAccount {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  active: boolean;
  can_send_fulfillment_emails: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface WarehousePerformance {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  packed: number;
  shipped: number;
  picked_up: number;
  completed: number;
  completed_today: number;
  /** Total warehouse actions taken (all queue activity, not just completions). */
  actions: number;
  last_active: string | null;
}

export interface WarehouseLogEntry {
  at: string;
  actor_name: string;
  actor_role: string | null;
  action: string;
  to: string | null;
  invoice_number: string | null;
  order_number: string | null;
}

export interface WarehouseActivity {
  accounts: WarehouseAccount[];
  performance: WarehousePerformance[];
  logs: WarehouseLogEntry[];
}

export async function getWarehouseActivity(): Promise<WarehouseActivity> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/admin/warehouse/activity", {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Grant or revoke a warehouse account's ability to send customer emails. */
export async function setWarehouseEmailPermission(
  userId: string,
  canSend: boolean,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ can_send_fulfillment_emails: canSend }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
}
