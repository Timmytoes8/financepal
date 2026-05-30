import type { OpenClawConfig } from "../config/types.openclaw.js";
import { buildGatewayConnectionDetails } from "../gateway/call.js";
import { isLoopbackHost } from "../gateway/net.js";
import { normalizeStringifiedOptionalString } from "../shared/string-coerce.js";

export type DirectLoopbackGatewayAuthOpts = {
  url?: string;
  token?: string;
  password?: string;
  config?: OpenClawConfig;
};

export function shouldUseDirectLoopbackGatewayAuth(opts: DirectLoopbackGatewayAuthOpts): boolean {
  const hasExplicitAuth = Boolean(
    normalizeStringifiedOptionalString(opts.token) ||
    normalizeStringifiedOptionalString(opts.password),
  );
  if (!hasExplicitAuth) {
    return false;
  }
  const explicitUrl = normalizeStringifiedOptionalString(opts.url);
  const gatewayUrl = explicitUrl ?? buildGatewayConnectionDetails({ config: opts.config }).url;
  try {
    return isLoopbackHost(new URL(gatewayUrl).hostname);
  } catch {
    return false;
  }
}
