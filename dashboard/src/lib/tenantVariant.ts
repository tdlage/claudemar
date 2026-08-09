const VARIANTS = ["default", "info", "success", "warning"] as const;

export function tenantVariant(tenant: string): (typeof VARIANTS)[number] {
  if (!tenant || tenant === "personal") return "default";
  let hash = 0;
  for (let i = 0; i < tenant.length; i++) hash = (hash * 31 + tenant.charCodeAt(i)) >>> 0;
  return VARIANTS[1 + (hash % (VARIANTS.length - 1))];
}
