'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { BulkGrid, buildColumns, type GridRow } from '@/components/ui/BulkGrid';
import { CheckCircleIcon, DownloadIcon, FileIcon, UploadIcon } from '@/components/ui/icons';
import { ApiError, api } from '@/lib/api';
import type { BulkCommitOut } from '@/lib/types.gen';

const OUTPUT_DIR_KEY = 'jt.outputDir';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function readStored(): string {
  try {
    return window.localStorage.getItem(OUTPUT_DIR_KEY) ?? '';
  } catch {
    return '';
  }
}

function store(value: string) {
  try {
    if (value) window.localStorage.setItem(OUTPUT_DIR_KEY, value);
    else window.localStorage.removeItem(OUTPUT_DIR_KEY);
  } catch {
    /* private window: the folder is simply not remembered */
  }
}

function Step({ number, title, children }: { number: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-[20px] font-bold text-white">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="pt-[6px] text-[22px] font-bold leading-tight text-text-primary">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** What the upload did, in plain words, with the packing PDFs to print. */
function Result({ summary }: { summary: BulkCommitOut }) {
  const packing = summary.packing_files ?? [];
  const queued = summary.whatsapp_queued ?? 0;
  const toDropship = summary.whatsapp_to_dropship ?? 0;
  const leftOut = summary.packing_left_out ?? 0;
  const created = summary.created > 0;

  return (
    <section
      role="status"
      className={`rounded-xl border-2 p-4 sm:p-6 ${created ? 'border-[#67c23a] bg-[#f0f9eb]' : 'border-[#fbc4c4] bg-danger-tint'}`}
    >
      <div className="flex items-center gap-4">
        {created && <CheckCircleIcon className="h-14 w-14 shrink-0 text-[#3f8f1f]" />}
        <div>
          <h2 className={`break-words text-[26px] font-bold leading-tight sm:text-[32px] ${created ? 'text-[#2f6f14]' : 'text-danger'}`}>
            {created ? `${plural(summary.created, 'order')} created` : 'No orders were created'}
          </h2>
          {created && (
            <p className="mt-1 text-[18px] text-text-primary">Every order has its tracking number and parcel label.</p>
          )}
        </div>
      </div>

      <ul className="mt-4 space-y-2 text-[18px] leading-7 text-text-primary">
        {queued > 0 && (
          <li>
            <b>WhatsApp:</b> {plural(queued, '"order created" message')} {queued === 1 ? 'is' : 'are'} being sent to
            your order group{toDropship > 0 ? ` (${toDropship} to the drop-shipping group)` : ''}.
          </li>
        )}
        {created && queued === 0 && <li><b>WhatsApp:</b> messages are switched off, so none were sent.</li>}
        {summary.duplicates > 0 && (
          <li>{plural(summary.duplicates, 'order')} had been created before, so {summary.duplicates === 1 ? 'it was' : 'they were'} skipped.</li>
        )}
        {summary.failed > 0 && (
          <li className="font-semibold text-danger">
            {plural(summary.failed, 'row')} had a problem and {summary.failed === 1 ? 'was' : 'were'} not created - see
            &quot;Problem&quot; in the table below.
          </li>
        )}
      </ul>

      {packing.length > 0 && (
        <div className="mt-6 border-t border-[#c2e7b0] pt-5">
          <h3 className="text-[22px] font-bold text-text-primary">Print the labels</h3>
          <p className="mt-1 text-[17px] text-text-regular">
            One PDF for each item, with a label for every customer who ordered it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {packing.map((file) => (
              <a
                key={file.url}
                href={api.fileUrl(file.url)}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[64px] min-w-0 max-w-full items-center gap-4 rounded-lg bg-brand px-5 py-3 text-white transition-colors hover:bg-[#2e2d2a]"
              >
                <DownloadIcon className="h-7 w-7 shrink-0" />
                <span>
                  <span className="block break-words text-[18px] font-bold">{file.title}</span>
                  <span className="block text-[15px] text-white/80">
                    {plural(file.orders, 'label')} · {plural(file.pieces, 'piece')} · PDF
                  </span>
                </span>
              </a>
            ))}
          </div>
          {leftOut > 0 && (
            <p className="mt-3 text-[16px] text-text-regular">
              {plural(leftOut, 'paid drop-ship order')} {leftOut === 1 ? 'is' : 'are'} not in these PDFs - the supplier
              sends {leftOut === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[17px]">
        {created && (
          <a className="font-semibold text-brand underline underline-offset-4" href={api.zipUrl(summary.batch_id)}>
            Download every label (.zip)
          </a>
        )}
        <a className="font-semibold text-brand underline underline-offset-4" href={api.manifestUrl(summary.batch_id)}>
          Download the order list (.csv)
        </a>
        {summary.failed > 0 && (
          <a className="font-semibold text-danger underline underline-offset-4" href={api.errorsUrl(summary.batch_id)}>
            Download the problems (.csv)
          </a>
        )}
      </div>
    </section>
  );
}

export default function BulkImportPage() {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());

  const [outputDir, setOutputDir] = useState('');
  const [dirError, setDirError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<BulkCommitOut | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOutputDir(readStored());
  }, []);

  /* ---------------------------------------------------------- selection */
  const toggle = useCallback((id: number, on: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const readyIds = useMemo(() => rows.filter((r) => r.status === 'ok').map((r) => r.id), [rows]);
  const problems = rows.filter((r) => r.status === 'error').length;

  const toggleAll = useCallback((on: boolean) => setSelection(on ? new Set(readyIds) : new Set()), [readyIds]);
  const allSelected = readyIds.length > 0 && readyIds.every((id) => selection.has(id));

  const columns = useMemo(
    () => buildColumns(selection, toggle, toggleAll, allSelected),
    [selection, toggle, toggleAll, allSelected],
  );

  /* ------------------------------------------------------------- upload */
  async function handleFile(file: File) {
    setBanner(null);
    setSummary(null);
    setUploading(true);
    try {
      const result = await api.uploadCsv(file);
      setBatchId(result.batch_id);
      setRows(result.rows ?? []);
      setWarnings(result.warnings ?? []);
      setSelection(new Set());
      setBanner({
        kind: result.errors ? 'err' : 'ok',
        text:
          `${result.filename}: ${plural(result.ok, 'order')} ready to create` +
          (result.errors
            ? `. ${plural(result.errors, 'row')} ${result.errors === 1 ? 'has a problem' : 'have problems'} - see "Problem" in the table.`
            : '.'),
      });
    } catch (error) {
      setBanner({ kind: 'err', text: error instanceof ApiError ? error.message : 'The file could not be read.' });
    } finally {
      setUploading(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  /* ------------------------------------------------------------- create */
  async function folderOk(): Promise<boolean> {
    const folder = outputDir.trim();
    store(folder);
    if (!folder) return true; // the standard folder
    try {
      const check = await api.checkOutputDir(folder);
      if (!check.ok) {
        setDirError(check.message ?? 'That folder cannot be used.');
        return false;
      }
      setDirError(null);
      return true;
    } catch {
      setDirError('Could not check that folder.');
      return false;
    }
  }

  async function create(onlyTicked: boolean) {
    if (batchId === null) return;
    const rowIds = onlyTicked ? Array.from(selection) : null;
    if (onlyTicked && selection.size === 0) return;
    if (!(await folderOk())) return;

    setRunning(true);
    setBanner(null);
    setSummary(null);
    try {
      const result = await api.commitBatch(batchId, { output_dir: outputDir.trim(), row_ids: rowIds });
      setSummary(result);
      setSelection(new Set());
      await refreshRows(batchId);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (error) {
      setBanner({ kind: 'err', text: error instanceof ApiError ? error.message : 'The orders were not created.' });
    } finally {
      setRunning(false);
    }
  }

  async function refreshRows(id: number) {
    try {
      setRows(await api.listRows(id));
    } catch {
      /* the table keeps whatever it already shows */
    }
  }

  async function removeTicked() {
    if (batchId === null || selection.size === 0) return;
    try {
      await api.deleteRows(batchId, Array.from(selection));
      setRows((prev) => prev.filter((r) => !selection.has(r.id)));
      setSelection(new Set());
    } catch (error) {
      setBanner({ kind: 'err', text: error instanceof ApiError ? error.message : 'The rows were not removed.' });
    }
  }

  const ready = readyIds.length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-[30px] font-bold leading-tight text-text-primary">Upload many orders</h1>
        <p className="mt-1 text-[18px] text-text-regular">
          Every row of your CSV file becomes an order with its parcel label, and a WhatsApp message tells your team.
        </p>
      </div>

      {/* ------------------------------------------------------- step 1 */}
      <section className="rounded-xl border-2 border-line bg-white p-4 sm:p-6">
        <Step number={1} title="Choose your CSV file">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center sm:px-6 sm:py-10 transition-colors ${
              dragging ? 'border-brand bg-brand-tint' : 'border-[#c9c6bf] hover:border-brand hover:bg-brand-tint'
            }`}
          >
            <UploadIcon className="h-12 w-12 text-brand" />
            <span className="break-words text-[20px] font-bold text-text-primary sm:text-[22px]">
              {uploading ? 'Reading your file...' : 'Click here to choose a CSV file'}
            </span>
            <span className="text-[17px] text-text-regular">or drag the file onto this box</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <p className="mt-4 flex flex-wrap items-center gap-2 text-[17px] text-text-regular">
            <FileIcon className="h-5 w-5" />
            New to this?
            <a className="font-semibold text-brand underline underline-offset-4" href={api.templateUrl()} download>
              Download an example CSV file
            </a>
            and fill it in with Excel.
          </p>
        </Step>
      </section>

      {banner && (
        <div
          role={banner.kind === 'err' ? 'alert' : 'status'}
          className={`rounded-xl border-2 px-5 py-4 text-[18px] ${
            banner.kind === 'ok'
              ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#2f6f14]'
              : 'border-[#fbc4c4] bg-danger-tint text-danger'
          }`}
        >
          {banner.text}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="rounded-xl border-2 border-[#f5dab1] bg-[#fdf6ec] px-5 py-4 text-[17px] text-[#8a5a00]">
          {w}
        </div>
      ))}

      {summary && (
        <div ref={resultRef} className="scroll-mt-6">
          <Result summary={summary} />
        </div>
      )}

      {/* ------------------------------------------------------- step 2 */}
      <section className="rounded-xl border-2 border-line bg-white p-4 sm:p-6">
        <Step number={2} title="Check the orders">
          <p className="mt-1 text-[17px] text-text-regular">
            {rows.length
              ? `${plural(rows.length, 'order')} in the file${problems ? `, ${problems} with a problem` : ''}. Rows with a problem are skipped.`
              : 'Nothing to check yet.'}
          </p>
        </Step>
        <div className="mt-4">
          <BulkGrid rows={rows} columns={columns} />
        </div>
      </section>

      {/* ------------------------------------------------------- step 3 */}
      <section className="rounded-xl border-2 border-line bg-white p-4 sm:p-6">
        <Step number={3} title="Create the orders">
          {running ? (
            <div className="mt-4 rounded-xl bg-brand-tint px-5 py-5" role="status">
              <p className="text-[20px] font-bold text-text-primary">
                Creating {plural(selection.size || ready, 'order')} and their labels... please wait.
              </p>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white">
                <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="el-btn el-btn-primary h-[60px] max-w-full px-6 text-[18px] font-bold sm:px-8 sm:text-[20px]"
                disabled={ready === 0 || batchId === null}
                onClick={() => void create(false)}
              >
                {ready ? `Create ${plural(ready, 'order')}` : 'Create orders'}
              </button>
              {selection.size > 0 && (
                <>
                  <button type="button" className="el-btn h-[60px] max-w-full px-5 text-[17px] sm:px-6 sm:text-[18px]" onClick={() => void create(true)}>
                    Create only the {selection.size} ticked
                  </button>
                  <button type="button" className="el-btn h-[60px] max-w-full px-5 text-[17px] sm:px-6 sm:text-[18px]" onClick={() => void removeTicked()}>
                    Remove the {selection.size} ticked
                  </button>
                </>
              )}
            </div>
          )}

          <details className="mt-5 text-[17px]">
            <summary className="cursor-pointer text-text-regular underline underline-offset-4">
              Also save the label files in a folder on this computer (optional)
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                className={`el-input h-[52px] max-w-[560px] text-[17px] ${dirError ? 'border-danger' : ''}`}
                placeholder="Leave empty to use the standard folder"
                value={outputDir}
                onChange={(e) => {
                  setOutputDir(e.target.value);
                  setDirError(null);
                }}
              />
              {dirError && <span className="text-danger">{dirError}</span>}
            </div>
          </details>
        </Step>
      </section>
    </div>
  );
}
