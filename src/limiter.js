import { SourceUnavailableError } from './http.js';

export function createLimiter({ concurrency = 2, intervalMs = 250, maxWaitMs = 4000, now = () => Date.now() } = {}) {
  const queue = [];
  let active = 0;
  let nextStart = 0;
  let timer = null;

  function pump() {
    timer = null;
    while (queue.length && active < concurrency) {
      const wait = nextStart - now();
      if (wait > 0) {
        timer ??= setTimeout(pump, wait);
        return;
      }
      const job = queue.shift();
      clearTimeout(job.expiry);
      active += 1;
      nextStart = now() + intervalMs;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return function schedule(task) {
    return new Promise((resolve, reject) => {
      const job = { task, resolve, reject };
      job.expiry = setTimeout(() => {
        const index = queue.indexOf(job);
        if (index === -1) return;
        queue.splice(index, 1);
        reject(new SourceUnavailableError('Rate limit queue wait exceeded'));
      }, maxWaitMs);
      queue.push(job);
      pump();
    });
  };
}

export function limitFetcher(fetcher, schedule) {
  return (url, options) => schedule(() => fetcher(url, options));
}
