// Phase 6 · Iteration 6.16.2 — single import surface for the async-operation
// infrastructure. Components and hooks should import from `@/lib/ui` rather
// than reaching into individual modules.

export {
  AsyncHttpError,
  classifyError,
  DEFAULT_RETRY_TIMEOUT_MS,
  DEFAULT_TIMEOUTS,
  generateOpId,
  type AsyncErrorInfo,
  type AsyncErrorReason,
  type AsyncPhase,
  type AsyncScope,
  type UseAsyncOperationOptions,
} from './async-operation';
export {
  NAV_FADE_OUT_MS,
  NAV_PROGRESS_ASYMPTOTE,
  NAV_PROGRESS_EASE,
  NAV_SAFETY_TIMEOUT_MS,
  NAV_VISIBILITY_DEBOUNCE_MS,
  shouldInterceptAnchorClick,
  UIStatusProvider,
  useNavProgress,
  useOptionalUIStatus,
  useUIStatus,
  type UIStatusContextValue,
  type UIStatusProviderProps,
} from './ui-status-context';
export { useAsyncOperation, type UseAsyncOperationResult } from './use-async-operation';
