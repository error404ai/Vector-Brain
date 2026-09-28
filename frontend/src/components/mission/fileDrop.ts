import store from '@/store/store';
import deviceFileApi, {
  INLINE_UPLOAD_LIMIT,
  STATUS_IDS_PER_REQUEST,
  UPLOAD_CHUNK_SIZE,
  sha256Hex,
  uploadChunk,
  type FileTransferStatus,
  type QueuedFileResult,
} from '@/RTKService/androidService/deviceFileService';

/** Matches MAX_FILE_BYTES on the server so the error comes before the upload. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Matches MAX_DEVICES_PER_QUEUE on the server. */
export const MAX_SEND_DEVICES = 1000;

export interface DropTarget {
  id: number;
  name: string;
}

export type DropPhase = 'hashing' | 'uploading' | 'queued' | 'error';

export interface DropState {
  phase: DropPhase;
  /** 0..1 while uploading. */
  progress: number;
  error: string | null;
  /** Transfer row id per device id, once the server has queued them. */
  rowOf: Record<number, number>;
  /** Latest status per transfer row id. */
  status: Record<number, FileTransferStatus>;
  /** Row ids the status endpoint no longer returns (expired or removed). */
  gone: Record<number, true>;
  /** When the server queued the file (browser clock); delivery times count from here. */
  queuedAt: number | null;
}

interface Job {
  file: File;
  targets: DropTarget[];
  /** Same object for the life of the send, so React memo deps stay stable. */
  info: { file: File; targets: DropTarget[] };
  state: DropState;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  polling: boolean;
}

/**
 * Sends live outside React, keyed by the chat turn id, so StrictMode's double
 * mount or a re-render never uploads a file twice, and the card can come and
 * go while the upload carries on.
 */
const jobs = new Map<string, Job>();

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Short label and colours for the file badge. */
export function fileBadge(file: { name: string; type: string }): { label: string; from: string; to: string } {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const label = (ext && ext.length <= 4 ? ext : 'file').toUpperCase();
  if (ext === 'apk') return { label, from: '#12C79A', to: '#0EA5A0' };
  if (file.type.startsWith('image/')) return { label, from: '#7C5CFF', to: '#FF4D8D' };
  if (file.type.startsWith('video/')) return { label, from: '#FF4D8D', to: '#FFB020' };
  if (file.type.startsWith('audio/')) return { label, from: '#FFB020', to: '#FF6B3D' };
  if (file.type === 'application/pdf') return { label, from: '#F0445A', to: '#FF7A59' };
  return { label, from: '#2F6BFF', to: '#7C5CFF' };
}

/**
 * Which phones a message with a file is for: every @phone and #tag it names,
 * or every online phone when it names none. Names can contain spaces, so they
 * are matched as whole strings rather than split on words.
 */
export function resolveTargets(
  text: string,
  devices: { id: number; name: string; online: boolean; tag: string | null }[],
): { targets: DropTarget[]; picked: boolean } {
  const lower = text.toLowerCase();
  const byName = devices.filter((d) => d.name && lower.includes(`@${d.name.toLowerCase()}`));
  const byTag = devices.filter((d) => {
    const tag = (d.tag ?? '').split(':').pop()?.trim().toLowerCase();
    return !!tag && new RegExp(`(^|\\s)#${escapeRegExp(tag)}(?=$|[\\s,.!?])`).test(lower);
  });
  const picked = byName.length > 0 || byTag.length > 0;
  const chosen = picked ? [...new Map([...byName, ...byTag].map((d) => [d.id, d])).values()] : devices.filter((d) => d.online);
  return { targets: chosen.map((d) => ({ id: d.id, name: d.name })), picked };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getDropState(id: string): DropState | null {
  return jobs.get(id)?.state ?? null;
}

export function dropInfo(id: string): { file: File; targets: DropTarget[] } | null {
  return jobs.get(id)?.info ?? null;
}

export function subscribeDrop(id: string, listener: () => void): () => void {
  const job = jobs.get(id);
  if (!job) return () => undefined;
  job.listeners.add(listener);
  schedulePoll(job, 0);
  return () => {
    job.listeners.delete(listener);
    if (job.listeners.size === 0 && job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
  };
}

function update(job: Job, patch: Partial<DropState>) {
  job.state = { ...job.state, ...patch };
  job.listeners.forEach((listener) => listener());
}

/** Starts a send once; later calls with the same id are ignored. */
export function startDrop(id: string, file: File, targets: DropTarget[]): void {
  if (jobs.has(id)) return;
  const job: Job = {
    file,
    targets,
    info: { file, targets },
    state: { phase: 'hashing', progress: 0, error: null, rowOf: {}, status: {}, gone: {}, queuedAt: null },
    listeners: new Set(),
    timer: null,
    startedAt: Date.now(),
    polling: false,
  };
  jobs.set(id, job);
  void upload(job, targets.map((t) => t.id));
}

/** Sends the same file again to the phones whose transfer failed. */
export function retryFailed(id: string): void {
  const job = jobs.get(id);
  if (!job || job.state.phase === 'uploading' || job.state.phase === 'hashing') return;
  const failed = job.targets
    .map((t) => t.id)
    .filter((deviceId) => job.state.status[job.state.rowOf[deviceId]]?.status === 'FAILED');
  if (failed.length === 0) return;
  job.startedAt = Date.now();
  void upload(job, failed);
}

async function upload(job: Job, deviceIds: number[]) {
  const { file } = job;
  try {
    let result: QueuedFileResult;
    if (file.size <= INLINE_UPLOAD_LIMIT) {
      update(job, { phase: 'uploading', progress: 0, error: null });
      const content_base64 = await readAsBase64(file);
      const res = await store
        .dispatch(
          deviceFileApi.endpoints.queueDeviceFile.initiate({
            device_ids: deviceIds,
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            content_base64,
          }),
        )
        .unwrap();
      result = res.data;
    } else {
      update(job, { phase: 'hashing', progress: 0, error: null });
      const sha256 = await sha256Hex(file);
      const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
      const init = await store
        .dispatch(
          deviceFileApi.endpoints.initDeviceUpload.initiate({
            device_ids: deviceIds,
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
            sha256,
            total_chunks: totalChunks,
          }),
        )
        .unwrap();
      update(job, { phase: 'uploading' });
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * UPLOAD_CHUNK_SIZE;
        await uploadChunk(init.data.upload_id, index, file.slice(start, Math.min(start + UPLOAD_CHUNK_SIZE, file.size)));
        update(job, { progress: (index + 1) / totalChunks });
      }
      const res = await store.dispatch(deviceFileApi.endpoints.finishDeviceUpload.initiate({ upload_id: init.data.upload_id })).unwrap();
      result = res.data;
    }

    const rowOf = { ...job.state.rowOf };
    const status = { ...job.state.status };
    for (const row of result.queued ?? []) {
      const previous = rowOf[row.device_id];
      if (previous) delete status[previous];
      rowOf[row.device_id] = row.id;
    }
    update(job, { phase: 'queued', progress: 1, rowOf, status, queuedAt: Date.now() });
    schedulePoll(job, 800);
  } catch (error) {
    const err = error as { data?: { message?: string }; message?: string };
    update(job, { phase: 'error', error: err?.data?.message || err?.message || 'The file could not be sent.' });
  }
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** Rows still waiting on a phone. */
function openRows(job: Job): number[] {
  return Object.values(job.state.rowOf).filter((row) => {
    if (job.state.gone[row]) return false;
    const s = job.state.status[row];
    return !s || s.status === 'PENDING';
  });
}

/**
 * Polls while the card is on screen and something is still open: quickly at
 * first, then every 15s (offline phones can take days), and not at all while
 * the tab is hidden.
 */
function schedulePoll(job: Job, delay: number) {
  if (job.timer || job.state.phase !== 'queued' || job.listeners.size === 0) return;
  if (openRows(job).length === 0) return;
  job.timer = setTimeout(() => {
    job.timer = null;
    void poll(job);
  }, delay);
}

async function poll(job: Job) {
  if (job.polling) return;
  const rows = openRows(job);
  if (rows.length === 0 || job.listeners.size === 0) return;
  if (typeof document !== 'undefined' && document.hidden) {
    schedulePoll(job, 5000);
    return;
  }
  job.polling = true;
  try {
    const status = { ...job.state.status };
    const gone = { ...job.state.gone };
    for (let i = 0; i < rows.length; i += STATUS_IDS_PER_REQUEST) {
      const batch = rows.slice(i, i + STATUS_IDS_PER_REQUEST);
      const res = await store.dispatch(deviceFileApi.endpoints.getFileStatus.initiate(batch, { forceRefetch: true, subscribe: false })).unwrap();
      const seen = new Set<number>();
      for (const row of res.data) {
        status[row.id] = row;
        seen.add(row.id);
      }
      for (const row of batch) if (!seen.has(row)) gone[row] = true;
    }
    update(job, { status, gone });
  } catch {
    // A missed poll is retried on the next tick.
  } finally {
    job.polling = false;
  }
  const young = Date.now() - job.startedAt < 2 * 60_000;
  schedulePoll(job, young ? 3000 : 15_000);
}
