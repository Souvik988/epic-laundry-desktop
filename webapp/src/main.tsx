import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-sans-devanagari";
import "./index.css";

// HashRouter (not BrowserRouter): routes live in the URL hash, so the app works from
// file://-style static hosting inside Electron with no server-side route fallback needed.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 15_000, retry: 1 },
  },
});

class RendererErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Epic Laundry renderer failed to mount', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f3f1ec', color: '#17363e', fontFamily: 'Manrope, system-ui, sans-serif' }}>
        <section style={{ width: 'min(560px, 100%)', border: '1px solid rgba(23,54,62,.12)', borderRadius: 20, padding: 28, background: '#fff', boxShadow: '0 24px 70px rgba(18,48,57,.14)' }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#b45309' }}>Epic Laundry desktop</p>
          <h1 style={{ margin: '8px 0 10px', fontSize: 24 }}>The workspace could not open</h1>
          <p style={{ margin: 0, lineHeight: 1.6, color: '#617178' }}>The local service is running, but the screen encountered a startup error. Reload the workspace or share this diagnostic with support.</p>
          <pre style={{ margin: '18px 0 0', overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 12, padding: 12, background: '#f7f8f5', color: '#7f1d1d', fontSize: 12 }}>{this.state.error.message || 'Unknown renderer error'}</pre>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 18, border: 0, borderRadius: 10, padding: '11px 16px', background: '#123039', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Reload workspace</button>
        </section>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <RendererErrorBoundary>
          <App />
        </RendererErrorBoundary>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
