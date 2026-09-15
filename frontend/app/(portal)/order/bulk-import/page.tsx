'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BulkGrid, buildColumns, type GridRow } from '@/components/ui/BulkGrid';
import {
  ChevronDown,
  ChevronLeftSm,
  ChevronRightSm,
  FolderIcon,
  PinIcon,
  RulesIcon,
} from '@/components/ui/icons';
import { ApiError, api, watchProgress } from '@/lib/api';
import type {
  BulkCommitOut,
  BulkProgressOut,
  SenderProfileOut,
} from '@/lib/types.gen';

const OUTPUT_DIR_KEY = 'jt.outputDir';

export default function BulkImportPage() {
  const [sender, setSender] = useState<SenderProfileOut | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());

  const [outputDir, setOutputDir] = useState('');
  const [dirError, setDirError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BulkProgressOut | null>(null);
  const [summary, setSummary] = useState<BulkCommitOut | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getSender().then(setSender).catch(() => undefined);
    const stored = window.localStorage.getItem(OUTPUT_DIR_KEY);
    if (stored) setOutputDir(stored);
  }, []);

  useEffect(() => {
    if (outputDir) window.localStorage.setItem(OUTPUT_DIR_KEY, outputDir);
  }, [outputDir]);

  /* ---------------------------------------------------------- selection */
  const toggle = useCallback((id: number, on: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectableIds = useMemo(
    () => rows.filter((r) => r.status === 'ok').map((r) => r.id),
    [rows],
  );

  const toggleAll = useCallback(
    (on: boolean) => setSelection(on ? new Set(selectableIds) : new Set()),
    [selectableIds],
  );

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selection.has(id));

  const columns = useMemo(
    () => buildColumns(sender, selection, toggle, toggleAll, allSelected),
    [sender, selection, toggle, toggleAll, allSelected],
  );

  /* ------------------------------------------------------------- upload */
  async function handleFile(file: File) {
    setBanner(null);
    setSummary(null);
    setProgress(null);
    try {
      const result = await api.uploadCsv(file);
      setBatchId(result.batch_id);
      setRows(result.rows ?? []);
      setWarnings(result.warnings ?? []);
      setSelection(new Set());
      setBanner({
        kind: result.errors ? 'err' : 'ok',
        text: `${result.filename}: ${result.total} rows read, ${result.ok} valid${
          result.errors ? `, ${result.errors} rejected - see Error Message` : ''
        }.`,
      });
    } catch (error) {
      setBanner({
        kind: 'err',
        text: error instanceof ApiError ? error.message : 'Upload failed.',
      });
    }
  }

  /* ------------------------------------------------------------- commit */
  async function validateDir(): Promise<boolean> {
    if (!outputDir.trim()) {
      setDirError('Choose a folder for the waybill PDFs before ordering.');
      return false;
    }
    try {
      const check = await api.checkOutputDir(outputDir.trim());
      if (!check.ok) {
        setDirError(check.message ?? 'That folder cannot be used.');
        return false;
      }
      setDirError(null);
      setOutputDir(check.resolved ?? outputDir);
      return true;
    } catch {
      setDirError('Could not validate the folder.');
      return false;
    }
  }

  async function runCommit(onlySelected: boolean, asAsync: boolean) {
    if (batchId === null) return;
    if (!(await validateDir())) return;

    const rowIds = onlySelected ? Array.from(selection) : null;
    if (onlySelected && (!rowIds || rowIds.length === 0)) {
      setBanner({ kind: 'err', text: 'Select at least one row first.' });
      return;
    }

    setRunning(true);
    setBanner(null);
    setSummary(null);
    setProgress({
      batch_id: batchId,
      stage: 'creating',
      status: 'creating',
      processed: 0,
      total: rowIds?.length ?? rows.length,
      percent: 0,
    });

    try {
      if (asAsync) {
        await api.commitBatch(
          batchId,
          { output_dir: outputDir, row_ids: rowIds },
          true,
        );
        watchProgress(
          batchId,
          (tick) => setProgress(tick),
          () => {
            setRunning(false);
            void refreshRows(batchId);
            setBanner({ kind: 'ok', text: 'Batch finished. Waybills are in the chosen folder.' });
          },
        );
      } else {
        const result = await api.commitBatch(batchId, {
          output_dir: outputDir,
          row_ids: rowIds,
        });
        setSummary(result);
        setRunning(false);
        await refreshRows(batchId);
        setBanner({
          kind: result.failed ? 'err' : 'ok',
          text:
            `${result.created} order(s) created in ${result.duration_ms} ms` +
            (result.duplicates ? `, ${result.duplicates} duplicate(s) skipped` : '') +
            (result.failed ? `, ${result.failed} failed` : '') +
            `. PDFs written to ${result.output_dir}.`,
        });
      }
    } catch (error) {
      setRunning(false);
      setBanner({
        kind: 'err',
        text: error instanceof ApiError ? error.message : 'The batch failed.',
      });
    }
  }

  async function refreshRows(id: number) {
    try {
      setRows(await api.listRows(id));
    } catch {
      /* the grid keeps whatever it already shows */
    }
  }

  async function handleDelete() {
    if (batchId === null || selection.size === 0) return;
    try {
      await api.deleteRows(batchId, Array.from(selection));
      setRows((prev) => prev.filter((r) => !selection.has(r.id)));
      setSelection(new Set());
    } catch (error) {
      setBanner({
        kind: 'err',
        text: error instanceof ApiError ? error.message : 'Delete failed.',
      });
    }
  }

  const hasRows = rows.length > 0;
  const hasSelection = selection.size > 0;

  return (
    <div className="flex min-h-full flex-col p-5">
      {/* --------------------------------------------------------- toolbar */}
      <div className="mb-3 flex items-center">
        <div className="flex gap-2.5">
          <a className="el-btn" href={api.templateUrl()} download>
            Template Download <ChevronDown className="text-text-secondary" />
          </a>
          <button
            type="button"
            className="el-btn"
            onClick={() => fileRef.current?.click()}
          >
            Import Excel <ChevronDown className="text-text-secondary" />
          </button>
          <button type="button" className="el-btn" onClick={() => fileRef.current?.click()}>
            Import Task
          </button>
          <button type="button" className="el-btn" disabled>
            Analysis Assistant
          </button>
          <button type="button" className="el-btn">
            Manage Import Template
          </button>
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
        </div>

        <div className="ml-auto flex items-center gap-5 text-base">
          <span className="flex items-center gap-1.5 text-jt-red">
            <PinIcon /> How to import?
          </span>
          <span className="flex items-center gap-1.5 text-jt-red">
            <RulesIcon /> Import Rules
          </span>
        </div>
      </div>

      {/* ------------------------------------------------- output folder */}
      <div className="mb-3 flex items-center gap-3">
        <label className="req shrink-0 text-base text-text-regular">
          Save waybills to:
        </label>
        <input
          className={`el-input max-w-[560px] ${dirError ? 'border-jt-red' : ''}`}
          placeholder={'e.g. C:\\Users\\me\\Desktop\\Waybills'}
          value={outputDir}
          onChange={(e) => {
            setOutputDir(e.target.value);
            setDirError(null);
          }}
        />
        <button type="button" className="el-btn" onClick={() => void validateDir()}>
          <FolderIcon /> Check folder
        </button>
        {dirError && <span className="text-base text-jt-red">{dirError}</span>}
      </div>

      {banner && (
        <div
          className={`mb-3 rounded border px-4 py-2.5 text-base ${
            banner.kind === 'ok'
              ? 'border-[#c2e7b0] bg-[#f0f9eb] text-[#529b2e]'
              : 'border-[#fbc4c4] bg-[#fef0f0] text-jt-red'
          }`}
        >
          {banner.text}
        </div>
      )}
      {warnings.map((w) => (
        <div
          key={w}
          className="mb-3 rounded border border-[#f5dab1] bg-[#fdf6ec] px-4 py-2.5 text-base text-[#b88230]"
        >
          {w}
        </div>
      ))}

      {/* ------------------------------------------------------------ grid */}
      <BulkGrid rows={rows} columns={columns} />

      {/* ---------------------------------------------------- footer strip */}
      <div className="flex items-center py-2.5 text-base">
        <span className="text-text-regular">
          Data on this page:&nbsp; {rows.length} Unit
        </span>
        <span className="ml-4 rounded bg-[#f4f4f5] px-2.5 py-1 text-text-secondary">
          * Click on a data row to modify the data
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="text-text-secondary" aria-label="Previous page">
            <ChevronLeftSm />
          </button>
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-sm bg-jt-red px-1.5 text-mini font-semibold text-white">
            1
          </span>
          <button type="button" className="text-text-secondary" aria-label="Next page">
            <ChevronRightSm />
          </button>
          <span className="ml-3 text-text-regular">Total {rows.length}</span>
        </div>
      </div>

      {/* ------------------------------------------------ progress + links */}
      {(running || progress || summary) && (
        <div className="el-card mb-3 p-4">
          {progress && (
            <>
              <div className="mb-2 flex items-center justify-between text-base">
                <span className="text-text-regular">
                  {progress.stage === 'rendering'
                    ? 'Rendering waybills'
                    : progress.stage === 'creating'
                      ? 'Creating orders'
                      : progress.stage}
                  {' \u00B7 '}
                  {progress.processed} / {progress.total}
                </span>
                <span className="font-semibold text-text-primary">{progress.percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-[#ebeef5]">
                <div
                  className="h-full rounded bg-jt-red transition-all"
                  style={{ width: `${Math.min(100, progress.percent)}%` }}
                />
              </div>
            </>
          )}
          {summary && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-base">
              <span className="text-text-regular">
                created <b className="text-text-primary">{summary.created}</b>
                {' \u00B7 '}duplicates <b className="text-text-primary">{summary.duplicates}</b>
                {' \u00B7 '}failed <b className="text-text-primary">{summary.failed}</b>
                {' \u00B7 '}
                <b className="text-text-primary">{summary.duration_ms} ms</b>
              </span>
              <a className="text-jt-red hover:underline" href={api.manifestUrl(summary.batch_id)}>
                manifest.csv
              </a>
              {summary.failed > 0 && (
                <a className="text-jt-red hover:underline" href={api.errorsUrl(summary.batch_id)}>
                  import_errors.csv
                </a>
              )}
              <a className="text-jt-red hover:underline" href={api.zipUrl(summary.batch_id)}>
                download all PDFs (.zip)
              </a>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------- action bar -- */}
      <div className="el-card flex h-[62px] items-center justify-end gap-2.5 px-5">
        <button
          type="button"
          className="el-btn el-btn-soft"
          disabled={!hasSelection || running}
          onClick={() => void runCommit(true, true)}
        >
          Order selected (Async)
        </button>
        <button
          type="button"
          className="el-btn el-btn-soft"
          disabled={!hasRows || running}
          onClick={() => void runCommit(false, true)}
        >
          Order all (Async)
        </button>
        <button
          type="button"
          className="el-btn el-btn-soft"
          disabled={!hasSelection || running}
          onClick={() => void runCommit(true, false)}
        >
          Order selected
        </button>
        <button
          type="button"
          className="el-btn el-btn-soft"
          disabled={!hasRows || running}
          onClick={() => void runCommit(false, false)}
        >
          Order all
        </button>
        <button
          type="button"
          className="el-btn"
          disabled={!hasSelection || running}
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
