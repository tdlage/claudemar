import { useEffect, useState } from "react";
import { Cpu, MemoryStick } from "lucide-react";
import { api } from "../../lib/api";

interface Resources {
  cpu: number;
  ram: number;
}

function getColor(value: number): string {
  if (value >= 90) return "text-red-400";
  if (value >= 70) return "text-amber-400";
  return "text-text-muted";
}

export function SystemResources() {
  const [resources, setResources] = useState<Resources | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetch = () => {
      api.get<Resources>("/system/resources").then((data) => {
        if (mounted) setResources(data);
      }).catch(() => {});
    };

    fetch();
    const interval = setInterval(fetch, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!resources) return null;

  return (
    <div className="hidden sm:flex items-center gap-3 text-xs font-mono">
      <span className={`flex items-center gap-1 ${getColor(resources.cpu)}`}>
        <Cpu size={12} />
        <span>CPU: {resources.cpu}%</span>
      </span>
      <span className={`flex items-center gap-1 ${getColor(resources.ram)}`}>
        <MemoryStick size={12} />
        <span>RAM: {resources.ram}%</span>
      </span>
    </div>
  );
}
