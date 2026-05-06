// Top-level error boundary. Catches any unhandled throw from the
// React tree and renders the existing ErrorStates surface so the
// user sees a recoverable failure UI rather than a blank screen.
//
// React 19 still uses class-based componentDidCatch / getDerivedStateFromError;
// no functional equivalent has shipped.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorStates } from "./errors/ErrorStates";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional override; defaults to the production ErrorStates surface. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  caught: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { caught: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { caught: error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged via console in v0.1; Phase-9+ will route this through
    // the daemon's audit log (envelope kind=`hook-event` with the
    // serialized component stack).
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[tether] uncaught render error", error, info);
    }
  }

  override render(): ReactNode {
    if (this.state.caught) {
      return this.props.fallback ?? <ErrorStates />;
    }
    return this.props.children;
  }
}
