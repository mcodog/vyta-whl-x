// MetaCortex DeFi Merchant API Client

const API_URL = process.env.METACORTEX_API_URL || "https://metacortexdefi.com";
const API_KEY = process.env.METACORTEX_API_KEY;
const API_SECRET = process.env.METACORTEX_API_SECRET;

export interface CreateInvoiceParams {
  amount: number;
  currency: "BTC" | "ETH" | "USDT_TRC20" | "USDT_ERC20" | "SOL" | "TRX";
  customer_email?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  payment_address: string;
  payment_url: string;
  status: "pending" | "confirming" | "paid" | "expired";
  expires_at: string;
  created_at: string;
  customer_email?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  transaction_hash?: string;
  paid_at?: string;
}

export interface MetaCortexError {
  error: string;
  message: string;
}

class MetaCortexClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor() {
    if (!API_KEY || !API_SECRET) {
      throw new Error("MetaCortex API credentials not configured");
    }
    this.apiKey = API_KEY;
    this.apiSecret = API_SECRET;
    this.baseUrl = API_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        "X-API-Secret": this.apiSecret,
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || "API request failed");
    }

    return data;
  }

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const response = await this.request<{ success: boolean; invoice: Invoice }>("/api/merchant/invoice", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return response.invoice;
  }

  async getInvoice(invoiceNumber: string): Promise<Invoice> {
    const response = await this.request<{ success: boolean; invoice: Invoice }>(`/api/merchant/invoice/${invoiceNumber}`);
    return response.invoice;
  }
}

// Singleton instance
let client: MetaCortexClient | null = null;

export function getMetaCortexClient(): MetaCortexClient {
  if (!client) {
    client = new MetaCortexClient();
  }
  return client;
}

export const SUPPORTED_CURRENCIES = [
  { code: "USDT_TRC20", name: "USDT (TRC-20)", icon: "₮", network: "Tron" },
  { code: "USDT_ERC20", name: "USDT (ERC-20)", icon: "₮", network: "Ethereum" },
  { code: "BTC", name: "Bitcoin", icon: "₿", network: "Bitcoin" },
  { code: "ETH", name: "Ethereum", icon: "Ξ", network: "Ethereum" },
  { code: "SOL", name: "Solana", icon: "◎", network: "Solana" },
  { code: "TRX", name: "Tron", icon: "⟐", network: "Tron" },
] as const;

export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]["code"];
