/**
 * Codex primitives barrel — import from a single path:
 *
 *   import { CxLogo, CxStatus, CxPanel, CxFormRow, CxSkeleton }
 *     from "../components/codex";
 *
 * All primitives expect to render inside a ``theme-codex`` subtree
 * so the CSS custom properties resolve. See
 * ``design_handoff_aria_codex_redesign/README.md`` §"Implementation Order"
 * step 2 for the full primitive catalogue.
 */
export { CxLogo } from "./CxLogo";
export { CxStatus, type CxStatusTone } from "./CxStatus";
export { CxPanel } from "./CxPanel";
export { CxFormRow } from "./CxFormRow";
export { CxSkeleton } from "./CxSkeleton";
export { CxTopProgress } from "./CxTopProgress";
export {
  CxPagination,
  getCxPageItems,
  type CxPaginationVariant,
  type CxPageItem,
} from "./CxPagination";
export {
  CxDialog,
  CxConfirmDialog,
  type CxDialogTone,
  type CxDialogSize,
} from "./CxDialog";
