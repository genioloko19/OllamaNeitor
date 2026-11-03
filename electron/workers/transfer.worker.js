'use strict';

/**
 * Worker de transferencia: copia archivos calculando sha256 en una sola pasada,
 * verifica los digests y empaqueta el modelo en un tar.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const tar = require('tar');

let cancelled = false;
parentPort.on('message', (message) => {
  if (message && message.type === 'cancel') cancelled = true;
});

let lastEmit = 0;
function emit(payload) {
  try { parentPort.postMessage(payload); } catch { /* ignore */ }
}

function progress(payload, force = false) {
  const now = Date.now();
  if (!force && now - lastEmit < 90) return;
  lastEmit = now;
  emit({ type: 'progress', ...payload });
}

function assertNotCancelled() {
  if (cancelled) {
    const error = new Error('Operación cancelada');
    error.code = 'E_CANCELLED';
    throw error;
  }
}

function copyAndHash(src, dest, onChunk) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const read = fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
    const write = fs.createWriteStream(dest);
    let done = 0;
    let settled = false;

    const failWith = (error) => {
      if (settled) return;
      settled = true;
      read.destroy();
      write.destroy();
      reject(error);
    };

    read.on('data', (chunk) => {
      if (cancelled) {
        const error = new Error('Operación cancelada');
        error.code = 'E_CANCELLED';
        failWith(error);
        return;
      }
      hash.update(chunk);
      done += chunk.length;
      onChunk(done);
    });
    read.on('error', failWith);
    write.on('error', failWith);
    write.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ size: done, digest: `sha256:${hash.digest('hex')}` });
    });
    read.pipe(write);
  });
}

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      if (cancelled) {
        const error = new Error('Operación cancelada');
        error.code = 'E_CANCELLED';
        stream.destroy();
        reject(error);
        return;
      }
      hash.update(chunk);
    });
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

function safeRm(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function runExport() {
  const { tasks, verify, totalBytes } = workerData;
  const results = [];
  let globalBase = 0;

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const taskTotal = task.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    let taskDone = 0;
    const startedAt = Date.now();

    try {
      assertNotCancelled();
      safeRm(task.stagingDir);
      await fsp.mkdir(task.stagingDir, { recursive: true });

      await fsp.writeFile(
        path.join(task.stagingDir, 'neitor.json'),
        JSON.stringify({
          app: 'OllamaNeitor',
          version: '0.1.0-alpha.0',
          exportedAt: new Date().toISOString(),
          model: task.model,
          verified: Boolean(verify),
          files: task.files.map((file) => ({ path: file.dest, digest: file.digest || null }))
        }, null, 2),
        'utf8'
      );

      emit({
        type: 'progress',
        phase: 'copy',
        taskIndex: index + 1,
        taskCount: tasks.length,
        model: task.model,
        done: globalBase,
        total: totalBytes,
        file: '',
        percent: totalBytes ? Math.round((globalBase / totalBytes) * 100) : 0
      });

      for (const file of task.files) {
        assertNotCancelled();
        const dest = path.join(task.stagingDir, file.dest);
        await fsp.mkdir(path.dirname(dest), { recursive: true });

        const previous = taskDone;
        const copied = await copyAndHash(file.src, dest, (bytes) => {
          taskDone = previous + bytes;
          progress({
            phase: 'copy',
            taskIndex: index + 1,
            taskCount: tasks.length,
            model: task.model,
            done: globalBase + taskDone,
            total: totalBytes,
            file: path.basename(file.src),
            percent: totalBytes ? Math.round(((globalBase + taskDone) / totalBytes) * 100) : 0
          });
        });

        if (file.digest && verify && copied.digest !== file.digest) {
          const error = new Error(`Digest distinto para ${path.basename(file.src)} (esperado ${file.digest}, obtenido ${copied.digest})`);
          error.code = 'E_DIGEST_MISMATCH';
          throw error;
        }
      }

      assertNotCancelled();
      emit({
        type: 'progress',
        phase: 'package',
        taskIndex: index + 1,
        taskCount: tasks.length,
        model: task.model,
        done: globalBase + taskTotal,
        total: totalBytes,
        file: path.basename(task.outputFinal),
        percent: totalBytes ? Math.round(((globalBase + taskTotal) / totalBytes) * 100) : 0
      });

      safeRm(task.outputPart);
      await tar.create(
        {
          cwd: task.stagingDir,
          file: task.outputPart,
          portable: true,
          gzip: false,
          noMtime: false,
          sync: false
        },
        ['manifests', 'blobs', 'neitor.json']
      );
      assertNotCancelled();
      await fsp.rename(task.outputPart, task.outputFinal);
      safeRm(task.stagingDir);

      const seconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const result = {
        ok: true,
        model: task.model,
        output: task.outputFinal,
        bytes: taskTotal,
        verified: Boolean(verify),
        seconds,
        speed: taskTotal / seconds
      };
      results.push(result);
      emit({ type: 'task-done', result });
      globalBase += taskTotal;
    } catch (error) {
      safeRm(task.stagingDir);
      safeRm(task.outputPart);
      if (error.code === 'E_CANCELLED' || cancelled) {
        emit({ type: 'cancelled' });
        return;
      }
      const result = {
        ok: false,
        model: task.model,
        output: task.outputFinal,
        bytes: taskTotal,
        error: { code: error.code || 'E_UNKNOWN', message: error.message }
      };
      results.push(result);
      emit({ type: 'task-error', result });
      globalBase += taskTotal;
    }
  }

  emit({
    type: 'done',
    results,
    totalBytes,
    exportFolder: workerData.tasks.length ? path.dirname(workerData.tasks[0].outputFinal) : ''
  });
}

runExport().catch((error) => {
  emit({ type: 'error', error: { code: error.code || 'E_UNKNOWN', message: error.message } });
});
