import type { RpcMethodName, RpcParams, RpcResponse, RpcResult } from "@shared/types";

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export async function rpc<M extends RpcMethodName>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
  let response: Response;
  try {
    response = await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
  } catch (error) {
    throw new RpcError(`Backend unreachable: ${error instanceof Error ? error.message : String(error)}`, "NETWORK");
  }
  const payload = (await response.json()) as RpcResponse<RpcResult<M>>;
  if (!payload.ok) throw new RpcError(payload.error.message, payload.error.code, payload.error.detail);
  return payload.result;
}

export function errorMessage(error: unknown): string {
  if (error instanceof RpcError) return error.detail ? `${error.message}\n${error.detail}` : error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
