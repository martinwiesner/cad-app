// src/components/DiagnosticsPanel.tsx
import { useStatusStore } from '../state/statusStore';
import { useGraphStore } from '../state/graphStore';

export function DiagnosticsPanel() {
  const issues = useStatusStore((s) => s.validationIssues);
  const computeErr = useStatusStore((s) => s.computeError);
  const errs = useStatusStore((s) => s.nodeDiagnostics.errors);
  const setSelected = useGraphStore((s) => s.setSelectedNode);

  const hasIssues = issues.length > 0 || errs.size > 0 || !!computeErr;

  return (
    <div className="diag">
      <div className="diag__header">
        <span>Diagnostik</span>
        {hasIssues ? <span className="diag__count">{issues.length + errs.size}</span> : <span className="diag__ok">✓ alles ok</span>}
      </div>
      <div className="diag__body">
        {computeErr ? (
          <div className="diag__row diag__row--error">
            <span className="diag__tag">RUNTIME</span>
            <span>{computeErr}</span>
          </div>
        ) : null}
        {[...errs.entries()].map(([id, msg]) => (
          <div
            key={`err-${id}`}
            className="diag__row diag__row--error diag__row--clickable"
            onClick={() => setSelected(id)}
          >
            <span className="diag__tag">{id.slice(0, 20)}</span>
            <span>{msg}</span>
          </div>
        ))}
        {issues.map((i, k) => (
          <div
            key={`val-${k}`}
            className={`diag__row diag__row--${i.level} ${i.nodeId ? 'diag__row--clickable' : ''}`}
            onClick={() => i.nodeId && setSelected(i.nodeId)}
          >
            <span className="diag__tag">{i.level.toUpperCase()}</span>
            <span>{i.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
