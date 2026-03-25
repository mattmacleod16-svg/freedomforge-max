/**
 * Offline Queue Manager — IndexedDB wrapper for storing failed API requests.
 * On reconnect, replays queued requests to ensure mutations are persisted.
 */

export interface QueuedRequest {
  id: string; // UUID
  endpoint: string; // e.g., '/api/trading/execute'
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  payload: any;
  timestamp: number; // request creation time
  attemptCount: number; // incremented on each retry
  maxAttempts: number; // default 5
  lastError?: string;
}

const DB_NAME = 'freedomforge_offline';
const STORE_NAME = 'queue';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(new Error('IndexedDB open failed'));
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

export async function pushToQueue(
  endpoint: string,
  method: string,
  payload: any
): Promise<string> {
  const database = await initDB();
  const req: QueuedRequest = {
    id: crypto.randomUUID(),
    endpoint,
    method: method as any,
    payload,
    timestamp: Date.now(),
    attemptCount: 0,
    maxAttempts: 5,
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const addReq = store.add(req);
    addReq.onerror = () => reject(new Error('Failed to queue request'));
    addReq.onsuccess = () => resolve(req.id);
  });
}

export async function getQueuedRequests(): Promise<QueuedRequest[]> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const req = index.getAll();
    req.onerror = () => reject(new Error('Failed to read queue'));
    req.onsuccess = () => resolve((req.result || []) as QueuedRequest[]);
  });
}

export async function removeFromQueue(id: string): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onerror = () => reject(new Error('Failed to remove from queue'));
    req.onsuccess = () => resolve();
  });
}

export async function updateQueuedRequest(
  id: string,
  updates: Partial<QueuedRequest>
): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const req = getReq.result as QueuedRequest;
      const updated = { ...req, ...updates };
      const putReq = store.put(updated);
      putReq.onerror = () => reject(new Error('Failed to update queue'));
      putReq.onsuccess = () => resolve();
    };
    getReq.onerror = () => reject(new Error('Failed to fetch request'));
  });
}

export async function clearQueue(): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.clear();
    req.onerror = () => reject(new Error('Failed to clear queue'));
    req.onsuccess = () => resolve();
  });
}
