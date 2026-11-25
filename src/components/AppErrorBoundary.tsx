import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Laplace UI error boundary caught an error:", error, info);
  }

  private handleRecover = () => {
    this.setState({ error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <main className="app-error-boundary" role="alert">
        <div className="app-error-boundary-card">
          <h1>Laplace hit an unexpected UI error</h1>
          <p className="app-error-boundary-message">
            {error.message || "An unhandled rendering error occurred."}
          </p>
          {error.stack && (
            <details className="app-error-boundary-details">
              <summary>Stack trace</summary>
              <pre>{error.stack}</pre>
            </details>
          )}
          <div className="app-error-boundary-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={this.handleRecover}
            >
              Try to recover
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={this.handleReload}
            >
              Reload window
            </button>
          </div>
        </div>
      </main>
    );
  }
}
