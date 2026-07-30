import { CopyableValue } from "@/components/academy/copyable-value";

export function CopyableIpAddress({
  address,
  compactAddress,
  version,
}: {
  address: string;
  compactAddress: string;
  version: "IPv4" | "IPv6";
}) {
  return (
    <span className="admin-ip-address">
      <CopyableValue
        badge={version}
        displayValue={compactAddress}
        label="IP-адрес"
        value={address}
      />
    </span>
  );
}
