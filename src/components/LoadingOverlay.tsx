// src/components/LoadingOverlay.tsx
import { useStatusStore } from '../state/statusStore';
import { useViewerStore } from '../state/viewerStore';
import { useUiStore } from '../state/uiStore';

export function LoadingOverlay() {
  const kernel = useStatusStore((s) => s.kernel);
  const compute = useStatusStore((s) => s.compute);
  const kernelError = useStatusStore((s) => s.kernelError);
  const lastLog = useStatusStore((s) => s.logs[s.logs.length - 1]);
  const hasShapes = useViewerStore((s) => s.meshes.size) > 0;
  const mode = useUiStore((s) => s.mode);

  const kernelLoading = kernel === 'uninitialized' || kernel === 'initializing';
  const kernelError_ = kernel === 'error';
  const firstCompute = kernel === 'ready' && compute === 'computing' && !hasShapes;

  if (!kernelLoading && !kernelError_ && !firstCompute) return null;

  // Step state: 1 = kernel laden, 2 = geometrie berechnen
  const step = kernelLoading ? 1 : 2;

  let headline = '';
  let sub = '';

  if (kernelError_) {
    headline = 'Kernel konnte nicht geladen werden';
    sub = kernelError ?? 'Unbekannter Fehler — Seite neu laden';
  } else if (kernelLoading) {
    headline = 'CAD-Kernel wird geladen…';
    sub = '~30 MB WASM · beim ersten Aufruf ca. 30 Sekunden, danach aus dem Browser-Cache';
  } else if (firstCompute) {
    headline = mode === 'configurator'
      ? 'Konfigurator wird vorbereitet…'
      : 'Geometrie wird berechnet…';
    sub = lastLog?.message ?? '';
  }

  return (
    <div className="loading-overlay">
      <div className="loading-overlay__card">
        <div className="loading-overlay__brand">CAD&nbsp;//&nbsp;0.3</div>

        <div className="loading-overlay__headline">{headline}</div>
        {sub && <div className="loading-overlay__sub">{sub}</div>}

        {!kernelError_ && (
          <>
            <div className="loading-overlay__steps">
              <LoadStep n={1} label="CAD-Kernel laden" state={step === 1 ? 'active' : 'done'} />
              <LoadStep n={2} label={
                mode === 'configurator' ? 'Konfigurator vorbereiten' : 'Geometrie berechnen'
              } state={step < 2 ? 'waiting' : 'active'} />
            </div>
            <div className="loading-overlay__spinner" />
          </>
        )}

        {kernelError_ && (
          <button className="btn btn--primary" style={{ marginTop: '1.5rem' }}
            onClick={() => window.location.reload()}>
            Seite neu laden
          </button>
        )}
      </div>
    </div>
  );
}

type StepState = 'waiting' | 'active' | 'done';

function LoadStep({ n, label, state }: { n: number; label: string; state: StepState }) {
  const icon = state === 'done' ? '✓' : String(n);
  return (
    <div className={`loading-overlay__step loading-overlay__step--${state}`}>
      <span className="loading-overlay__step-icon">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
