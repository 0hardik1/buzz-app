// Personal device-local files, never community uploads. Every key includes the
// exact account/community partition; community removal uses the same owner.
function openFiles() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("buzz-home-files-v1", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close other Buzz windows and retry saving the file."));
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export async function canvasFile(
  scope: string,
  id: string,
  change?: File | null,
): Promise<File | undefined> {
  // WebKit can fail while preparing Blob data for IndexedDB. Structured bytes
  // preserve the same device-local file without relying on that Blob backing.
  const stored = change && {
    bytes: await change.arrayBuffer(),
    name: change.name,
    type: change.type,
    lastModified: change.lastModified,
  };
  const db = await openFiles();
  try {
    return await new Promise<File | undefined>((resolve, reject) => {
      const tx = db.transaction(
        "files",
        change === undefined ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("files");
      const key = [scope, id];
      const request =
        change === undefined
          ? store.get(key)
          : change === null
            ? store.delete(key)
            : store.put(stored, key);
      tx.oncomplete = () => {
        const value = request.result;
        // Existing installs stored File objects directly.
        resolve(
          value instanceof Blob
            ? (value as File)
            : value?.bytes instanceof ArrayBuffer &&
                typeof value.name === "string"
              ? new File([value.bytes], value.name, {
                  type: value.type,
                  lastModified: value.lastModified,
                })
              : undefined,
        );
      };
      tx.onabort = () =>
        reject(
          tx.error ?? new Error("The file could not be saved on this device."),
        );
    });
  } finally {
    db.close();
  }
}

export async function purgeCanvasFiles(scope: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await openFiles();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(IDBKeyRange.bound([scope], [scope, []]));
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("Home files could not be removed."));
    });
  } finally {
    db.close();
  }
}
