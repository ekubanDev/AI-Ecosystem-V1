import net from "node:net";

const blocked = new net.BlockList();
[
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].forEach(([a, p]) => blocked.addSubnet(a, p, "ipv4"));
[
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96],
].forEach(([a, p]) => blocked.addSubnet(a, p, "ipv6"));

/** True for loopback, private, link-local (incl. cloud metadata 169.254.169.254), multicast and reserved addresses. */
export const isPrivateAddress = (ip) => {
  const kind = net.isIP(ip);
  if (!kind) return true; // not an IP: refuse
  return blocked.check(ip, kind === 4 ? "ipv4" : "ipv6");
};
