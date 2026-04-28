// Sprint 13 Bloque 2 — Iconografia Lucide unificada.
// Re-export con stroke 1.5 por defecto. Usar SIZE_* para coherencia.

export {
  Sparkles,
  Bell,
  Phone,
  MessageCircle,
  ClipboardList,
  Pencil,
  RefreshCw,
  Check,
  X,
  ArrowUp,
  Wrench,
  AlertTriangle,
  ChevronRight,
  Search,
  Calendar,
  Clock,
  User,
  Users,
  Plus,
  Filter,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

/** Sizes coherentes — la decision de tamaño literal del brief se respeta
 *  por sitio de uso, pero estos defaults sirven de base. */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 22,
} as const;

/** Stroke uniforme 1.5 segun brief Sprint 13. */
export const ICON_STROKE = 1.5;
