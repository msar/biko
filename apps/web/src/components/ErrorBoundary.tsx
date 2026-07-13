import { del } from 'idb-keyval';
import React from 'react';
import BrandMark from './BrandLogo';

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('ErrorBoundary caught an error', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = async () => {
    try {
      await del('biko:query-cache');
    } catch (err) {
      console.error('No se pudo limpiar la cache', err);
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="page-loading">
        <BrandMark size="md" showWordmark />
        <h1 className="error-title">Algo salió mal</h1>
        <p className="error-message">Ocurrió un error inesperado. Probá de nuevo.</p>
        <div className="error-actions">
          <button className="btn-primary" onClick={this.handleReload}>
            Reintentar
          </button>
          <button className="btn-secondary" onClick={this.handleReset}>
            Reiniciar app
          </button>
        </div>
      </div>
    );
  }
}
