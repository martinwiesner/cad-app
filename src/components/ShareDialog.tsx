// src/components/ShareDialog.tsx
import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../state/graphStore';
import { encodeShareUrl, SHARE_SIZE_WARN } from '../storage/shareEncoding';

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const doc = useGraphStore((s) => s.doc);
  const [openInConfigurator, setOpenInConfigurator] = useState(true);
  const [url, setUrl] = useState<string>('');
  const [sizeBytes, setSizeBytes] = useState<number>(0);
  const [warning, setWarning] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pubCount = (doc.publishedParams ?? []).length;

  // URL bei Mount + bei Option-Aenderung neu generieren
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    encodeShareUrl(doc, { openInConfigurator }).then((result) => {
      if (cancelled) return;
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      const fullUrl = `${baseUrl}#share=${result.encoded}`;
      setUrl(fullUrl);
      setSizeBytes(result.sizeBytes);
      setWarning(result.warning);
      setBusy(false);
    }).catch((e) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.error('[share] encode failed', e);
      setBusy(false);
    });
    return () => { cancelled = true; };
  }, [doc, openInConfigurator]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: input selecten
      inputRef.current?.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
    }
  };

  return (
    <div className="publish-dialog">
      <div className="publish-dialog__backdrop" onClick={onClose} />
      <div className="publish-dialog__panel" style={{ width: 580 }}>
        <h3>🔗 Konfigurator teilen</h3>
        <p className="publish-dialog__desc">
          Diese URL enthält das komplette Projekt. Empfänger sehen denselben Konfigurator-/Editor-Zustand,
          den du gerade hast — ohne Server, ohne Login.
        </p>

        <label className="share-option">
          <input
            type="checkbox"
            checked={openInConfigurator}
            onChange={(e) => setOpenInConfigurator(e.target.checked)}
          />
          <div>
            <strong>Im Konfigurator-Modus öffnen</strong>
            <div className="share-option__desc">
              {pubCount > 0
                ? `Empfänger sieht direkt die ${pubCount} veröffentlichten Parameter`
                : <span style={{ color: 'var(--warn)' }}>⚠ Keine Parameter veröffentlicht — Konfigurator wird leer sein</span>
              }
            </div>
          </div>
        </label>

        <div className="dialog-field" style={{ marginTop: 16 }}>
          <span>URL <em>(in Zwischenablage kopieren)</em></span>
          <div className="share-url-row">
            <input
              ref={inputRef}
              type="text"
              value={busy ? 'Generiere…' : url}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button className="btn btn--primary" onClick={copy} disabled={busy || !url}>
              {copied ? '✓ Kopiert' : 'Kopieren'}
            </button>
          </div>
          <div className="share-meta">
            <span>Größe: <code>{formatBytes(sizeBytes)}</code></span>
            {warning && <span className="share-meta__warn">⚠ {warning}</span>}
          </div>
        </div>

        <details className="share-tips">
          <summary>Wie funktioniert das?</summary>
          <ul>
            <li>Die Projektdaten sind im URL-Fragment (nach <code>#</code>) eingebettet. Server bekommen das Fragment nicht zu sehen.</li>
            <li>STEP-Dateien sind ebenfalls in der URL enthalten (komprimiert).</li>
            <li>Empfänger braucht nur diesen Link — keine Anmeldung, keine Installation.</li>
            <li>Für sehr große Projekte: STL exportieren statt teilen.</li>
          </ul>
        </details>

        <div className="publish-dialog__actions">
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
