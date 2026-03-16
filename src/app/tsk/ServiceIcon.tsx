import {
  ExternalLink,
  Eye,
  Globe,
  Layout,
  type LucideIcon,
  Monitor,
  Server,
  SquareTerminal,
} from "lucide-react";
import type { FC } from "react";

const iconMap: Record<string, LucideIcon> = {
  Globe,
  Monitor,
  ExternalLink,
  Server,
  Eye,
  Layout,
  Terminal: SquareTerminal,
};

/** Capitalize a service key for display (e.g. "frontend" → "Frontend", "vnc" → "VNC") */
export const defaultServiceLabel = (key: string): string => {
  if (key.toUpperCase() === key) return key; // already all-caps like "VNC"
  if (key.length <= 3) return key.toUpperCase(); // short keys like "vnc" → "VNC"
  return key.charAt(0).toUpperCase() + key.slice(1);
};

export const ServiceIcon: FC<{ name: string; className?: string }> = ({
  name,
  className = "w-3 h-3",
}) => {
  const Icon = iconMap[name] ?? ExternalLink;
  return <Icon className={className} />;
};
