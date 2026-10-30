export interface StagingNetworkEnv {
  APP_ENV?: string;
  STAGING_TRUSTED_NETWORKS?: string;
}

type Address = { value: bigint; bits: number };

function parseAddress(input: string): Address | null {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(input)) {
    const parts = input.split(".").map(Number);
    if (parts.some(part => part > 255)) return null;
    return { value: parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n), bits: 32 };
  }
  if (!input.includes(":") || !/^[\da-f:.]+$/i.test(input)) return null;
  try {
    const hostname = new URL(`http://[${input}]/`).hostname;
    if (!hostname.startsWith("[") || !hostname.endsWith("]")) return null;
    const [left, right] = hostname.slice(1, -1).split("::");
    const leading = left ? left.split(":") : [];
    const trailing = right ? right.split(":") : [];
    const parts = right === undefined ? leading : [...leading, ...Array(8 - leading.length - trailing.length).fill("0"), ...trailing];
    if (parts.length !== 8 || parts.some(part => !/^[\da-f]{1,4}$/i.test(part))) return null;
    return { value: parts.reduce((value, part) => (value << 16n) | BigInt(parseInt(part, 16)), 0n), bits: 128 };
  } catch { return null; }
}

function parseNetwork(input: unknown) {
  if (typeof input !== "string") return null;
  const parts = input.split("/");
  if (parts.length > 2) return null;
  const address = parseAddress(parts[0]!);
  if (!address) return null;
  if (parts[1] !== undefined && !/^[1-9]\d{0,2}$/.test(parts[1])) return null;
  const prefix = parts[1] === undefined ? address.bits : Number(parts[1]);
  if (prefix < 1 || prefix > address.bits) return null;
  return { ...address, shift: BigInt(address.bits - prefix) };
}

export function isStagingNetworkAllowed(request: Request, env: StagingNetworkEnv): boolean {
  if (env.APP_ENV !== "staging" || new URL(request.url).hostname !== "develop.virtual-gamecenter.pages.dev"
    || request.headers.get("X-Pulbase-Gateway-Environment") !== "staging") return false;
  const configured = env.STAGING_TRUSTED_NETWORKS;
  if (!configured || configured.length > 4096) return false;
  const address = parseAddress(request.headers.get("CF-Connecting-IP") ?? "");
  if (!address) return false;
  try {
    const entries: unknown = JSON.parse(configured);
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 32) return false;
    const networks = entries.map(parseNetwork);
    if (networks.some(network => !network)) return false;
    return networks.some(network => network !== null && address.bits === network.bits
      && (address.value >> network.shift) === (network.value >> network.shift));
  } catch { return false; }
}
