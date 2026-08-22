const activeOperations = new Set();

/** In-process lock for expensive operations that must not overlap. */
export function tryAcquireOperation(name) {
  if (activeOperations.has(name)) return null;
  activeOperations.add(name);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeOperations.delete(name);
  };
}

export async function withOperationLock(name, operation) {
  const release = tryAcquireOperation(name);
  if (!release) {
    const error = new Error(`Operation "${name}" is already running`);
    error.code = 'operation_busy';
    throw error;
  }
  try {
    return await operation();
  } finally {
    release();
  }
}
