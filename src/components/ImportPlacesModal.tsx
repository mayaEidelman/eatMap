import { ChangeEvent, useState } from 'react';
import { CATEGORY_META } from '../lib/categories';
import { loadGoogleMaps } from '../lib/googleMaps';
import { parseCsv, resolveCsvRows, resolveTextLines, type ImportRow } from '../lib/placesImport';
import type { DraftPlace } from '../types';

type ImportPlacesModalProps = {
  onClose: () => void;
  onImport: (places: DraftPlace[]) => void;
};

export function ImportPlacesModal({ onClose, onImport }: ImportPlacesModalProps) {
  const [tab, setTab] = useState<'csv' | 'text'>('csv');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runImport(kind: 'csv' | 'text', payload: string) {
    setBusy(true);
    setError(null);
    setResults(null);
    setProgress(null);

    try {
      const googleApi = await loadGoogleMaps();
      const onProgress = (done: number, total: number) => setProgress({ done, total });
      const resolved =
        kind === 'csv' ? await resolveCsvRows(googleApi, parseCsv(payload), onProgress) : await resolveTextLines(googleApi, payload, onProgress);

      if (resolved.length === 0) {
        setError("Couldn't find any rows to import. Check the file or pasted text.");
      } else {
        setResults(resolved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Google Maps.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        runImport('csv', reader.result);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function confirmImport() {
    if (!results) {
      return;
    }

    const places = results.map((row) => row.place).filter((place): place is DraftPlace => Boolean(place));
    onImport(places);
  }

  const successCount = results?.filter((row) => row.place).length ?? 0;
  const failedCount = results ? results.length - successCount : 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal panel import-places-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <h3>Import places from Google Maps</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="view-toggle">
          <button type="button" className={`pill${tab === 'csv' ? ' pill--active' : ''}`} onClick={() => setTab('csv')}>
            Upload CSV
          </button>
          <button type="button" className={`pill${tab === 'text' ? ' pill--active' : ''}`} onClick={() => setTab('text')}>
            Paste names
          </button>
        </div>

        {tab === 'csv' ? (
          <div className="import-places__panel">
            <p className="import-places__hint">
              Google Maps doesn't let sites read a list from its share link directly. Instead, export your list as a CSV from{' '}
              <strong>Google Takeout</strong> (myaccount.google.com → Data &amp; privacy → Download your data → Maps (your places) →
              Saved), then upload that list's CSV file here.
            </p>
            <label className="secondary-button import-places__upload">
              Choose CSV file
              <input type="file" accept=".csv,text/csv" onChange={handleFile} hidden disabled={busy} />
            </label>
          </div>
        ) : (
          <div className="import-places__panel">
            <p className="import-places__hint">Paste place names, one per line — copy them straight from your Google Maps list.</p>
            <textarea
              className="import-places__textarea"
              rows={6}
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'Kiyomizu-dera, Kyoto\nNishiki Market, Kyoto'}
              disabled={busy}
            />
            <button
              type="button"
              className="primary-button"
              onClick={() => runImport('text', pasteText)}
              disabled={busy || !pasteText.trim()}
            >
              Resolve places
            </button>
          </div>
        )}

        {busy ? (
          <p className="import-places__status">Resolving places{progress ? ` (${progress.done}/${progress.total})` : '…'}</p>
        ) : null}

        {error ? <p className="place-autocomplete__error">{error}</p> : null}

        {results ? (
          <div className="import-places__results">
            <p className="import-places__status">
              Found {successCount} place{successCount === 1 ? '' : 's'}
              {failedCount ? `, couldn't match ${failedCount}` : ''}.
            </p>
            <div className="draft-places__list">
              {results.map((row, index) => (
                <div key={index} className="draft-place">
                  <div>
                    <strong>{row.place?.name ?? row.label}</strong>
                    <small>{row.place ? row.place.address : 'No match found — add it manually'}</small>
                  </div>
                  {row.place ? (
                    <span className="chip chip--soft">
                      {CATEGORY_META[row.place.category].icon} {CATEGORY_META[row.place.category].label}
                    </span>
                  ) : (
                    <span className="chip">skipped</span>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmImport} disabled={successCount === 0}>
                Add {successCount} place{successCount === 1 ? '' : 's'} to list
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
