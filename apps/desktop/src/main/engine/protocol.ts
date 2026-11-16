/** Version of the engine's socket protocol this app speaks (spec §8.1). Sent in `hello`. */
export const PROTOCOL_VERSION = "1.0";

/**
 * Whether an engine speaking `version` ("major.minor") can talk to us.
 * Same rule as the engine: only the major version has to match.
 */
export function isCompatible(version: string): boolean {
  const major = version.split(".")[0];
  const ourMajor = PROTOCOL_VERSION.split(".")[0];
  return major !== "" && major === ourMajor;
}
